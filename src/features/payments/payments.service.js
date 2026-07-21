'use strict';

const crypto = require('crypto');
const { Op } = require('sequelize');
const AppError = require('../../utils/app-error');
const { getPagination, buildPageMeta } = require('../../utils/pagination');
const graveEvents = require('../grave-timeline/grave-event.recorder');
const audit = require('../audit-logs/audit.service');
const gateway = require('../../providers/payment-gateway');
const storage = require('../../providers/storage');
const { asaas: asaasDriver } = require('../../providers/payment-gateway');
const { getIntegrationConfig } = require('../tenants/integration-config');
const {
  sequelize, Payment, Billing, PaymentGatewayEvent, Person,
} = require('../../models');

const PAYMENT_METHODS = ['pix', 'boleto', 'dinheiro', 'cartao_credito', 'cartao_debito', 'transferencia', 'outro'];

// Violação de índice único (Sequelize ou Postgres 23505). Usada para tratar
// webhook/baixa repetidos como no-op idempotente quando a nova constraint dispara.
function isUniqueConstraintError(err) {
  return !!err && (
    err.name === 'SequelizeUniqueConstraintError'
    || err.original?.code === '23505'
    || err.parent?.code === '23505'
  );
}

// Desacopla o processWebhook do Express: aceita { rawBody, signature } OU um req
// (do qual lê SOMENTE req.rawBody e o header de assinatura).
function extractWebhookInput(input = {}) {
  const rawBody = input.rawBody;
  let signature = input.signature;
  if (signature === undefined || signature === null) {
    if (typeof input.get === 'function') {
      signature = input.get('x-webhook-signature');
    } else if (input.headers) {
      signature = input.headers['x-webhook-signature'];
    }
  }
  return { rawBody, signature };
}

