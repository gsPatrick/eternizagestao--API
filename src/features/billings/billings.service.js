'use strict';

const crypto = require('crypto');
const { Op } = require('sequelize');
const AppError = require('../../utils/app-error');
const { getPagination, buildPageMeta } = require('../../utils/pagination');
const graveEvents = require('../grave-timeline/grave-event.recorder');
const { resolveDriver } = require('../../providers/payment-gateway');
const { getIntegrationConfig } = require('../tenants/integration-config');
const { computeTotal, nextPeriod, toDateOnly } = require('./billings.helper');
const { nextNumber, nextBlock, formatBilling } = require('../../utils/sequence');
const { todayISO } = require('../../utils/date-local');
const {
  sequelize, Billing, MaintenanceFee, FeeType, Grave, Person, Payment, PaymentGatewayEvent,
} = require('../../models');

const baseIncludes = [
  { model: Person, as: 'payer', attributes: ['id', 'fullName', 'cpf'] },
  { model: Grave, as: 'grave', attributes: ['id', 'code'] },
];

// ---------------------------------------------------------------------------
// Integração com o gateway — POR CIDADE (driver trocável).
// Cada tenant usa a PRÓPRIA conta: resolvemos o driver a partir da config
// (Asaas real quando há apiKey; mock quando não há → dev não quebra). O id da
// billing é gerado antes e vira o externalReference no gateway.
// ---------------------------------------------------------------------------
function mapPayer(payer) {
  if (!payer) return null;
  return {
    id: payer.id,
    fullName: payer.fullName,
    cpf: payer.cpf,
    email: payer.email,
    phone: payer.phonePrimary || payer.phone || null,
  };
}

async function createGatewayCharge(billing, totalAmount, dueDate, payer) {
  const config = await getIntegrationConfig(billing.tenantId);
  const driver = resolveDriver(config.asaas);
  const charge = await driver.createCharge(config.asaas, {
    billingId: billing.id,
    amount: totalAmount,
    dueDate,
    billingType: 'UNDEFINED', // pagador escolhe boleto ou PIX (ambos emitidos)
    description: billing.description || billing.code || `Cobrança ${billing.id}`,
    payer: mapPayer(payer),
  });
  return {
    gatewayProvider: charge.provider || driver.name,
    gatewayChargeId: charge.chargeId,
    boletoBarcode: charge.boleto?.barcode || null,
    boletoDigitableLine: charge.boleto?.digitableLine || null,
    boletoUrl: charge.boleto?.url || null,
    pixQrCode: charge.pix?.qrCode || null,
    pixCopyPaste: charge.pix?.copyPaste || null,
    pixExpiresAt: charge.pix?.expiresAt || null,
  };
}

// Registra a falha de emissão no gateway em PaymentGatewayEvent (auditoria).
// Best-effort: nunca lança — a Billing permanece pendente/reprocessável.
async function recordGatewayFailure(billing, action, message) {
  try {
    const config = await getIntegrationConfig(billing.tenantId);
    await PaymentGatewayEvent.create({
      tenantId: billing.tenantId,
      provider: config.asaas.provider || 'asaas',
      eventType: action, // ex.: 'charge.create.failed'
      billingId: billing.id,
      payload: { billingId: billing.id, action, message },
      status: 'erro',
      errorMessage: message,
      processedAt: new Date(),
    });
  } catch (err) {
    console.error(`[billings] falha ao registrar erro de gateway p/ billing=${billing.id}: ${err.message}`);
  }
}

// Violação de índice único (Sequelize ou Postgres 23505) — usada para tolerar
// corrida na geração em lote quando a nova constraint (maintenance_fee_id,
// reference_period) dispara: a 2ª geração simultânea pula sem erro.
function isUniqueConstraintError(err) {
  return !!err && (
    err.name === 'SequelizeUniqueConstraintError'
    || err.original?.code === '23505'
    || err.parent?.code === '23505'
  );
}

// Cancelamento best-effort no gateway — usado como compensação/limpeza.
// Resolve o driver pela cidade da cobrança (cada tenant tem sua conta).
async function safeCancelCharge(billing) {
  const chargeId = billing?.gatewayChargeId;
  if (!chargeId) return;
  try {
    const config = await getIntegrationConfig(billing.tenantId);
    const driver = resolveDriver(config.asaas);
    await driver.cancelCharge(config.asaas, chargeId);
  } catch (err) {
    // gateway indisponível — nada a desfazer localmente, apenas visibilidade
    console.error(`[billings] falha ao cancelar charge ${chargeId} no gateway: ${err.message}`);
  }
}

