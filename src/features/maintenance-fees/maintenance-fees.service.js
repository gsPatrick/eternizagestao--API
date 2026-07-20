'use strict';

const { Op } = require('sequelize');
const AppError = require('../../utils/app-error');
const { getPagination, buildPageMeta } = require('../../utils/pagination');
const {
  sequelize, MaintenanceFee, FeeType, Grave, Person, Concession,
} = require('../../models');

const UPDATABLE_FIELDS = ['amount', 'dueDay', 'dueMonth', 'nextDueDate', 'adjustmentNotes', 'notes'];

// Reajuste calculado: valor absoluto (newAmount) OU percentual (percent).
// Retorna o novo valor com 2 casas, ou null quando não há como calcular.
function resolveNewAmount(current, { newAmount, percent } = {}) {
  const base = parseFloat(current);
  if (newAmount !== undefined && newAmount !== null && newAmount !== '') {
    const value = parseFloat(newAmount);
    return Number.isFinite(value) ? Number(value.toFixed(2)) : null;
  }
  if (percent !== undefined && percent !== null && percent !== '') {
    const pct = parseFloat(percent);
    if (!Number.isFinite(pct) || !Number.isFinite(base)) return null;
    return Number((base * (1 + pct / 100)).toFixed(2));
  }
  return null;
}

// Empilha um item de histórico { date, from, to, reason } no topo do array.
function pushAdjustment(fee, { from, to, reason }) {
  const entry = {
    date: new Date().toISOString().slice(0, 10),
    from: Number(parseFloat(from).toFixed(2)),
    to: Number(parseFloat(to).toFixed(2)),
    reason: reason || null,
  };
  const history = Array.isArray(fee.adjustments) ? fee.adjustments : [];
  return [entry, ...history];
}

const baseIncludes = [
  { model: Grave, as: 'grave', attributes: ['id', 'code'] },
  { model: FeeType, as: 'feeType' },
  { model: Person, as: 'payer', attributes: ['id', 'fullName'] },
];

async function list(tenantId, query) {
  const { page, perPage, limit, offset } = getPagination(query, { defaultPerPage: 30 });
  const where = { tenantId };
  if (query.graveId) where.graveId = query.graveId;
  if (query.payerPersonId) where.payerPersonId = query.payerPersonId;
  if (query.status) where.status = query.status;

  const { rows, count } = await MaintenanceFee.findAndCountAll({
    where, limit, offset, order: [['nextDueDate', 'ASC'], ['createdAt', 'DESC']], include: baseIncludes,
  });
  return { rows, meta: buildPageMeta(count, page, perPage) };
}

async function getById(tenantId, id, { includes = baseIncludes } = {}) {
  const fee = await MaintenanceFee.findOne({ where: { id, tenantId }, include: includes });
  if (!fee) throw AppError.notFound('Taxa de manutenção não encontrada.');
  return fee;
}

async function create(tenantId, data) {
  const [grave, feeType, payer] = await Promise.all([
    Grave.findOne({ where: { id: data.graveId, tenantId } }),
    FeeType.findOne({ where: { id: data.feeTypeId, tenantId } }),
    Person.findOne({ where: { id: data.payerPersonId, tenantId } }),
  ]);
  if (!grave) throw AppError.notFound('Sepultura não encontrada.');
  if (!feeType) throw AppError.notFound('Tipo de taxa não encontrado.');
  if (!payer) throw AppError.notFound('Pagador não encontrado.');

  const amount = data.amount !== undefined && data.amount !== null && data.amount !== ''
    ? data.amount
    : feeType.defaultAmount;
  if (amount === undefined || amount === null) {
    throw AppError.badRequest('Informe o valor da taxa (o tipo de taxa não possui valor padrão).', 'AMOUNT_REQUIRED');
  }

  // 1 taxa ativa por tipo em cada sepultura
  const existing = await MaintenanceFee.findOne({
    where: { tenantId, graveId: grave.id, feeTypeId: feeType.id, status: 'ativa' },
  });
  if (existing) {
    throw AppError.conflict('Já existe uma taxa ativa deste tipo para esta sepultura.', 'MAINTENANCE_FEE_ALREADY_ACTIVE');
  }

  // vincula concessão informada ou a ativa da sepultura (quando houver)
  let concessionId = data.concessionId || null;
  if (concessionId) {
    const concession = await Concession.findOne({ where: { id: concessionId, tenantId, graveId: grave.id } });
    if (!concession) throw AppError.notFound('Concessão não encontrada para esta sepultura.');
  } else {
    const active = await Concession.findOne({ where: { tenantId, graveId: grave.id, status: 'ativa' } });
    concessionId = active ? active.id : null;
  }

  const fee = await MaintenanceFee.create({
    tenantId,
    graveId: grave.id,
    feeTypeId: feeType.id,
    concessionId,
    payerPersonId: payer.id,
    amount,
    periodicity: data.periodicity || feeType.periodicity,
    dueDay: data.dueDay || null,
    dueMonth: data.dueMonth || null,
    nextDueDate: data.nextDueDate || null,
    notes: data.notes || null,
  });
  return getById(tenantId, fee.id);
}

