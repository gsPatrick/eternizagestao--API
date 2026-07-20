'use strict';

/**
 * Relatórios gerenciais — uma função por relatório, todas com a mesma
 * assinatura: (tenantId, { from, to, cemeteryId }) => { rows, meta? }.
 * `rows` é sempre um array plano de objetos — pronto para JSON ou toCsv().
 */
const { Op } = require('sequelize');
const {
  Grave, GraveStatus, Lot, Street, Block, Cemetery,
  Burial, Deceased, Person, User, Exhumation,
  Payment, Billing, Concession, Schedule, Chapel, ConcessionTransfer,
} = require('../../models');

// Intervalo em campo DATEONLY (strings YYYY-MM-DD)
function dateOnlyRange(from, to) {
  if (!from && !to) return null;
  const range = {};
  if (from) range[Op.gte] = from;
  if (to) range[Op.lte] = to;
  return range;
}

// Intervalo em campo DATE/timestamp — `to` inclui o dia inteiro
function dateTimeRange(from, to) {
  if (!from && !to) return null;
  const range = {};
  if (from) range[Op.gte] = new Date(`${from}T00:00:00`);
  if (to) range[Op.lte] = new Date(`${to}T23:59:59.999`);
  return range;
}

// ---- Ocupação por quadra ----
async function occupancy(tenantId, { cemeteryId } = {}) {
  const where = { tenantId };
  if (cemeteryId) where.cemeteryId = cemeteryId;

  const graves = await Grave.findAll({
    where,
    attributes: ['id'],
    include: [
      { model: GraveStatus, as: 'status', attributes: ['slug'] },
      { model: Cemetery, as: 'cemetery', attributes: ['name'] },
      {
        model: Lot, as: 'lot', attributes: ['id'],
        include: [{
          model: Street, as: 'street', attributes: ['id'],
          include: [{ model: Block, as: 'block' }],
        }],
      },
    ],
  });

  const byBlock = new Map();
  for (const grave of graves) {
    const cemetery = grave.cemetery?.name || '—';
    const block = grave.lot?.street?.block;
    const blockName = block ? (block.name || block.code || '—') : '—';
    const key = `${cemetery}||${blockName}`;
    if (!byBlock.has(key)) {
      byBlock.set(key, { cemetery, block: blockName, totalGraves: 0, occupied: 0, free: 0, other: 0 });
    }
    const line = byBlock.get(key);
    line.totalGraves += 1;
    const slug = grave.status?.slug;
    if (slug === 'ocupada') line.occupied += 1;
    else if (slug === 'livre') line.free += 1;
    else line.other += 1;
  }

  const rows = [...byBlock.values()].sort(
    (a, b) => a.cemetery.localeCompare(b.cemetery) || a.block.localeCompare(b.block)
  );
  return { rows };
}

// ---- Sepultamentos no período ----
async function burials(tenantId, { from, to, cemeteryId } = {}) {
  const where = { tenantId };
  if (cemeteryId) where.cemeteryId = cemeteryId;
  const range = dateOnlyRange(from, to);
  if (range) where.burialDate = range;

  const list = await Burial.findAll({
    where,
    order: [['burialDate', 'DESC']],
    include: [
      { model: Deceased, as: 'deceased', attributes: ['fullName'], paranoid: false },
      { model: Grave, as: 'grave', attributes: ['code'], paranoid: false },
      { model: Cemetery, as: 'cemetery', attributes: ['name'], paranoid: false },
      { model: Person, as: 'declarant', attributes: ['fullName'], paranoid: false },
      { model: User, as: 'registeredBy', attributes: ['name'], paranoid: false },
    ],
  });

  const rows = list.map((b) => ({
    burialDate: b.burialDate,
    deceasedName: b.deceased?.fullName || null,
    graveCode: b.grave?.code || null,
    cemeteryName: b.cemetery?.name || null,
    declarantName: b.declarant?.fullName || null,
    registeredBy: b.registeredBy?.name || null,
  }));
  return { rows };
}

// ---- Exumações no período (por requestDate) ----
async function exhumations(tenantId, { from, to, cemeteryId } = {}) {
  const where = { tenantId };
  if (cemeteryId) where.cemeteryId = cemeteryId;
  const range = dateOnlyRange(from, to);
  if (range) where.requestDate = range;

  const list = await Exhumation.findAll({
    where,
    order: [['requestDate', 'DESC']],
    include: [
      { model: Deceased, as: 'deceased', attributes: ['fullName'], paranoid: false },
      { model: Grave, as: 'grave', attributes: ['code'], paranoid: false },
    ],
  });

  const rows = list.map((e) => ({
    requestDate: e.requestDate,
    performedAt: e.performedAt,
    deceasedName: e.deceased?.fullName || null,
    originGraveCode: e.grave?.code || null,
    destinationType: e.destinationType,
    status: e.status,
  }));
  return { rows };
}