// Passo idempotente: cria o charge no gateway DEPOIS do commit da Billing e
// persiste os campos. Se a Billing já tem charge, não recria. Evita "charge
// órfão" (cobrança no gateway sem Billing persistida) — a Billing é a fonte da
// verdade e o charge pode ser reanexado num reprocessamento.
async function attachGatewayCharge(billing, totalAmount, dueDate, payer) {
  if (billing.gatewayChargeId) return billing;
  try {
    const gatewayFields = await createGatewayCharge(billing, totalAmount, dueDate, payer);
    await billing.update(gatewayFields);
  } catch (err) {
    // charge não criado — Billing permanece pendente e reprocessável; melhor do
    // que um charge órfão cobrando sem cobrança persistida no sistema. NÃO
    // bloqueia a emissão (best-effort): loga e registra em PaymentGatewayEvent.
    console.error(`[billings] falha ao criar charge no gateway p/ billing=${billing.id}: ${err.message}`);
    await recordGatewayFailure(billing, 'charge.create.failed', err.message);
  }
  return billing;
}

// Notificação fora da transação — falha nunca afeta a cobrança.
function notifyBillingCreated(billing) {
  try {
    const notifications = require('../notifications/notifications.service');
    notifications
      .notifyPerson({
        tenantId: billing.tenantId,
        personId: billing.payerPersonId,
        notificationType: 'cobranca_gerada',
        subject: 'Nova cobrança gerada',
        message: `Cobrança gerada${billing.description ? `: ${billing.description}` : ''} — R$ ${billing.totalAmount}, vencimento ${billing.dueDate}.`,
        referenceType: 'billing',
        referenceId: billing.id,
      })
      .catch(() => {});
  } catch (err) {
    // módulo de notificações ainda não disponível — segue sem notificar
  }
}

async function list(tenantId, query) {
  const { page, perPage, limit, offset } = getPagination(query, { defaultPerPage: 30 });
  const where = { tenantId };
  if (query.status) where.status = query.status;
  if (query.payerPersonId) where.payerPersonId = query.payerPersonId;
  if (query.graveId) where.graveId = query.graveId;
  if (query.origin) where.origin = query.origin;
  if (query.dueFrom || query.dueTo) {
    where.dueDate = {};
    if (query.dueFrom) where.dueDate[Op.gte] = query.dueFrom;
    if (query.dueTo) where.dueDate[Op.lte] = query.dueTo;
  }

  const { rows, count } = await Billing.findAndCountAll({
    where,
    limit,
    offset,
    order: [['dueDate', 'DESC'], ['createdAt', 'DESC']],
    // payments incluídos p/ a tela exibir baixa automática, método e recibo na lista
    include: [...baseIncludes, { model: Payment, as: 'payments' }],
    distinct: true, // evita contagem inflada pelo JOIN com payments
  });
  return { rows, meta: buildPageMeta(count, page, perPage) };
}

// ---------------------------------------------------------------------------
// Resumo p/ a tela de Cobranças: contadores por status (chips) + totais.
// Aceita os mesmos filtros da listagem (origin, graveId, payerPersonId, dueFrom/dueTo)
// para que os chips/somatórios reflitam o recorte visível.
// ---------------------------------------------------------------------------
async function summary(tenantId, query = {}) {
  const where = { tenantId };
  if (query.payerPersonId) where.payerPersonId = query.payerPersonId;
  if (query.graveId) where.graveId = query.graveId;
  if (query.origin) where.origin = query.origin;
  if (query.dueFrom || query.dueTo) {
    where.dueDate = {};
    if (query.dueFrom) where.dueDate[Op.gte] = query.dueFrom;
    if (query.dueTo) where.dueDate[Op.lte] = query.dueTo;
  }

  const grouped = await Billing.findAll({
    where,
    attributes: [
      'status',
      [sequelize.fn('COUNT', sequelize.col('id')), 'count'],
      [sequelize.fn('COALESCE', sequelize.fn('SUM', sequelize.col('total_amount')), 0), 'total'],
    ],
    group: ['status'],
    raw: true,
  });

  const STATUSES = ['pendente', 'pago', 'em_atraso', 'cancelado', 'estornado'];
  const byStatus = {};
  for (const status of STATUSES) byStatus[status] = { count: 0, total: '0.00' };
  let totalCount = 0;
  for (const row of grouped) {
    const count = Number(row.count) || 0;
    const total = parseFloat(row.total) || 0;
    byStatus[row.status] = { count, total: total.toFixed(2) };
    totalCount += count;
  }

  // Recebido no mês corrente + taxa de baixas automáticas (StatCards da tela).
  // Agregado read-only sobre payments — não toca em nenhuma lógica de baixa.
  const monthStart = `${todayISO().slice(0, 7)}-01`;
  const [monthAgg] = await Payment.findAll({
    where: { tenantId, paidAt: { [Op.gte]: new Date(`${monthStart}T00:00:00.000Z`) } },
    attributes: [
      [sequelize.fn('COALESCE', sequelize.fn('SUM', sequelize.col('amount_paid')), 0), 'received'],
      [sequelize.fn('COUNT', sequelize.col('id')), 'paidCount'],
      [sequelize.fn('COALESCE', sequelize.fn('SUM', sequelize.literal('CASE WHEN is_automatic THEN 1 ELSE 0 END')), 0), 'autoCount'],
    ],
    raw: true,
  });
  const receivedThisMonth = parseFloat(monthAgg?.received) || 0;
  const receivedCount = Number(monthAgg?.paidCount) || 0;
  const autoCount = Number(monthAgg?.autoCount) || 0;
  const autoRatio = receivedCount > 0 ? Math.round((autoCount / receivedCount) * 100) : 0;

  return {
    total: totalCount,
    byStatus,
    pendingTotal: byStatus.pendente.total,
    overdueTotal: byStatus.em_atraso.total,
    overdueCount: byStatus.em_atraso.count,
    receivedThisMonth: receivedThisMonth.toFixed(2),
    receivedCount,
    autoRatio,
  };
}