async function update(tenantId, id, data) {
  const fee = await getById(tenantId, id, { includes: [] });
  const changes = { ...data };
  if (changes.amount !== undefined && Number(changes.amount) !== Number(fee.amount)) {
    changes.lastAdjustedAt = new Date().toISOString().slice(0, 10); // reajuste registrado
  }
  await fee.update(changes);
  return getById(tenantId, id);
}

// suspender / reativar / encerrar — encerrada é estado final
async function setStatus(tenantId, id, status) {
  const fee = await getById(tenantId, id, { includes: [] });
  if (fee.status === 'encerrada') {
    throw AppError.conflict('Taxa encerrada não pode mudar de status.', 'MAINTENANCE_FEE_TERMINATED');
  }
  await fee.update({ status });
  return getById(tenantId, id);
}

// ---------------------------------------------------------------------------
// Reajuste individual — novo valor (absoluto ou %) + motivo, registrado no histórico.
// ---------------------------------------------------------------------------
async function adjust(tenantId, id, { newAmount, percent, reason } = {}) {
  const fee = await getById(tenantId, id, { includes: [] });
  if (fee.status === 'encerrada') {
    throw AppError.conflict('Taxa encerrada não pode ser reajustada.', 'MAINTENANCE_FEE_TERMINATED');
  }

  const to = resolveNewAmount(fee.amount, { newAmount, percent });
  if (to === null || to < 0) {
    throw AppError.badRequest('Informe um novo valor (newAmount) ou percentual (percent) válido.', 'INVALID_ADJUSTMENT');
  }

  const from = fee.amount;
  await fee.update({
    amount: to,
    lastAdjustedAt: new Date().toISOString().slice(0, 10),
    adjustmentNotes: reason || fee.adjustmentNotes,
    adjustments: pushAdjustment(fee, { from, to, reason }),
  });
  return getById(tenantId, id);
}

// ---------------------------------------------------------------------------
// Reajuste em lote — aplica um índice (%) ou valor às taxas ATIVAS de um tipo.
// dryRun=true devolve apenas a prévia (contagem/amostra) sem gravar.
// Cada reajuste entra no histórico individual da taxa.
// ---------------------------------------------------------------------------
async function batchAdjust(tenantId, { feeTypeId, percent, newAmount, reason, dryRun = false } = {}) {
  if (!feeTypeId) throw AppError.badRequest('Informe o tipo de taxa (feeTypeId).', 'FEE_TYPE_REQUIRED');
  if ((percent === undefined || percent === null || percent === '')
    && (newAmount === undefined || newAmount === null || newAmount === '')) {
    throw AppError.badRequest('Informe o percentual (percent) ou o novo valor (newAmount).', 'INVALID_ADJUSTMENT');
  }

  const feeType = await FeeType.findOne({ where: { id: feeTypeId, tenantId } });
  if (!feeType) throw AppError.notFound('Tipo de taxa não encontrado.');

  const fees = await MaintenanceFee.findAll({
    where: { tenantId, feeTypeId, status: 'ativa' },
  });

  const preview = fees.map((fee) => ({
    id: fee.id,
    from: Number(parseFloat(fee.amount).toFixed(2)),
    to: resolveNewAmount(fee.amount, { newAmount, percent }),
  })).filter((p) => p.to !== null && p.to >= 0);

  if (dryRun) {
    return {
      dryRun: true,
      affected: preview.length,
      sample: preview.slice(0, 5),
    };
  }

  // Grava todas numa transação — ou reajusta o lote inteiro, ou nada.
  const adjusted = await sequelize.transaction(async (transaction) => {
    const ids = [];
    // Recarrega SOB LOCK dentro da transação (evita corrida com reajuste individual).
    const locked = await MaintenanceFee.findAll({
      where: { tenantId, feeTypeId, status: 'ativa', id: { [Op.in]: fees.map((f) => f.id) } },
      lock: transaction.LOCK.UPDATE,
      transaction,
    });
    for (const fee of locked) {
      const to = resolveNewAmount(fee.amount, { newAmount, percent });
      if (to === null || to < 0) continue;
      const from = fee.amount;
      await fee.update({
        amount: to,
        lastAdjustedAt: new Date().toISOString().slice(0, 10),
        adjustmentNotes: reason || fee.adjustmentNotes,
        adjustments: pushAdjustment(fee, { from, to, reason }),
      }, { transaction });
      ids.push(fee.id);
    }
    return ids;
  });

  return { dryRun: false, adjusted: adjusted.length, ids: adjusted };
}

module.exports = { list, getById, create, update, setStatus, adjust, batchAdjust, UPDATABLE_FIELDS };