// ---- Receita: pagamentos no período ----
async function revenue(tenantId, { from, to, cemeteryId } = {}) {
  const where = { tenantId };
  const range = dateTimeRange(from, to);
  if (range) where.paidAt = range;

  const billingInclude = {
    model: Billing, as: 'billing',
    attributes: ['description', 'referencePeriod', 'cemeteryId'],
    include: [{ model: Person, as: 'payer', attributes: ['fullName'], paranoid: false }],
  };
  if (cemeteryId) {
    billingInclude.where = { cemeteryId };
    billingInclude.required = true;
  }

  const list = await Payment.findAll({
    where,
    order: [['paidAt', 'DESC']],
    include: [billingInclude],
  });

  let total = 0;
  const rows = list.map((p) => {
    total += parseFloat(p.amountPaid) || 0; // DECIMAL vem como string
    return {
      paidAt: p.paidAt,
      amountPaid: p.amountPaid,
      method: p.method,
      payerName: p.billing?.payer?.fullName || null,
      billingDescription: p.billing?.description || null,
      referencePeriod: p.billing?.referencePeriod || null,
    };
  });
  return { rows, meta: { total: Math.round(total * 100) / 100 } };
}

// ---- Inadimplência: cobranças em atraso ----
async function delinquency(tenantId, { from, to, cemeteryId } = {}) {
  const where = { tenantId, status: 'em_atraso' };
  if (cemeteryId) where.cemeteryId = cemeteryId;
  const range = dateOnlyRange(from, to);
  if (range) where.dueDate = range;

  const list = await Billing.findAll({
    where,
    order: [['dueDate', 'ASC']],
    include: [
      { model: Person, as: 'payer', attributes: ['fullName', 'cpf'], paranoid: false },
      { model: Grave, as: 'grave', attributes: ['code'], paranoid: false },
    ],
  });

  const today = Date.now();
  const rows = list.map((b) => ({
    payerName: b.payer?.fullName || null,
    payerCpf: b.payer?.cpf || null,
    graveCode: b.grave?.code || null,
    dueDate: b.dueDate,
    totalAmount: b.totalAmount,
    daysOverdue: Math.max(0, Math.floor((today - new Date(`${b.dueDate}T00:00:00`)) / 86400000)),
  }));
  return { rows };
}

// ---- Concessões por período de início ----
async function concessions(tenantId, { from, to, cemeteryId } = {}) {
  const where = { tenantId };
  const range = dateOnlyRange(from, to);
  if (range) where.startDate = range;

  const graveInclude = { model: Grave, as: 'grave', attributes: ['code', 'cemeteryId'], paranoid: false };
  if (cemeteryId) {
    graveInclude.where = { cemeteryId };
    graveInclude.required = true;
  }

  const list = await Concession.findAll({
    where,
    order: [['startDate', 'DESC']],
    include: [
      graveInclude,
      { model: Person, as: 'person', attributes: ['fullName'], paranoid: false },
    ],
  });

  const rows = list.map((c) => ({
    contractNumber: c.contractNumber,
    graveCode: c.grave?.code || null,
    personName: c.person?.fullName || null,
    concessionType: c.concessionType,
    startDate: c.startDate,
    endDate: c.endDate,
    status: c.status,
  }));
  return { rows };
}

// ---- Agenda de velórios / agendamentos no período ----
// Sem scheduleType filtra todos; a tela usa scheduleType=velorio.
async function schedules(tenantId, { from, to, cemeteryId, scheduleType } = {}) {
  const where = { tenantId };
  if (cemeteryId) where.cemeteryId = cemeteryId;
  if (scheduleType) where.scheduleType = scheduleType;
  const range = dateTimeRange(from, to);
  if (range) where.startsAt = range;

  const list = await Schedule.findAll({
    where,
    order: [['startsAt', 'ASC']],
    include: [
      { model: Chapel, as: 'chapel', attributes: ['name'], paranoid: false },
      { model: Deceased, as: 'deceased', attributes: ['fullName'], paranoid: false },
      { model: Grave, as: 'grave', attributes: ['code'], paranoid: false },
    ],
  });

  const rows = list.map((s) => ({
    startsAt: s.startsAt,
    endsAt: s.endsAt,
    scheduleType: s.scheduleType,
    title: s.title || null,
    chapelName: s.chapel?.name || null,
    graveCode: s.grave?.code || null,
    deceasedName: s.deceased?.fullName || null,
    status: s.status,
  }));
  return { rows };
}

// ---- Cobranças emitidas × pagas por mês (conversão) ----
async function billingsSummary(tenantId, { from, to, cemeteryId } = {}) {
  const where = { tenantId, status: { [Op.ne]: 'cancelado' } };
  if (cemeteryId) where.cemeteryId = cemeteryId;
  const range = dateTimeRange(from, to);
  if (range) where.createdAt = range;

  const list = await Billing.findAll({
    where,
    attributes: ['createdAt', 'status', 'totalAmount'],
    raw: true,
  });

  const byMonth = new Map();
  for (const b of list) {
    const d = new Date(b.createdAt);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (!byMonth.has(key)) {
      byMonth.set(key, { month: key, issued: 0, paid: 0, issuedAmount: 0, paidAmount: 0 });
    }
    const row = byMonth.get(key);
    const amount = parseFloat(b.totalAmount) || 0; // DECIMAL vem como string
    row.issued += 1;
    row.issuedAmount += amount;
    if (b.status === 'pago') {
      row.paid += 1;
      row.paidAmount += amount;
    }
  }

  const rows = [...byMonth.values()]
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((r) => ({
      month: r.month,
      issued: r.issued,
      paid: r.paid,
      conversionRate: r.issued ? Math.round((r.paid / r.issued) * 1000) / 10 : 0,
      issuedAmount: Math.round(r.issuedAmount * 100) / 100,
      paidAmount: Math.round(r.paidAmount * 100) / 100,
    }));
  return { rows };
}

