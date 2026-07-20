'use strict';

/**
 * Painel consolidado do tenant — cada bloco de indicadores é uma função
 * independente (ocupação, movimentações, financeiro, inadimplência, concessões).
 * DECIMALs do Postgres chegam como string — sempre parseFloat ao somar.
 */
const { Op } = require('sequelize');
const {
  sequelize, Grave, GraveStatus, Burial, Exhumation,
  Billing, Payment, Concession, Schedule, Chapel, Deceased, Person, AuditLog, User,
} = require('../../models');

const { fn, col } = sequelize;

function pad2(n) {
  return String(n).padStart(2, '0');
}

// Limites do mês/ano correntes — strings YYYY-MM-DD para DATEONLY e Date para DATE.
function currentPeriods() {
  const now = new Date();
  return {
    monthStartStr: `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-01`,
    yearStartStr: `${now.getFullYear()}-01-01`,
    monthStart: new Date(now.getFullYear(), now.getMonth(), 1),
    yearStart: new Date(now.getFullYear(), 0, 1),
  };
}

// ---- Ocupação: total de sepulturas + distribuição por status ----
async function getOccupancy(tenantId, cemeteryId) {
  const where = { tenantId };
  if (cemeteryId) where.cemeteryId = cemeteryId;

  const [total, rows] = await Promise.all([
    Grave.count({ where }),
    Grave.findAll({
      where,
      attributes: [[fn('COUNT', col('Grave.id')), 'count']],
      include: [{ model: GraveStatus, as: 'status', attributes: ['name', 'slug', 'color'] }],
      group: ['status.id'],
      raw: true,
    }),
  ]);

  return {
    total,
    byStatus: rows.map((r) => ({
      statusName: r['status.name'],
      slug: r['status.slug'],
      color: r['status.color'],
      count: parseInt(r.count, 10),
    })),
  };
}

// ---- Movimentações: sepultamentos e exumações no mês/ano correntes ----
async function getMovements(tenantId, cemeteryId) {
  const { monthStartStr, yearStartStr, monthStart, yearStart } = currentPeriods();
  const base = { tenantId };
  if (cemeteryId) base.cemeteryId = cemeteryId;

  const [burialsThisMonth, burialsThisYear, exhumationsThisMonth, exhumationsThisYear] =
    await Promise.all([
      Burial.count({ where: { ...base, burialDate: { [Op.gte]: monthStartStr } } }),
      Burial.count({ where: { ...base, burialDate: { [Op.gte]: yearStartStr } } }),
      Exhumation.count({ where: { ...base, performedAt: { [Op.gte]: monthStart } } }),
      Exhumation.count({ where: { ...base, performedAt: { [Op.gte]: yearStart } } }),
    ]);

  return { burialsThisMonth, burialsThisYear, exhumationsThisMonth, exhumationsThisYear };
}

// ---- Financeiro: recebido no mês, pendente, em atraso ----
async function getFinance(tenantId, cemeteryId) {
  const { monthStart } = currentPeriods();
  const billingBase = { tenantId };
  if (cemeteryId) billingBase.cemeteryId = cemeteryId;

  const [received, pending, overdue] = await Promise.all([
    Payment.findOne({
      attributes: [[fn('SUM', col('Payment.amount_paid')), 'total']],
      where: { tenantId, paidAt: { [Op.gte]: monthStart } },
      include: cemeteryId
        ? [{ model: Billing, as: 'billing', attributes: [], where: { cemeteryId }, required: true }]
        : [],
      raw: true,
    }),
    Billing.findOne({
      attributes: [[fn('SUM', col('total_amount')), 'total']],
      where: { ...billingBase, status: 'pendente' },
      raw: true,
    }),
    Billing.findOne({
      attributes: [
        [fn('SUM', col('total_amount')), 'total'],
        [fn('COUNT', col('id')), 'count'],
      ],
      where: { ...billingBase, status: 'em_atraso' },
      raw: true,
    }),
  ]);

  return {
    receivedThisMonth: parseFloat(received?.total) || 0,
    pendingTotal: parseFloat(pending?.total) || 0,
    overdueTotal: parseFloat(overdue?.total) || 0,
    overdueCount: parseInt(overdue?.count, 10) || 0,
  };
}

// ---- Inadimplência: % de cobranças em atraso sobre as não canceladas ----
async function getDelinquencyRate(tenantId, cemeteryId, overdueCount) {
  const where = { tenantId, status: { [Op.ne]: 'cancelado' } };
  if (cemeteryId) where.cemeteryId = cemeteryId;
  const totalBillings = await Billing.count({ where });
  if (!totalBillings) return 0;
  return Math.round((overdueCount / totalBillings) * 1000) / 10; // 1 casa decimal
}

// ---- Concessões ativas ----
async function getActiveConcessions(tenantId, cemeteryId) {
  return Concession.count({
    where: { tenantId, status: 'ativa' },
    include: cemeteryId
      ? [{ model: Grave, as: 'grave', attributes: [], where: { cemeteryId }, required: true }]
      : [],
  });
}