async function getById(tenantId, id) {
  const billing = await Billing.findOne({
    where: { id, tenantId },
    include: [
      ...baseIncludes,
      { model: Payment, as: 'payments' },
      { model: MaintenanceFee, as: 'maintenanceFee', include: [{ model: FeeType, as: 'feeType' }] },
    ],
  });
  if (!billing) throw AppError.notFound('Cobrança não encontrada.');
  return billing;
}

// ---------------------------------------------------------------------------
// Cobrança avulsa / de serviço
// ---------------------------------------------------------------------------
async function create(tenantId, data, userId) {
  const origin = data.origin || 'avulsa';
  if (!['avulsa', 'servico'].includes(origin)) {
    throw AppError.badRequest("Origem inválida — use 'avulsa' ou 'servico'.", 'INVALID_ORIGIN');
  }

  const payer = await Person.findOne({ where: { id: data.payerPersonId, tenantId } });
  if (!payer) throw AppError.notFound('Pagador não encontrado.');

  let grave = null;
  if (data.graveId) {
    grave = await Grave.findOne({ where: { id: data.graveId, tenantId } });
    if (!grave) throw AppError.notFound('Sepultura não encontrada.');
  }

  const totalAmount = computeTotal({
    amount: data.amount,
    discountAmount: data.discountAmount,
    fineAmount: data.fineAmount,
    interestAmount: data.interestAmount,
  });

  const billingId = crypto.randomUUID();

  // 1) Persiste a Billing (commit) ANTES de tocar no gateway — sem charge órfão.
  const billing = await sequelize.transaction(async (transaction) => {
    // Numeração sequencial concorrência-safe (COB-AAAA-XXXX) sob a MESMA transação:
    // o incremento acontece sob SELECT ... FOR UPDATE (ver utils/sequence).
    const year = new Date().getFullYear();
    const number = await nextNumber({ tenantId, scope: 'billing', year }, { transaction });

    const created = await Billing.create(
      {
        id: billingId,
        tenantId,
        code: formatBilling(number, year),
        cemeteryId: grave ? grave.cemeteryId : null,
        graveId: grave ? grave.id : null,
        payerPersonId: payer.id,
        origin,
        description: data.description || null,
        referencePeriod: data.referencePeriod || null,
        amount: data.amount,
        discountAmount: data.discountAmount || 0,
        fineAmount: data.fineAmount || 0,
        interestAmount: data.interestAmount || 0,
        totalAmount,
        dueDate: data.dueDate,
        status: 'pendente',
      },
      { transaction }
    );

    if (grave) {
      await graveEvents.record(
        {
          tenantId, graveId: grave.id, eventType: 'cobranca',
          title: `Cobrança gerada: ${data.description || origin} — R$ ${totalAmount}`,
          referenceType: 'billing', referenceId: created.id,
          userId,
        },
        { transaction }
      );
    }
    return created;
  });

  // 2) Cria o charge no gateway e persiste os campos (passo idempotente pós-commit).
  await attachGatewayCharge(billing, totalAmount, data.dueDate, payer);

  notifyBillingCreated(billing);
  return billing;
}

