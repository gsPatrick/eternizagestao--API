'use strict';

/**
 * NÚCLEO de NOTIFICAÇÕES — escalável, sempre via FILA.
 *
 * Princípios
 * ----------
 *  1. Todo envio passa pela camada de filas (`enqueue`) — o request nunca faz o
 *     I/O de envio (WhatsApp/e-mail). Com Redis/BullMQ o job roda no worker; sem
 *     Redis, o fallback síncrono de `src/queues` executa o handler ali mesmo.
 *  2. A linha `Notification` é a fonte de verdade do status e a base da
 *     idempotência: um job de dispatch que encontra a linha já 'enviada' é no-op.
 *  3. Contexto de renderização (template + vars de e-mail) viaja no PAYLOAD do
 *     job — o model não tem colunas para isso. Em `retry` (onde só existe a
 *     linha) o template é derivado do tipo e as vars são reconstruídas do
 *     subject/message (o `fill` do render trata vars ausentes como vazias).
 *
 * Integrações POR CIDADE (Fase 2 — drivers reais, trocáveis):
 *   const email = require('../../providers/email');
 *   email.sendEmail(tenantSmtp, { to, subject, html, text }) => { providerMessageId }
 *     (usa o SMTP DA CIDADE via getIntegrationConfig; sem SMTP → driver mock/log)
 *   const whatsapp = require('../../providers/whatsapp');
 *   whatsapp.sendText(tenant, numero, texto) => { providerMessageId }
 *     (usa a instância Evolution DA CIDADE; desconectado/sem Evolution → falha
 *      amigável na linha, NÃO derruba a fila)
 *
 * Handlers registrados na fila 'notifications':
 *   dispatch        — envia UMA notificação (rethrow em falha → BullMQ faz retry)
 *   dispatch-batch  — envia um LOTE (swallow por item → o lote sempre completa)
 *   scan-vencidos   — job diário: cobranças vencidas → cobranca_vencida
 *   scan-vencimentos— job diário: taxas a vencer em X dias → vencimento_taxa
 */

const { Op } = require('sequelize');
const AppError = require('../../utils/app-error');
const { getPagination, buildPageMeta } = require('../../utils/pagination');
const whatsappProvider = require('../../providers/whatsapp');
const { renderEmail } = require('../../emails/render');
const { renderWhatsapp } = require('../../whatsapp/render');
const { todayISO, hourInTZ, startOfTodayInTZ } = require('../../utils/date-local');
const {
  enqueue,
  registerHandler,
  scheduleRepeatable,
} = require('../../queues');
const {
  Notification,
  Person,
  Billing,
  MaintenanceFee,
  Grave,
  Tenant,
} = require('../../models');

// ---------------------------------------------------------------------------
// Constantes de fila / jobs
// ---------------------------------------------------------------------------
const QUEUE = 'notifications';
const JOB_DISPATCH = 'dispatch';
const JOB_DISPATCH_BATCH = 'dispatch-batch';
const JOB_SCAN_VENCIDOS = 'scan-vencidos';
const JOB_SCAN_VENCIMENTOS = 'scan-vencimentos';

const BULK_CHUNK = 500; // linhas por bulkCreate / por job de lote
const SCAN_LIMIT = 5000; // teto defensivo por varredura

// notificationType → template de e-mail (chaves de src/emails/index.js)
const TYPE_TEMPLATE = {
  vencimento_taxa: 'fee-reminder',
  cobranca_vencida: 'billing-overdue',
  cobranca_gerada: 'fee-reminder',
  pagamento_confirmado: 'payment-confirmed',
  agendamento: 'schedule-reminder',
  documento_emitido: 'document-issued',
  autorizacao_sepultamento: 'document-issued',
  portal_acesso: 'activation',
  avulsa: 'generic',
  lembrete: 'generic',
  outro: 'generic',
};