// ---- Série de receita: soma de pagamentos recebidos por mês (últimos N meses) ----
// Alimenta o gráfico de arrecadação. Preenche meses sem pagamento com 0 para a
// série sair contígua. cemeteryId filtra via join com a cobrança.
async function getRevenueSeries(tenantId, cemeteryId, months = 12) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1);
  const monthExpr = fn('to_char', fn('date_trunc', 'month', col('Payment.paid_at')), 'YYYY-MM');

  const rows = await Payment.findAll({
    attributes: [
      [monthExpr, 'month'],
      [fn('SUM', col('Payment.amount_paid')), 'total'],
    ],
    where: { tenantId, paidAt: { [Op.gte]: start } },
    include: cemeteryId
      ? [{ model: Billing, as: 'billing', attributes: [], where: { cemeteryId }, required: true }]
      : [],
    group: [monthExpr],
    raw: true,
  });

  const totalsByMonth = new Map(rows.map((r) => [r.month, parseFloat(r.total) || 0]));
  const series = [];
  for (let i = 0; i < months; i += 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - (months - 1) + i, 1);
    const key = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
    series.push({ month: key, total: totalsByMonth.get(key) || 0 });
  }
  return series;
}

// ---- Agenda do dia: agendamentos de hoje (velório/sepultamento/exumação) ----
async function getTodaySchedule(tenantId, cemeteryId) {
  const now = new Date();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  const dayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  const where = {
    tenantId,
    status: { [Op.ne]: 'cancelado' },
    startsAt: { [Op.gte]: dayStart, [Op.lte]: dayEnd },
  };
  if (cemeteryId) where.cemeteryId = cemeteryId;

  const list = await Schedule.findAll({
    where,
    order: [['startsAt', 'ASC']],
    include: [
      { model: Chapel, as: 'chapel', attributes: ['name'], paranoid: false },
      { model: Grave, as: 'grave', attributes: ['code'] },
      { model: Deceased, as: 'deceased', attributes: ['fullName'] },
    ],
  });

  return list.map((s) => ({
    id: s.id,
    scheduleType: s.scheduleType,
    title: s.title || s.deceased?.fullName || null,
    startsAt: s.startsAt,
    status: s.status,
    place: s.chapel?.name || s.grave?.code || null,
    deceasedName: s.deceased?.fullName || null,
  }));
}

// ---- Maiores devedores: cobranças em atraso agregadas por pagador ----
async function getTopDebtors(tenantId, cemeteryId, limit = 5) {
  const where = { tenantId, status: 'em_atraso' };
  if (cemeteryId) where.cemeteryId = cemeteryId;

  const billings = await Billing.findAll({
    where,
    attributes: ['id', 'payerPersonId', 'totalAmount', 'graveId'],
    include: [
      { model: Person, as: 'payer', attributes: ['id', 'fullName', 'cpf'] },
      { model: Grave, as: 'grave', attributes: ['id', 'code'] },
    ],
  });

  const byPayer = new Map();
  for (const b of billings) {
    const key = b.payerPersonId;
    if (!byPayer.has(key)) {
      byPayer.set(key, {
        personId: key,
        personName: b.payer?.fullName || null,
        cpf: b.payer?.cpf || null,
        graveCode: b.grave?.code || null,
        overdueTotal: 0,
        overdueCount: 0,
      });
    }
    const row = byPayer.get(key);
    row.overdueTotal += parseFloat(b.totalAmount) || 0; // DECIMAL vem como string
    row.overdueCount += 1;
  }

  return [...byPayer.values()]
    .map((r) => ({ ...r, overdueTotal: Math.round(r.overdueTotal * 100) / 100 }))
    .sort((a, b) => b.overdueTotal - a.overdueTotal)
    .slice(0, limit);
}

// ---- Atividade recente: últimos registros do log de auditoria ----
async function getRecentActivity(tenantId, limit = 8) {
  const logs = await AuditLog.findAll({
    where: { tenantId },
    order: [['createdAt', 'DESC']],
    limit,
    include: [{ model: User, as: 'user', attributes: ['id', 'name'] }],
  });

  return logs.map((l) => ({
    id: l.id,
    action: l.action,
    entityType: l.entityType,
    entityId: l.entityId,
    description: l.description,
    userName: l.user?.name || null,
    createdAt: l.createdAt,
  }));
}

async function getDashboard(tenantId, { cemeteryId } = {}) {
  const [
    occupancy, movements, finance, activeConcessions,
    revenueSeries, todaySchedule, topDebtors, recentActivity,
  ] = await Promise.all([
    getOccupancy(tenantId, cemeteryId),
    getMovements(tenantId, cemeteryId),
    getFinance(tenantId, cemeteryId),
    getActiveConcessions(tenantId, cemeteryId),
    getRevenueSeries(tenantId, cemeteryId),
    getTodaySchedule(tenantId, cemeteryId),
    getTopDebtors(tenantId, cemeteryId),
    getRecentActivity(tenantId),
  ]);
  const delinquencyRate = await getDelinquencyRate(tenantId, cemeteryId, finance.overdueCount);

  return {
    occupancy,
    ...movements,
    finance,
    delinquencyRate,
    activeConcessions,
    revenueSeries,
    todaySchedule,
    topDebtors,
    recentActivity,
  };
}

module.exports = {
  getDashboard, getOccupancy, getMovements, getFinance, getDelinquencyRate, getActiveConcessions,
  getRevenueSeries, getTodaySchedule, getTopDebtors, getRecentActivity,
};