// ---------------------------------------------------------------------------
// Geração em lote a partir das taxas de manutenção ativas
// ---------------------------------------------------------------------------
async function generate(tenantId, { until } = {}, userId) {
  const limitDate = until || toDateOnly(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)); // hoje + 30d

  const fees = await MaintenanceFee.findAll({
    where: { tenantId, status: 'ativa', nextDueDate: { [Op.ne]: null, [Op.lte]: limitDate } },
    include: [
      { model: Grave, as: 'grave', attributes: ['id', 'code', 'cemeteryId'] },
      { model: Person, as: 'payer', attributes: ['id', 'fullName', 'cpf', 'email'] },
      { model: FeeType, as: 'feeType', attributes: ['id', 'name'] },
    ],
  });

  // Numeração em massa: reserva UM bloco de códigos (COB-AAAA-XXXX) para todo o
  // lote em uma única atualização travada (nextBlock, SELECT ... FOR UPDATE) — não
  // serializamos linha a linha. `seqCursor` avança só quando uma cobrança é de fato
  // criada, mantendo os códigos densos; números sobrando no bloco (fees puladas ou
  // ao fim) ficam apenas sem uso — gaps são aceitáveis numa numeração de série.
  const year = new Date().getFullYear();
  let seqCursor = 0;
  if (fees.length > 0) {
    const { start } = await sequelize.transaction((transaction) =>
      nextBlock({ tenantId, scope: 'billing', year, count: fees.length }, { transaction })
    );
    seqCursor = start;
  }

  const generated = [];
  for (const fee of fees) {
    const dueDate = fee.nextDueDate;
    const referencePeriod = String(dueDate).slice(0, 7); // YYYY-MM
    const totalAmount = computeTotal({ amount: fee.amount });
    const billingId = crypto.randomUUID();
    const code = formatBilling(seqCursor, year);
    const description = `${fee.feeType?.name || 'Taxa de manutenção'} — ${referencePeriod}`;

    // 1) Gera a Billing sob lock da taxa. Se outra requisição rodar em paralelo,
    //    ela serializa aqui (lock) e/ou colide no índice único
    //    (maintenance_fee_id, reference_period) → capturamos e pulamos sem erro.
    let billing;
    try {
      billing = await sequelize.transaction(async (transaction) => {
        const lockedFee = await MaintenanceFee.findOne({
          where: { id: fee.id, tenantId },
          lock: transaction.LOCK.UPDATE,
          transaction,
        });
        if (!lockedFee) return null; // taxa removida no meio da corrida

        // Idempotência sob lock: já existe cobrança não-cancelada desta taxa neste período?
        const existing = await Billing.findOne({
          where: {
            tenantId,
            maintenanceFeeId: fee.id,
            referencePeriod,
            status: { [Op.ne]: 'cancelado' },
          },
          transaction,
        });
        if (existing) return null;

        const created = await Billing.create(
          {
            id: billingId,
            tenantId,
            code,
            cemeteryId: fee.grave?.cemeteryId || null,
            graveId: fee.graveId,
            maintenanceFeeId: fee.id,
            payerPersonId: fee.payerPersonId,
            origin: 'taxa_manutencao',
            description,
            referencePeriod,
            amount: fee.amount,
            totalAmount,
            dueDate,
            status: 'pendente',
          },
          { transaction }
        );

        // avança o vencimento da taxa ('unica' não recorre → null encerra a régua)
        await lockedFee.update(
          { nextDueDate: toDateOnly(nextPeriod(dueDate, lockedFee.periodicity)) },
          { transaction }
        );

        await graveEvents.record(
          {
            tenantId, graveId: fee.graveId, eventType: 'cobranca',
            title: `Cobrança gerada: ${description} — R$ ${totalAmount}`,
            referenceType: 'billing', referenceId: created.id,
            userId,
          },
          { transaction }
        );
        return created;
      });
    } catch (err) {
      if (isUniqueConstraintError(err)) continue; // corrida: outra req já gerou → pula
      throw err;
    }

    if (!billing) continue; // já existia neste período (código reservado fica sem uso)

    seqCursor += 1; // só consome o número quando a cobrança foi realmente criada

    // 2) charge no gateway após o commit (passo idempotente) — sem charge órfão.
    await attachGatewayCharge(billing, totalAmount, dueDate, fee.payer);

    notifyBillingCreated(billing);
    generated.push(billing.id);
  }

  return { generated: generated.length, billings: generated };
}