// ---------------------------------------------------------------------------
// Provider de e-mail — require defensivo (outro agente cria o index.js).
// Mantém o contrato exato `require('../../providers/email')`, mas não derruba
// o load do módulo se ainda não existir: a falta vira 'falha' no dispatch.
// ---------------------------------------------------------------------------
let _emailProvider; // undefined = ainda não tentou; null = indisponível
function getEmailProvider() {
  if (_emailProvider === undefined) {
    try {
      _emailProvider = require('../../providers/email');
    } catch {
      _emailProvider = null;
    }
  }
  return _emailProvider;
}

// Config de integrações POR CIDADE (SMTP/WhatsApp em claro, server-side).
// require lazy: evita ciclo (integration-config → models) no load do módulo.
// Best-effort: falha vira config vazia → drivers caem no comportamento mock/dev.
let _getIntegrationConfig; // undefined = ainda não tentou; null = indisponível
async function integrationConfig(tenantId) {
  if (_getIntegrationConfig === undefined) {
    try {
      // eslint-disable-next-line global-require
      _getIntegrationConfig = require('../tenants/integration-config').getIntegrationConfig;
    } catch {
      _getIntegrationConfig = null;
    }
  }
  if (!_getIntegrationConfig) return null;
  try {
    return await _getIntegrationConfig(tenantId);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
// TUDO no fuso de OPERAÇÃO. Antes isto misturava dois relógios: toDateOnly
// usava UTC e startOfToday usava a hora do processo (que em produção é UTC).
// A mistura fazia o corte de vencidos e o dedup "já avisei hoje?" caírem em
// dias diferentes na janela das 21h–24h → avisos duplicados ou suprimidos.
function toDateOnly(date) {
  return todayISO(new Date(date)); // YYYY-MM-DD no fuso de operação
}

function startOfToday() {
  return startOfTodayInTZ();
}

function templateFor(notificationType) {
  return TYPE_TEMPLATE[notificationType] || 'generic';
}

// Resolve o contato de uma pessoa para o canal (snapshot no momento do envio).
function contactForPerson(person, channel) {
  if (!person) return null;
  if (channel === 'email') return person.email || null;
  return person.whatsapp || person.phonePrimary || null;
}

// Reconstrói vars de renderização a partir da própria linha (usado no retry,
// onde o payload original com as vars já não existe).
function varsFromRecord(notification) {
  return {
    titulo: notification.subject || 'Notificação',
    mensagem: notification.message || '',
    nome: '',
  };
}

async function loadTenant(tenantId) {
  try {
    return await Tenant.findByPk(tenantId);
  } catch {
    return null; // white label é best-effort — cai no navy padrão
  }
}

// Monta a linha Notification a partir de um input de notify/notifyMany.
function buildRow(input, resolvedContact) {
  const channel = input.channel || 'whatsapp';
  return {
    tenantId: input.tenantId,
    recipientPersonId: input.personId || null,
    recipientUserId: input.recipientUserId || null,
    channel,
    notificationType: input.notificationType,
    recipientContact: resolvedContact || '',
    subject: input.subject || null,
    // message é NOT NULL no model — sempre garantir texto.
    message:
      input.message ||
      input.subject ||
      (input.vars && (input.vars.mensagem || input.vars.titulo)) ||
      '(sem conteúdo)',
    referenceType: input.referenceType || null,
    referenceId: input.referenceId || null,
    status: 'enfileirada',
    scheduledFor: input.scheduledFor || null,
  };
}

// ---------------------------------------------------------------------------
// dispatch — núcleo de envio de UMA notificação
// ---------------------------------------------------------------------------
/**
 * Envia a notificação `id`. Idempotente: se já 'enviada'/'entregue'/'lida',
 * é no-op. Em falha, marca 'falha' + errorMessage e RELANÇA — assim o BullMQ
 * aplica attempts/backoff; no fallback síncrono quem chama swallow-a (notify).
 *
 * @param {object} payload { id, template?, vars? }
 */
async function dispatchOne(payload) {
  const { id } = payload;
  const notification = await Notification.findByPk(id);
  if (!notification) return; // linha sumiu — nada a fazer

  // Idempotência: não reenvia o que já saiu.
  if (['enviada', 'entregue', 'lida'].includes(notification.status)) return;

  if (!notification.recipientContact) {
    // Falha permanente — não adianta retry.
    await notification.update({ status: 'falha', errorMessage: 'Sem contato' });
    return;
  }

  try {
    if (notification.channel === 'email') {
      const email = getEmailProvider();
      if (!email) throw new Error('Provider de e-mail indisponível');

      // PLATAFORMA (super_admin): marca AZUL (Eterniza) + remetente da plataforma
      // (Resend), sem cor/SMTP da cidade. CIDADE: marca e SMTP próprios.
      const isPlatform = Boolean(payload.platform);
      const tenant = isPlatform ? null : await loadTenant(notification.tenantId);
      const template = payload.template || templateFor(notification.notificationType);
      const vars = payload.vars || varsFromRecord(notification);
      const rendered = renderEmail(template, vars, { tenant });

      // SMTP DA CIDADE (em claro, server-side); sem config → driver mock/log.
      // Disparo de plataforma força o remetente global (não usa SMTP da cidade).
      const config = isPlatform ? null : await integrationConfig(notification.tenantId);
      const tenantSmtp = config ? config.smtp : null;
      const driverName = email.resolveDriver ? email.resolveDriver(tenantSmtp).name : 'email';

      console.log(
        `[email] enviando → ${notification.recipientContact} | template=${template} | driver=${driverName} | plataforma=${isPlatform}`
      );
      try {
        const { providerMessageId } = await email.sendEmail(tenantSmtp, {
          to: notification.recipientContact,
          subject: notification.subject || rendered.subject,
          html: rendered.html,
          text: rendered.text,
        });
        console.log(`[email] OK → ${notification.recipientContact} | driver=${driverName} | id=${providerMessageId}`);
        await notification.update({
          status: 'enviada',
          sentAt: new Date(),
          provider: driverName,
          providerMessageId,
        });
      } catch (sendErr) {
        console.error(
          `[email] FALHA → ${notification.recipientContact} | driver=${driverName} | erro: ${sendErr.message}`
        );
        throw sendErr;
      }
    } else {
      // whatsapp (sms cai aqui por ora — mesmo canal textual). Usa a instância
      // Evolution DA CIDADE. Falha (desconectado/sem Evolution) é AMIGÁVEL e
      // permanente: marca 'falha' e RETORNA sem relançar → não churn na fila.
      const tenant = await loadTenant(notification.tenantId);

      // Renderiza o template de WhatsApp DA CIDADE (mesmo template/vars do e-mail).
      // Sem template/vars válidos (avulsa) → fallback para o texto cru da linha.
      let text = notification.message;
      try {
        const template = payload.template || templateFor(notification.notificationType);
        const vars = payload.vars || varsFromRecord(notification);
        const rendered = renderWhatsapp(template, vars, { tenant });
        if (rendered && rendered.trim()) text = rendered;
      } catch (renderErr) {
        console.warn('[notifications] render WhatsApp falhou, usando texto cru:', renderErr.message);
      }

      try {
        const { providerMessageId } = await whatsappProvider.sendText(
          tenant,
          notification.recipientContact,
          text
        );
        await notification.update({
          status: 'enviada',
          sentAt: new Date(),
          provider: whatsappProvider.name,
          providerMessageId,
        });
      } catch (waErr) {
        await notification.update({
          status: 'falha',
          errorMessage:
            'WhatsApp indisponível para esta cidade (instância desconectada ou não configurada).',
        });
        console.warn('[notifications] envio WhatsApp falhou:', waErr.message);
        return; // não relança: a fila não é derrubada por WhatsApp desconectado
      }
    }
  } catch (err) {
    await notification.update({
      status: 'falha',
      errorMessage: err.message || 'Falha no envio',
    });
    throw err; // deixa a fila reter (attempts/backoff)
  }
}

// Handler de job único — relança para o BullMQ reter.
async function dispatchHandler(payload) {
  return dispatchOne(payload);
}

// Handler de LOTE — processa item a item; um item que falha NÃO aborta o lote
// (ele fica 'falha' e pode ser reprocessado via endpoint /:id/retry).
async function dispatchBatchHandler({ items = [] }) {
  let sent = 0;
  let failed = 0;
  for (const item of items) {
    try {
      await dispatchOne(item);
      sent += 1;
    } catch {
      failed += 1; // status já persistido como 'falha' por dispatchOne
    }
  }
  return { sent, failed };
}

// ---------------------------------------------------------------------------
// notify — cria a linha e ENFILEIRA o dispatch (nunca envia no request)
// ---------------------------------------------------------------------------
/**
 * @param {object} input {
 *   tenantId, personId?, recipientUserId?, contact?, channel('whatsapp'|'email'),
 *   notificationType, subject?, message?, template?, vars?,
 *   referenceType?, referenceId?, scheduledFor?
 * }
 * @returns {Promise<Notification>} a linha criada (status 'enfileirada' ou já
 *   atualizado pelo fallback síncrono). Contrato: NUNCA rejeita.
 */
async function notify(input) {
  const channel = input.channel || 'whatsapp';

  // Resolve o contato quando não veio explícito.
  let contact = input.contact || null;
  if (!contact && input.personId) {
    const person = await Person.findOne({
      where: { id: input.personId, tenantId: input.tenantId },
    });
    contact = contactForPerson(person, channel);
  }

  const notification = await Notification.create(buildRow({ ...input, channel }, contact));

  const template = input.template || templateFor(input.notificationType);
  const vars = input.vars || varsFromRecord(notification);

  // Enfileira o envio. No fallback síncrono, dispatchOne roda aqui e pode
  // relançar em falha — swallow para honrar o contrato "notify nunca rejeita"
  // (o status de falha já ficou persistido na linha).
  try {
    await enqueue(
      QUEUE,
      JOB_DISPATCH,
      // `platform:true` → disparo da PLATAFORMA (super_admin): marca AZUL +
      // remetente da plataforma (Resend), ignorando a cor/SMTP da cidade.
      { id: notification.id, template, vars, platform: Boolean(input.platform) },
      dispatchHandler
    );
  } catch (err) {
    console.error('[notifications] dispatch síncrono falhou:', err.message);
  }

  return notification;
}

// ---------------------------------------------------------------------------
// notifyMany — BULK correto (bulkCreate em chunks + jobs de lote)
// ---------------------------------------------------------------------------
/**
 * @param {Array<object>} inputs mesma forma de `notify`
 * @returns {Promise<{ created:number, chunks:number }>}
 */
async function notifyMany(inputs) {
  if (!Array.isArray(inputs) || inputs.length === 0) {
    return { created: 0, chunks: 0 };
  }

  // Resolve contatos em LOTE: uma só query para todos os personId sem contact.
  const idsToResolve = [
    ...new Set(
      inputs
        .filter((i) => !i.contact && i.personId)
        .map((i) => i.personId)
    ),
  ];
  const personById = new Map();
  if (idsToResolve.length) {
    // Agrupa por tenant para respeitar o escopo multi-tenant.
    const tenantIds = [...new Set(inputs.map((i) => i.tenantId))];
    const people = await Person.findAll({
      where: { id: { [Op.in]: idsToResolve }, tenantId: { [Op.in]: tenantIds } },
      attributes: ['id', 'tenantId', 'email', 'whatsapp', 'phonePrimary'],
    });
    for (const p of people) personById.set(`${p.tenantId}:${p.id}`, p);
  }

  // Monta linhas + o contexto de render por linha (template/vars).
  const rows = [];
  const renderCtx = []; // paralelo a rows: { template, vars }
  for (const input of inputs) {
    const channel = input.channel || 'whatsapp';
    let contact = input.contact || null;
    if (!contact && input.personId) {
      const p = personById.get(`${input.tenantId}:${input.personId}`);
      contact = contactForPerson(p, channel);
    }
    rows.push(buildRow({ ...input, channel }, contact));
    renderCtx.push({
      template: input.template || templateFor(input.notificationType),
      vars: input.vars || null,
    });
  }

  // bulkCreate + enfileira em CHUNKS — nunca N conexões, nunca trava o request.
  let created = 0;
  let chunks = 0;
  for (let i = 0; i < rows.length; i += BULK_CHUNK) {
    const rowChunk = rows.slice(i, i + BULK_CHUNK);
    const ctxChunk = renderCtx.slice(i, i + BULK_CHUNK);
    const inserted = await Notification.bulkCreate(rowChunk, { returning: true });
    created += inserted.length;
    chunks += 1;

    const items = inserted.map((n, idx) => ({
      id: n.id,
      template: ctxChunk[idx].template,
      vars: ctxChunk[idx].vars || varsFromRecord(n),
    }));

    // Um job de lote por chunk (dispatch-batch swallow-a falhas item a item).
    try {
      await enqueue(QUEUE, JOB_DISPATCH_BATCH, { items }, dispatchBatchHandler);
    } catch (err) {
      console.error('[notifications] dispatch-batch síncrono falhou:', err.message);
    }
  }

  return { created, chunks };
}

// ---------------------------------------------------------------------------
// retry — reenfileira uma notificação em 'falha'
// ---------------------------------------------------------------------------
async function retry(tenantId, id) {
  const notification = await Notification.findOne({ where: { id, tenantId } });
  if (!notification) throw AppError.notFound('Notificação não encontrada.');
  if (notification.status !== 'falha') {
    throw AppError.badRequest(
      'Só é possível reenviar notificações em falha.',
      'NOTIFICATION_NOT_FAILED'
    );
  }

  await notification.update({ status: 'enfileirada', errorMessage: null });

  const template = templateFor(notification.notificationType);
  const vars = varsFromRecord(notification);
  try {
    await enqueue(
      QUEUE,
      JOB_DISPATCH,
      { id: notification.id, template, vars },
      dispatchHandler
    );
  } catch (err) {
    console.error('[notifications] retry síncrono falhou:', err.message);
  }

  return notification.reload();
}

// ---------------------------------------------------------------------------
// notifyPerson — WRAPPER backward-compatible (payments/schedules/billings)
// ---------------------------------------------------------------------------
/**
 * Mantém a assinatura antiga EXATA. Contrato: nunca rejeita; retorna a linha
 * criada ou null em erro inesperado.
 */
async function notifyPerson({
  tenantId,
  personId,
  notificationType,
  message,
  subject = null,
  referenceType = null,
  referenceId = null,
  channel = 'whatsapp',
}) {
  try {
    return await notify({
      tenantId,
      personId,
      channel,
      notificationType,
      subject,
      message,
      referenceType,
      referenceId,
      // e-mail: usa o template do tipo + vars genéricas a partir de subject/message
      template: channel === 'email' ? templateFor(notificationType) : null,
      vars:
        channel === 'email'
          ? { titulo: subject || 'Notificação', mensagem: message, nome: '' }
          : null,
    });
  } catch (err) {
    console.error('[notifications] notifyPerson falhou:', err.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Segmentos (para POST /bulk com { segment })
// ---------------------------------------------------------------------------
// Coleta inputs de notificação para os pagadores com cobranças vencidas.
async function overdueBillingInputs(tenantId, overrides = {}) {
  const today = toDateOnly(new Date());
  const where = {
    dueDate: { [Op.lt]: today },
    status: { [Op.in]: ['em_atraso', 'pendente'] },
  };
  if (tenantId) where.tenantId = tenantId;

  const billings = await Billing.findAll({
    where,
    limit: SCAN_LIMIT,
    include: [
      {
        model: Person,
        as: 'payer',
        attributes: ['id', 'fullName', 'email', 'whatsapp', 'phonePrimary'],
      },
      { model: Grave, as: 'grave', attributes: ['id', 'code'] },
    ],
  });

  const notificationType = overrides.notificationType || 'cobranca_vencida';
  const template = overrides.template || templateFor(notificationType);

  return { billings, inputs: billings.map((b) => billingToInput(b, notificationType, template, overrides)) };
}

function billingToInput(b, notificationType, template, overrides = {}) {
  const payer = b.payer;
  const channel = overrides.channel || (payer && payer.email ? 'email' : 'whatsapp');
  const jazigo = b.grave ? b.grave.code : '';
  const valor = `R$ ${b.totalAmount}`;
  const defaultMessage = `Sua cobrança${b.description ? ` (${b.description})` : ''} de ${valor} venceu em ${b.dueDate}. Regularize para evitar bloqueio de serviços.`;
  return {
    tenantId: b.tenantId,
    personId: payer ? payer.id : null,
    channel,
    notificationType,
    subject: overrides.subject || `Cobrança vencida${jazigo ? ` · jazigo ${jazigo}` : ''}`,
    message: overrides.message || defaultMessage,
    template,
    vars: overrides.vars || {
      nome: payer ? payer.fullName : '',
      jazigo,
      valor,
      vencimento: b.dueDate,
      titulo: 'Cobrança vencida',
      mensagem: overrides.message || defaultMessage,
    },
    referenceType: 'billing',
    referenceId: b.id,
  };
}

const SEGMENTS = {
  async inadimplentes(tenantId, overrides) {
    const { inputs } = await overdueBillingInputs(tenantId, overrides);
    return inputs.filter((i) => i.personId);
  },
};

/**
 * Dispara para um SEGMENTO nomeado (ex.: 'inadimplentes'). Retorna a contagem.
 */
async function notifySegment(tenantId, segment, overrides = {}) {
  const resolver = SEGMENTS[segment];
  if (!resolver) {
    throw AppError.badRequest(`Segmento desconhecido: '${segment}'.`, 'UNKNOWN_SEGMENT');
  }
  const inputs = await resolver(tenantId, overrides);
  return notifyMany(inputs);
}

// ---------------------------------------------------------------------------
// AGENDADOR — jobs de automação por tempo (repeatable)
// ---------------------------------------------------------------------------
// JANELA/SILÊNCIO POR CIDADE (leve). O cron dispara GLOBAL (mesmo horário p/
// todas as cidades); aqui a cidade pode ajustar via `tenant.settings.notifications`:
//   { horario: "09:00", silencio: false }
//  - silencio=true  → a cidade não recebe NADA neste scan.
//  - horario "HH:MM" → só dispara quando a HORA atual do scan == HH (janela por
//    cidade). Sem horario → usa o horário global do cron (não filtra).
// Cidade sem config → comportamento atual (default global). Sem quebrar o scheduler.
// DÍVIDA/scaffold: o filtro por hora só surte efeito nos horários em que o cron
// roda (hoje 09:00/09:30); timezone é a do servidor (getHours). Para janelas
// arbitrárias por cidade, o cron precisaria rodar de hora em hora (infra).
async function tenantNotifyPrefs(tenantIds) {
  const ids = [...new Set((tenantIds || []).filter(Boolean))];
  const map = new Map();
  if (!ids.length) return map;
  const tenants = await Tenant.findAll({
    where: { id: { [Op.in]: ids } },
    attributes: ['id', 'settings'],
  });
  for (const t of tenants) {
    const n = (t.settings && t.settings.notifications) || {};
    map.set(t.id, {
      silencio: Boolean(n.silencio),
      horario: typeof n.horario === 'string' ? n.horario : null,
    });
  }
  return map;
}

// Aplica silêncio/janela por cidade a uma lista de inputs de scan agendado.
function applyTenantSchedule(inputs, prefs, now = new Date()) {
  // hora NO FUSO DE OPERAÇÃO: com getHours() num processo UTC, a cidade que
  // configurou "09:00" nunca disparava (às 9h no Brasil o servidor marca 12).
  const currentHour = hourInTZ(now);
  return inputs.filter((i) => {
    const p = prefs.get(i.tenantId);
    if (!p) return true; // cidade sem config → default global
    if (p.silencio) return false; // cidade em silêncio → não dispara
    if (p.horario) {
      const hh = parseInt(String(p.horario).split(':')[0], 10);
      if (Number.isInteger(hh) && hh !== currentHour) return false; // fora da janela
    }
    return true;
  });
}

// Filtra inputs pelas preferências (silêncio/janela) das cidades envolvidas.
async function withinTenantSchedule(inputs) {
  if (!inputs.length) return inputs;
  const prefs = await tenantNotifyPrefs(inputs.map((i) => i.tenantId));
  return applyTenantSchedule(inputs, prefs);
}

// scan-vencidos: cobranças vencidas cujo pagador ainda não foi avisado HOJE.
async function scanVencidos(payload = {}) {
  const { billings, inputs } = await overdueBillingInputs(payload.tenantId || null, {});
  if (!billings.length) return { scanned: 0, notified: 0 };

  // Dedup: quem já recebeu cobranca_vencida desta cobrança hoje?
  const already = await Notification.findAll({
    where: {
      notificationType: 'cobranca_vencida',
      referenceType: 'billing',
      referenceId: { [Op.in]: billings.map((b) => b.id) },
      createdAt: { [Op.gte]: startOfToday() },
    },
    attributes: ['referenceId'],
  });
  const alreadySet = new Set(already.map((n) => n.referenceId));

  const pending = inputs.filter((i) => i.personId && !alreadySet.has(i.referenceId));
  // Respeita silêncio/janela por cidade (leve).
  const allowed = await withinTenantSchedule(pending);
  if (!allowed.length) return { scanned: billings.length, notified: 0 };

  const res = await notifyMany(allowed);
  return { scanned: billings.length, notified: res.created };
}

// scan-vencimentos: taxas de manutenção a vencer nos próximos X dias.
async function scanVencimentos(payload = {}) {
  const days = payload.days || 5;
  const today = toDateOnly(new Date());
  const limit = toDateOnly(new Date(Date.now() + days * 86400000));

  const where = {
    status: 'ativa',
    nextDueDate: { [Op.ne]: null, [Op.gte]: today, [Op.lte]: limit },
  };
  if (payload.tenantId) where.tenantId = payload.tenantId;

  const fees = await MaintenanceFee.findAll({
    where,
    limit: SCAN_LIMIT,
    include: [
      {
        model: Person,
        as: 'payer',
        attributes: ['id', 'fullName', 'email', 'whatsapp', 'phonePrimary'],
      },
      { model: Grave, as: 'grave', attributes: ['id', 'code'] },
    ],
  });
  if (!fees.length) return { scanned: 0, notified: 0 };

  const already = await Notification.findAll({
    where: {
      notificationType: 'vencimento_taxa',
      referenceType: 'maintenance_fee',
      referenceId: { [Op.in]: fees.map((f) => f.id) },
      createdAt: { [Op.gte]: startOfToday() },
    },
    attributes: ['referenceId'],
  });
  const alreadySet = new Set(already.map((n) => n.referenceId));

  const inputs = [];
  for (const f of fees) {
    if (alreadySet.has(f.id)) continue;
    const payer = f.payer;
    if (!payer) continue;
    const channel = payer.email ? 'email' : 'whatsapp';
    const contact = contactForPerson(payer, channel);
    if (!contact) continue;
    const jazigo = f.grave ? f.grave.code : '';
    const valor = `R$ ${f.amount}`;
    const message = `Sua taxa${jazigo ? ` do jazigo ${jazigo}` : ''} de ${valor} vence em ${f.nextDueDate}.`;
    inputs.push({
      tenantId: f.tenantId,
      personId: payer.id,
      channel,
      notificationType: 'vencimento_taxa',
      subject: `Taxa a vencer${jazigo ? ` · jazigo ${jazigo}` : ''}`,
      message,
      template: 'fee-reminder',
      vars: {
        nome: payer.fullName,
        jazigo,
        valor,
        vencimento: f.nextDueDate,
        titulo: 'Taxa a vencer',
        mensagem: message,
      },
      referenceType: 'maintenance_fee',
      referenceId: f.id,
    });
  }
  if (!inputs.length) return { scanned: fees.length, notified: 0 };

  // Respeita silêncio/janela por cidade (leve).
  const allowed = await withinTenantSchedule(inputs);
  if (!allowed.length) return { scanned: fees.length, notified: 0 };

  const res = await notifyMany(allowed);
  return { scanned: fees.length, notified: res.created };
}

// ---------------------------------------------------------------------------
// Registro de handlers (load do módulo) + agendamentos (worker)
// ---------------------------------------------------------------------------
// Registra SEMPRE no load — assim o worker resolve os handlers do registry e o
// fallback síncrono também os encontra.
registerHandler(QUEUE, JOB_DISPATCH, dispatchHandler);
registerHandler(QUEUE, JOB_DISPATCH_BATCH, dispatchBatchHandler);
registerHandler(QUEUE, JOB_SCAN_VENCIDOS, scanVencidos);
registerHandler(QUEUE, JOB_SCAN_VENCIMENTOS, scanVencimentos);

// Padrões cron (BullMQ repeat). Sem Redis o cron real NÃO roda — o worker.js
// só liga os agendamentos quando há fila (documentado lá).
const CRON_SCAN_VENCIDOS = process.env.NOTIF_CRON_VENCIDOS || '0 9 * * *'; // 09:00 diário
const CRON_SCAN_VENCIMENTOS = process.env.NOTIF_CRON_VENCIMENTOS || '30 9 * * *'; // 09:30 diário

/**
 * Liga os jobs repetíveis. Idempotente (jobId estável no scheduleRepeatable).
 * Chamado pelo worker.js. Sem Redis, apenas garante os handlers registrados.
 */
async function startSchedulers() {
  await scheduleRepeatable(QUEUE, JOB_SCAN_VENCIDOS, CRON_SCAN_VENCIDOS, scanVencidos);
  await scheduleRepeatable(QUEUE, JOB_SCAN_VENCIMENTOS, CRON_SCAN_VENCIMENTOS, scanVencimentos);
  return { scheduled: [JOB_SCAN_VENCIDOS, JOB_SCAN_VENCIMENTOS] };
}

// ---------------------------------------------------------------------------
// Consultas
// ---------------------------------------------------------------------------
async function list(tenantId, query) {
  const { page, perPage, limit, offset } = getPagination(query, { defaultPerPage: 30 });
  const where = { tenantId };
  if (query.status) where.status = query.status;
  if (query.channel) where.channel = query.channel;
  if (query.notificationType) where.notificationType = query.notificationType;
  if (query.recipientPersonId) where.recipientPersonId = query.recipientPersonId;

  const { rows, count } = await Notification.findAndCountAll({
    where,
    limit,
    offset,
    order: [['createdAt', 'DESC']],
    include: [{ model: Person, as: 'recipientPerson', attributes: ['id', 'fullName'] }],
  });
  return { rows, meta: buildPageMeta(count, page, perPage) };
}

async function getById(tenantId, id) {
  const notification = await Notification.findOne({
    where: { id, tenantId },
    include: [{ model: Person, as: 'recipientPerson', attributes: ['id', 'fullName'] }],
  });
  if (!notification) throw AppError.notFound('Notificação não encontrada.');
  return notification;
}

module.exports = {
  // dispatch (core + wrapper)
  notify,
  notifyMany,
  notifyPerson,
  retry,
  notifySegment,
  // consultas
  list,
  getById,
  // agendador / jobs (expostos para o worker e testes)
  startSchedulers,
  scanVencidos,
  scanVencimentos,
  // constantes úteis
  QUEUE,
  TYPE_TEMPLATE,
};