// Corpo bruto (Buffer/string) → objeto p/ auditoria; nunca lança.
function rawBodyToJson(rawBody) {
  try {
    if (rawBody == null) return {};
    const str = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody);
    return JSON.parse(str);
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Pós-commit da baixa (manual ou automática): recibo + notificação.
// Falhas aqui NUNCA desfazem o pagamento — tudo best-effort.
// ---------------------------------------------------------------------------
async function afterPaymentConfirmed(payment, billing, userId = null) {
  // recibo via documents — se emitir, grava o número no pagamento (fora da transação)
  try {
    const documents = require('../documents/documents.service');
    const document = await documents.issueDocument({
      tenantId: billing.tenantId,
      documentType: 'recibo',
      data: {
        billingId: billing.id,
        paymentId: payment.id,
        description: billing.description,
        referencePeriod: billing.referencePeriod,
        amountPaid: payment.amountPaid,
        method: payment.method,
        paidAt: payment.paidAt,
      },
      referenceType: 'payment',
      referenceId: payment.id,
      graveId: billing.graveId || null,
      personId: billing.payerPersonId,
      userId,
    });
    if (document?.formattedNumber) {
      await payment.update({ receiptNumber: document.formattedNumber });
    }
  } catch (err) {
    // falha no recibo não desfaz a baixa
  }

  try {
    const notifications = require('../notifications/notifications.service');
    notifications
      .notifyPerson({
        tenantId: billing.tenantId,
        personId: billing.payerPersonId,
        notificationType: 'pagamento_confirmado',
        subject: 'Pagamento confirmado',
        message: `Pagamento confirmado — R$ ${payment.amountPaid}${billing.description ? ` (${billing.description})` : ''}.`,
        referenceType: 'payment',
        referenceId: payment.id,
      })
      .catch(() => {});
  } catch (err) {
    // módulo de notificações ainda não disponível
  }
}

// ---------------------------------------------------------------------------
// Baixa manual
// ---------------------------------------------------------------------------
async function createManual(tenantId, billingId, { paidAt, amountPaid, method, notes } = {}, userId) {
  const billing = await Billing.findOne({ where: { id: billingId, tenantId } });
  if (!billing) throw AppError.notFound('Cobrança não encontrada.');
  if (!['pendente', 'em_atraso'].includes(billing.status)) {
    throw AppError.conflict('Só é possível registrar pagamento de cobrança pendente ou em atraso.', 'BILLING_NOT_PAYABLE');
  }

  const payment = await sequelize.transaction(async (transaction) => {
    const created = await Payment.create(
      {
        tenantId,
        billingId: billing.id,
        paidAt: paidAt || new Date(),
        amountPaid: amountPaid !== undefined && amountPaid !== null && amountPaid !== ''
          ? amountPaid
          : billing.totalAmount,
        method,
        notes: notes || null,
        isAutomatic: false,
        registeredByUserId: userId,
      },
      // skipAudit: o hook genérico logaria 'criacao'; registramos o semântico
      // 'pagamento_manual' explicitamente após a baixa (só baixa MANUAL).
      { transaction, skipAudit: true }
    );

    await billing.update({ status: 'pago' }, { transaction });

    if (billing.graveId) {
      await graveEvents.record(
        {
          tenantId, graveId: billing.graveId, eventType: 'pagamento',
          title: `Pagamento registrado — R$ ${created.amountPaid}`,
          referenceType: 'payment', referenceId: created.id,
          userId,
        },
        { transaction }
      );
    }
    return created;
  });

  await afterPaymentConfirmed(payment, billing, userId);

  // Auditoria semântica — baixa MANUAL (feita por um usuário).
  // A baixa automática (webhook) NÃO passa por aqui e não é auditada assim.
  const billingRef = billing.description || billing.referencePeriod || billing.id;
  audit.record({
    action: 'pagamento_manual',
    entityType: 'Cobrança',
    entityId: billing.id,
    description: `Baixa manual de ${payment.amountPaid} na cobrança ${billingRef}`,
    newData: {
      valor: payment.amountPaid,
      metodo: payment.method,
      recibo: payment.receiptNumber || null,
    },
  });

  return payment;
}

// ---------------------------------------------------------------------------
// BAIXA AUTOMÁTICA — caminho ENDURECIDO reutilizável.
// Dado o PaymentGatewayEvent já registrado, a Billing já localizada e os dados
// normalizados do pagamento, aplica a baixa de forma IDEMPOTENTE e TRANSACIONAL
// (lock + guard + índice único de pagamento automático) e emite recibo/notificação.
// Fonte ÚNICA da baixa automática: usada tanto pelo webhook MOCK quanto pelo Asaas.
// Nunca lança (best-effort no evento); devolve o Payment criado ou null (no-op).
// ---------------------------------------------------------------------------
async function settleBillingFromEvent({ event, billing, paidAt, amountPaid, method, gatewayTransactionId }) {
  // guard rápido (a decisão definitiva é reavaliada SOB LOCK dentro da transação)
  if (billing.status === 'pago') {
    await event.update({ status: 'ignorado', processedAt: new Date() });
    return null;
  }

  let payment;
  try {
    payment = await sequelize.transaction(async (transaction) => {
      // recarrega a cobrança COM LOCK e reavalia o status DENTRO da transação:
      // duas entregas simultâneas do webhook serializam aqui e só a 1ª baixa.
      const locked = await Billing.findOne({
        where: { id: billing.id },
        lock: transaction.LOCK.UPDATE,
        transaction,
      });
      if (!locked || locked.status === 'pago') {
        await event.update({ status: 'ignorado', processedAt: new Date() }, { transaction });
        return null; // já baixada por outra entrega — idempotente
      }

      // confere o valor pago contra o total da cobrança (loga divergência, não bloqueia)
      if (amountPaid !== undefined && amountPaid !== null) {
        const paid = parseFloat(amountPaid);
        const total = parseFloat(locked.totalAmount);
        if (Number.isFinite(paid) && Number.isFinite(total) && paid.toFixed(2) !== total.toFixed(2)) {
          console.warn(
            `[payments] divergência de valor no webhook charge=${gatewayTransactionId}: pago=${paid.toFixed(2)} total=${total.toFixed(2)}`
          );
        }
      }

      const created = await Payment.create(
        {
          tenantId: locked.tenantId,
          billingId: locked.id,
          paidAt: paidAt || new Date(),
          amountPaid: amountPaid || locked.totalAmount,
          method: PAYMENT_METHODS.includes(method) ? method : 'outro',
          gatewayTransactionId: gatewayTransactionId || null,
          isAutomatic: true,
        },
        { transaction }
      );

      await locked.update({ status: 'pago' }, { transaction });

      if (locked.graveId) {
        await graveEvents.record(
          {
            tenantId: locked.tenantId, graveId: locked.graveId, eventType: 'pagamento',
            title: 'Pagamento confirmado (baixa automática)',
            referenceType: 'payment', referenceId: created.id,
          },
          { transaction }
        );
      }

      await event.update({ status: 'processado', processedAt: new Date() }, { transaction });
      return created;
    });
  } catch (err) {
    // índice único em pagamentos automáticos → baixa concorrente já ocorreu: no-op
    if (isUniqueConstraintError(err)) {
      await event.update({ status: 'ignorado', processedAt: new Date() }).catch(() => {});
      return null;
    }
    await event.update({ status: 'erro', errorMessage: err.message }).catch(() => {});
    return null;
  }

  if (!payment) return null; // guard idempotente disparou — nada a notificar
  await afterPaymentConfirmed(payment, billing);
  return payment;
}

// ---------------------------------------------------------------------------
// Webhook do gateway MOCK — baixa automática (compat / dev / simulação).
// Desacoplado do Express: recebe { rawBody, signature } (ou um req do qual lê só
// req.rawBody + header). Sempre responde 200 {received:true}; só assinatura
// inválida vira 401. A baixa é idempotente e transacional (lock + guard).
// ---------------------------------------------------------------------------
async function processWebhook(input) {
  const { rawBody, signature } = extractWebhookInput(input);

  if (!gateway.verifyWebhook(rawBody, signature)) {
    throw AppError.unauthorized('Assinatura do webhook inválida.', 'INVALID_WEBHOOK_SIGNATURE');
  }

  const parsed = gateway.parseWebhookEvent(rawBody);
  const payload = rawBodyToJson(rawBody);

  // payload cru SEMPRE gravado antes de qualquer processamento (auditoria).
  // O índice único em payment_gateway_events pode rejeitar um webhook repetido
  // → tratamos como no-op idempotente (200 sem duplicar).
  let event;
  try {
    event = await PaymentGatewayEvent.create({
      provider: gateway.name,
      payload,
      status: 'recebido',
      eventType: parsed?.eventType || null,
      gatewayChargeId: parsed?.chargeId || null,
    });
  } catch (err) {
    if (isUniqueConstraintError(err)) return { received: true }; // webhook duplicado
    throw err;
  }

  if (!parsed) {
    await event.update({ status: 'ignorado', processedAt: new Date() });
    return { received: true };
  }

  // webhook não tem tenant — a cobrança é localizada pelo chargeId global
  const billing = await Billing.findOne({ where: { gatewayChargeId: parsed.chargeId } });
  if (!billing) {
    await event.update({
      status: 'erro',
      errorMessage: `Cobrança não encontrada para gatewayChargeId=${parsed.chargeId}.`,
      processedAt: new Date(),
    });
    return { received: true };
  }

  await event.update({ tenantId: billing.tenantId, billingId: billing.id });

  if (parsed.eventType !== 'charge.paid') {
    await event.update({ status: 'ignorado', processedAt: new Date() });
    return { received: true };
  }

  await settleBillingFromEvent({
    event,
    billing,
    paidAt: parsed.paidAt,
    amountPaid: parsed.amountPaid,
    method: parsed.method,
    gatewayTransactionId: parsed.chargeId,
  });
  return { received: true };
}

// ---------------------------------------------------------------------------
// Webhook do ASAAS — baixa automática real.
// Autentica pelo header `asaas-access-token` (por cidade `asaas.webhookToken`
// ou global `ASAAS_WEBHOOK_TOKEN`), localiza a cobrança por externalReference
// (=billingId) e, em PAYMENT_RECEIVED/PAYMENT_CONFIRMED, reusa o caminho
// endurecido (settleBillingFromEvent). Registra tudo em PaymentGatewayEvent.
// Sempre 200 {received:true}; só token inválido vira 401.
// ---------------------------------------------------------------------------
async function processAsaasWebhook({ req, rawBody } = {}) {
  const body = rawBodyToJson(rawBody);
  const parsed = asaasDriver.parseWebhookEvent(body);

  // Gate GLOBAL antes de tocar no banco: se ASAAS_WEBHOOK_TOKEN estiver definido,
  // barra imediatamente qualquer request sem o token correto.
  if (process.env.ASAAS_WEBHOOK_TOKEN && !asaasDriver.verifyWebhook(req, null)) {
    throw AppError.unauthorized('Webhook Asaas não autenticado.', 'INVALID_WEBHOOK_TOKEN');
  }

  // payload cru SEMPRE gravado (auditoria). Índice único (provider, charge, event)
  // → webhook repetido é no-op idempotente.
  let event;
  try {
    event = await PaymentGatewayEvent.create({
      provider: 'asaas',
      payload: body,
      status: 'recebido',
      eventType: parsed?.eventType || null,
      gatewayChargeId: parsed?.chargeId || null,
    });
  } catch (err) {
    if (isUniqueConstraintError(err)) return { received: true }; // webhook duplicado
    throw err;
  }

  if (!parsed) {
    await event.update({ status: 'ignorado', processedAt: new Date() });
    return { received: true };
  }

  // localiza a cobrança por externalReference (billingId) e cai no chargeId
  let billing = null;
  if (parsed.externalReference) {
    billing = await Billing.findOne({ where: { id: parsed.externalReference } });
  }
  if (!billing && parsed.chargeId) {
    billing = await Billing.findOne({ where: { gatewayChargeId: parsed.chargeId } });
  }
  if (!billing) {
    await event.update({
      status: 'erro',
      errorMessage: `Cobrança não encontrada (externalReference=${parsed.externalReference}, chargeId=${parsed.chargeId}).`,
      processedAt: new Date(),
    });
    return { received: true };
  }

  await event.update({ tenantId: billing.tenantId, billingId: billing.id });

  // Autenticação POR CIDADE: valida o token contra a config do tenant (ou global).
  const config = await getIntegrationConfig(billing.tenantId);
  if (!asaasDriver.verifyWebhook(req, config.asaas)) {
    await event.update({ status: 'erro', errorMessage: 'asaas-access-token inválido.', processedAt: new Date() });
    throw AppError.unauthorized('Webhook Asaas não autenticado.', 'INVALID_WEBHOOK_TOKEN');
  }

  // só recebimento efetivo baixa a cobrança
  if (!parsed.isPaid) {
    await event.update({ status: 'ignorado', processedAt: new Date() });
    return { received: true };
  }

  await settleBillingFromEvent({
    event,
    billing,
    paidAt: parsed.paidAt,
    amountPaid: parsed.amountPaid,
    method: parsed.method,
    gatewayTransactionId: parsed.chargeId,
  });
  return { received: true };
}

// ---------------------------------------------------------------------------
// Simulação de confirmação do gateway (baixa automática) — botão "Simular
// confirmação" da tela de Cobranças. Ferramenta de DESENVOLVIMENTO.
// Monta um payload 'charge.paid' assinado com o MESMO segredo do webhook e o
// injeta em processWebhook — assim exercita EXATAMENTE o caminho endurecido
// (registro do evento + lock + idempotência), sem duplicar a lógica de baixa.
//
// TRAVA (corrigida): a guarda antiga era `gateway.name !== 'mock'`, e
// `gateway.name` é a constante 'mock' reexportada pelo provider por compat —
// ou seja, NUNCA disparava. Qualquer admin podia dar baixa fictícia numa
// cobrança REAL do Asaas. Agora a verificação resolve o driver DA CIDADE
// (mesma config que billings usa) e, além disso, a simulação é proibida em
// produção — lá baixa só entra por webhook do gateway ou baixa manual auditada.
// ---------------------------------------------------------------------------
function webhookSecretForSimulation() {
  // Mesma resolução do provider (provider/payment-gateway/index.js). Em produção
  // o segredo é obrigatório; a simulação só roda com o driver mock de qualquer forma.
  return process.env.PAYMENT_GATEWAY_WEBHOOK_SECRET || 'dev-payment-webhook-secret';
}

async function simulateGatewayPayment(tenantId, billingId, { method } = {}) {
  // 1) Produção NUNCA simula baixa — nem com driver mock. Dinheiro só entra por
  //    webhook autenticado do gateway ou por baixa manual registrada.
  if (process.env.NODE_ENV === 'production') {
    throw AppError.forbidden(
      'Simulação de confirmação de pagamento é indisponível em produção.',
      'SIMULATION_UNAVAILABLE'
    );
  }

  // 2) Driver REAL da cidade (não a constante de compat do provider): se a
  //    cidade tem Asaas configurado, a cobrança é real e não se simula baixa.
  const config = await getIntegrationConfig(tenantId);
  if (gateway.resolveDriver(config.asaas).name !== 'mock') {
    throw AppError.badRequest(
      'Simulação de gateway disponível apenas quando a cidade não tem gateway real configurado.',
      'SIMULATION_UNAVAILABLE'
    );
  }

  const billing = await Billing.findOne({ where: { id: billingId, tenantId } });
  if (!billing) throw AppError.notFound('Cobrança não encontrada.');
  if (!billing.gatewayChargeId) {
    throw AppError.conflict('Cobrança sem charge no gateway — nada a confirmar.', 'BILLING_WITHOUT_CHARGE');
  }
  if (!['pendente', 'em_atraso'].includes(billing.status)) {
    throw AppError.conflict('Só é possível simular confirmação de cobrança pendente ou em atraso.', 'BILLING_NOT_PAYABLE');
  }

  const rawBody = Buffer.from(JSON.stringify({
    event: 'charge.paid',
    chargeId: billing.gatewayChargeId,
    amountPaid: billing.totalAmount,
    method: PAYMENT_METHODS.includes(method) ? method : 'pix',
    paidAt: new Date().toISOString(),
  }), 'utf8');
  const signature = crypto.createHmac('sha256', webhookSecretForSimulation()).update(rawBody).digest('hex');

  await processWebhook({ rawBody, signature });

  // devolve a cobrança já baixada (status/pagamento atualizados)
  return Billing.findOne({
    where: { id: billing.id, tenantId },
    include: [{ model: Payment, as: 'payments' }],
  });
}

// ---------------------------------------------------------------------------
// Consultas
// ---------------------------------------------------------------------------
async function list(tenantId, query) {
  const { page, perPage, limit, offset } = getPagination(query, { defaultPerPage: 30 });
  const where = { tenantId };
  if (query.method) where.method = query.method;
  if (query.billingId) where.billingId = query.billingId;
  if (query.paidFrom || query.paidTo) {
    where.paidAt = {};
    if (query.paidFrom) where.paidAt[Op.gte] = new Date(query.paidFrom);
    if (query.paidTo) where.paidAt[Op.lte] = new Date(`${query.paidTo}T23:59:59.999Z`);
  }

  const { rows, count } = await Payment.findAndCountAll({
    where, limit, offset, order: [['paidAt', 'DESC']],
    include: [{
      model: Billing, as: 'billing',
      include: [{ model: Person, as: 'payer', attributes: ['id', 'fullName', 'cpf'] }],
    }],
  });
  return { rows, meta: buildPageMeta(count, page, perPage) };
}

async function getById(tenantId, id) {
  const payment = await Payment.findOne({
    where: { id, tenantId },
    include: [{
      model: Billing, as: 'billing',
      include: [{ model: Person, as: 'payer', attributes: ['id', 'fullName', 'cpf'] }],
    }],
  });
  if (!payment) throw AppError.notFound('Pagamento não encontrado.');
  return payment;
}

// Recibo: o PDF é o Document já emitido — devolve número + fileUrl + contexto
async function receipt(tenantId, id) {
  const payment = await getById(tenantId, id);

  let fileUrl = null;
  try {
    const { Document } = require('../../models'); // require lazy do model
    const document = await Document.findOne({
      where: { tenantId, referenceType: 'payment', referenceId: payment.id },
      order: [['issuedAt', 'DESC']],
    });
    // URL ASSINADA (TTL padrão) — o recibo é aberto pelo painel via /files;
    // sem token a rota devolve 403.
    fileUrl = document?.fileUrl ? storage.signedUrl(document.fileUrl) : null;
  } catch (err) {
    // sem documento — recibo pode ainda não ter sido emitido
  }

  return {
    receiptNumber: payment.receiptNumber,
    fileUrl,
    payment,
    billing: payment.billing,
  };
}

module.exports = {
  createManual, processWebhook, processAsaasWebhook, simulateGatewayPayment, list, getById, receipt, PAYMENT_METHODS,
};