// ---------------------------------------------------------------------------
// 2ª via — nova cobrança + cancelamento da origem (reutilizada pelo Portal da Família)
// ---------------------------------------------------------------------------
async function reissue(tenantId, billingId, { dueDate } = {}, userId = null) {
  const original = await Billing.findOne({
    where: { id: billingId, tenantId },
    include: [{ model: Person, as: 'payer', attributes: ['id', 'fullName', 'cpf', 'email'] }],
  });
  if (!original) throw AppError.notFound('Cobrança não encontrada.');
  if (!['pendente', 'em_atraso'].includes(original.status)) {
    throw AppError.conflict('Só é possível emitir 2ª via de cobrança pendente ou em atraso.', 'BILLING_NOT_REISSUABLE');
  }

  const newDueDate = dueDate || toDateOnly(new Date(Date.now() + 5 * 24 * 60 * 60 * 1000)); // hoje + 5d
  const newBillingId = crypto.randomUUID();

  // 1) Persiste a nova cobrança + cancela a origem SOB LOCK (evita 2ª via dupla
  //    em requisições simultâneas) — tudo antes de tocar no gateway.
  const billing = await sequelize.transaction(async (transaction) => {
    const lockedOriginal = await Billing.findOne({
      where: { id: original.id, tenantId },
      lock: transaction.LOCK.UPDATE,
      transaction,
    });
    if (!lockedOriginal || !['pendente', 'em_atraso'].includes(lockedOriginal.status)) {
      // outra requisição já reeimitiu/cancelou a origem entre a leitura e o lock
      throw AppError.conflict('Só é possível emitir 2ª via de cobrança pendente ou em atraso.', 'BILLING_NOT_REISSUABLE');
    }

    // 2ª via é uma nova cobrança → recebe seu próprio número sequencial.
    const year = new Date().getFullYear();
    const number = await nextNumber({ tenantId, scope: 'billing', year }, { transaction });

    const created = await Billing.create(
      {
        id: newBillingId,
        tenantId,
        code: formatBilling(number, year),
        cemeteryId: original.cemeteryId,
        graveId: original.graveId,
        maintenanceFeeId: original.maintenanceFeeId,
        payerPersonId: original.payerPersonId,
        origin: original.origin,
        description: original.description,
        referencePeriod: original.referencePeriod,
        amount: original.amount,
        discountAmount: original.discountAmount,
        fineAmount: original.fineAmount,
        interestAmount: original.interestAmount,
        totalAmount: original.totalAmount,
        dueDate: newDueDate,
        status: 'pendente',
        originalBillingId: original.id,
        reissueCount: lockedOriginal.reissueCount + 1,
      },
      { transaction }
    );

    await lockedOriginal.update({ status: 'cancelado', canceledAt: new Date() }, { transaction });

    if (original.graveId) {
      await graveEvents.record(
        {
          tenantId, graveId: original.graveId, eventType: 'cobranca',
          title: `2ª via de cobrança gerada — R$ ${created.totalAmount}`,
          referenceType: 'billing', referenceId: created.id,
          userId,
        },
        { transaction }
      );
    }
    return created;
  });

  // 2) charge da nova cobrança após o commit (passo idempotente) — sem charge órfão.
  await attachGatewayCharge(billing, original.totalAmount, newDueDate, original.payer);

  // cancelamento do charge da origem é best-effort — a origem já está cancelada no sistema
  await safeCancelCharge(original);

  notifyBillingCreated(billing);
  return billing;
}

async function cancel(tenantId, id, { reason } = {}) {
  const billing = await Billing.findOne({ where: { id, tenantId } });
  if (!billing) throw AppError.notFound('Cobrança não encontrada.');
  if (!['pendente', 'em_atraso'].includes(billing.status)) {
    throw AppError.conflict('Só é possível cancelar cobrança pendente ou em atraso.', 'BILLING_NOT_CANCELABLE');
  }

  await billing.update({
    status: 'cancelado',
    canceledAt: new Date(),
    notes: reason ? [billing.notes, `Cancelamento: ${reason}`].filter(Boolean).join('\n') : billing.notes,
  });

  await safeCancelCharge(billing);
  return billing;
}

// Marca vencidas como em atraso (futuro: job diário em queues/)
async function markOverdue(tenantId) {
  const today = toDateOnly(new Date());
  const [updated] = await Billing.update(
    { status: 'em_atraso' },
    { where: { tenantId, status: 'pendente', dueDate: { [Op.lt]: today } } }
  );
  return { updated };
}

module.exports = { list, summary, getById, create, generate, reissue, cancel, markOverdue };