// ---- Concessões a vencer (por endDate) com dias restantes ----
// Sem período retorna todas as ativas com término definido (exclui perpétuas).
async function expiringConcessions(tenantId, { from, to, cemeteryId } = {}) {
  const where = { tenantId, status: 'ativa' };
  const range = dateOnlyRange(from, to);
  where.endDate = range || { [Op.ne]: null };

  const graveInclude = { model: Grave, as: 'grave', attributes: ['code', 'cemeteryId'], paranoid: false };
  if (cemeteryId) {
    graveInclude.where = { cemeteryId };
    graveInclude.required = true;
  }

  const list = await Concession.findAll({
    where,
    order: [['endDate', 'ASC']],
    include: [
      graveInclude,
      { model: Person, as: 'person', attributes: ['fullName'], paranoid: false },
    ],
  });

  const today = Date.now();
  const rows = list.map((c) => ({
    contractNumber: c.contractNumber,
    graveCode: c.grave?.code || null,
    personName: c.person?.fullName || null,
    concessionType: c.concessionType,
    startDate: c.startDate,
    endDate: c.endDate,
    daysRemaining: c.endDate
      ? Math.floor((new Date(`${c.endDate}T00:00:00`) - today) / 86400000)
      : null,
    status: c.status,
  }));
  return { rows };
}

// ---- Sepultados por localização (quadra), separando ativos e exumados ----
async function deceasedByLocation(tenantId, { cemeteryId } = {}) {
  const where = { tenantId };
  if (cemeteryId) where.cemeteryId = cemeteryId;

  const list = await Burial.findAll({
    where,
    attributes: ['id', 'status'],
    include: [{
      model: Grave, as: 'grave', attributes: ['id'], paranoid: false,
      include: [
        { model: Cemetery, as: 'cemetery', attributes: ['name'], paranoid: false },
        {
          model: Lot, as: 'lot', attributes: ['id'], paranoid: false,
          include: [{
            model: Street, as: 'street', attributes: ['id'], paranoid: false,
            include: [{ model: Block, as: 'block', paranoid: false }],
          }],
        },
      ],
    }],
  });

  const byBlock = new Map();
  for (const b of list) {
    const cemetery = b.grave?.cemetery?.name || '—';
    const block = b.grave?.lot?.street?.block;
    const blockName = block ? (block.name || block.code || '—') : '—';
    const key = `${cemetery}||${blockName}`;
    if (!byBlock.has(key)) {
      byBlock.set(key, { cemetery, block: blockName, active: 0, exhumed: 0, total: 0 });
    }
    const row = byBlock.get(key);
    row.total += 1;
    if (b.status === 'ativo') row.active += 1;
    else row.exhumed += 1; // exumado / transladado
  }

  const rows = [...byBlock.values()].sort(
    (a, b) => a.cemetery.localeCompare(b.cemetery) || a.block.localeCompare(b.block)
  );
  return { rows };
}

// ---- Transferências de titularidade de concessão no período ----
async function transfers(tenantId, { from, to, cemeteryId } = {}) {
  const where = { tenantId };
  const range = dateOnlyRange(from, to);
  if (range) where.transferDate = range;

  const graveInclude = { model: Grave, as: 'grave', attributes: ['code', 'cemeteryId'], paranoid: false };
  if (cemeteryId) {
    graveInclude.where = { cemeteryId };
    graveInclude.required = true;
  }

  const list = await ConcessionTransfer.findAll({
    where,
    order: [['transferDate', 'DESC']],
    include: [
      graveInclude,
      { model: Person, as: 'fromPerson', attributes: ['fullName'], paranoid: false },
      { model: Person, as: 'toPerson', attributes: ['fullName'], paranoid: false },
      { model: Concession, as: 'toConcession', attributes: ['contractNumber'], paranoid: false },
    ],
  });

  const rows = list.map((t) => ({
    transferDate: t.transferDate,
    graveCode: t.grave?.code || null,
    contractNumber: t.toConcession?.contractNumber || null,
    fromPersonName: t.fromPerson?.fullName || null,
    toPersonName: t.toPerson?.fullName || null,
    transferReason: t.transferReason,
    familyRelationship: t.familyRelationship || null,
  }));
  return { rows };
}

module.exports = {
  occupancy, burials, exhumations, revenue, delinquency, concessions,
  schedules, billingsSummary, expiringConcessions, deceasedByLocation, transfers,
};
