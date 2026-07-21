'use strict';

const { Op } = require('sequelize');
const AppError = require('../../utils/app-error');
const { getPagination, buildPageMeta } = require('../../utils/pagination');
const graveEvents = require('../grave-timeline/grave-event.recorder');
const { todayISO } = require('../../utils/date-local');
const {
  sequelize, Billing, MaintenanceFee, Grave, Person, Notification,
} = require('../../models');

// Dias de atraso de uma cobrança a partir do vencimento (>= 0).
function daysOverdue(dueDate) {
  if (!dueDate) return 0;
  const due = new Date(`${String(dueDate).slice(0, 10)}T00:00:00Z`);
  const today = new Date(`${todayISO()}T00:00:00Z`);
  return Math.max(0, Math.round((today - due) / 86400000));
}

// Faixas de aging (regra do PDF): até 30 / 31-90 / 91-180 / +180 dias.
function emptyAgingBuckets() {
  return [
    { label: 'Até 30 dias', min: 0, max: 30, total: 0, count: 0 },
    { label: '31 – 90 dias', min: 31, max: 90, total: 0, count: 0 },
    { label: '91 – 180 dias', min: 91, max: 180, total: 0, count: 0 },
    { label: 'Mais de 180 dias', min: 181, max: Infinity, total: 0, count: 0 },
  ];
}

function bucketForDays(buckets, days) {
  return buckets.find((b) => days >= b.min && days <= b.max) || null;
}

// Última notificação enviada a cada pessoa (para a coluna "Último aviso").
// Uma query agregada para todo o conjunto de pagadores.
async function lastNotifiedByPerson(tenantId, personIds) {
  if (!personIds.length) return new Map();
  const rows = await Notification.findAll({
    where: { tenantId, recipientPersonId: { [Op.in]: personIds } },
    attributes: [
      'recipientPersonId',
      [sequelize.fn('MAX', sequelize.col('created_at')), 'lastAt'],
    ],
    group: ['recipientPersonId'],
    raw: true,
  });
  const map = new Map();
  for (const row of rows) map.set(row.recipientPersonId, row.lastAt);
  return map;
}

// Coleta os graveIds vinculados a um pagador inadimplente: das cobranças em
// atraso + das taxas de manutenção ativas cujo pagador é ele.
async function graveIdsForPayer(tenantId, personId) {
  const [billings, fees] = await Promise.all([
    Billing.findAll({
      where: { tenantId, payerPersonId: personId, status: 'em_atraso' },
      attributes: ['graveId'],
      raw: true,
    }),
    MaintenanceFee.findAll({
      where: { tenantId, payerPersonId: personId, status: 'ativa' },
      attributes: ['graveId'],
      raw: true,
    }),
  ]);
  return [...new Set([...billings, ...fees].map((r) => r.graveId).filter(Boolean))];
}

/**
 * Inadimplência — contrato reutilizado por burials/grave-maintenances:
 *   isGraveDelinquent(tenantId, graveId)  => Promise<boolean>
 *   isPersonDelinquent(tenantId, personId) => Promise<boolean>
 */

// Sepultura inadimplente: cobrança em atraso vinculada diretamente ao jazigo
// OU do pagador de alguma taxa de manutenção ativa do jazigo.
// Fail-open (retorna false em caso de falha para não travar burials/grave-maintenances),
// mas o erro é SEMPRE logado — a falha não pode passar silenciosa.
async function isGraveDelinquent(tenantId, graveId) {
  try {
    const direct = await Billing.count({ where: { tenantId, graveId, status: 'em_atraso' } });
    if (direct > 0) return true;

    const fees = await MaintenanceFee.findAll({
      where: { tenantId, graveId, status: 'ativa' },
      attributes: ['payerPersonId'],
    });
    const payerIds = [...new Set(fees.map((f) => f.payerPersonId))];
    if (!payerIds.length) return false;

    const viaPayer = await Billing.count({
      where: { tenantId, payerPersonId: { [Op.in]: payerIds }, status: 'em_atraso' },
    });
    return viaPayer > 0;
  } catch (err) {
    console.error(`[delinquency] isGraveDelinquent falhou (tenant=${tenantId}, grave=${graveId}) — assumindo adimplente: ${err.message}`);
    return false;
  }
}

async function isPersonDelinquent(tenantId, personId) {
  try {
    const overdue = await Billing.count({
      where: { tenantId, payerPersonId: personId, status: 'em_atraso' },
    });
    return overdue > 0;
  } catch (err) {
    console.error(`[delinquency] isPersonDelinquent falhou (tenant=${tenantId}, person=${personId}) — assumindo adimplente: ${err.message}`);
    return false;
  }
}

// Todas as cobranças em atraso com pagador e sepultura (base do painel/sync)
async function findOverdueBillings(tenantId) {
  return Billing.findAll({
    where: { tenantId, status: 'em_atraso' },
    include: [
      { model: Person, as: 'payer', attributes: ['id', 'fullName', 'cpf', 'whatsapp'] },
      { model: Grave, as: 'grave', attributes: ['id', 'code'] },
    ],
    order: [['dueDate', 'ASC']],
  });
}

// Painel agrupado por devedor — agregação em JS (volume por tenant é pequeno).
// Cada devedor traz: dados do pagador, total/contagem vencidos, jazigos (com
// estado de bloqueio), a lista de cobranças vencidas (para o detalhe) e a data
// do último aviso.
async function getPanel(tenantId, query = {}) {
  const { page, perPage, limit, offset } = getPagination(query, { defaultPerPage: 30 });
  const billings = await findOverdueBillings(tenantId);

  const byPayer = new Map();
  for (const billing of billings) {
    const key = billing.payerPersonId;
    if (!byPayer.has(key)) {
      byPayer.set(key, {
        person: billing.payer
          ? {
            id: billing.payer.id,
            fullName: billing.payer.fullName,
            cpf: billing.payer.cpf,
            whatsapp: billing.payer.whatsapp,
          }
          : { id: key, fullName: null, cpf: null, whatsapp: null },
        overdueCount: 0,
        overdueTotal: 0,
        oldestDueDate: billing.dueDate,
        graves: new Map(), // graveId -> { id, code, isBlocked }
        billings: [],
      });
    }
    const entry = byPayer.get(key);
    entry.overdueCount += 1;
    entry.overdueTotal += parseFloat(billing.totalAmount) || 0;
    if (billing.dueDate < entry.oldestDueDate) entry.oldestDueDate = billing.dueDate;
    if (billing.grave?.id && !entry.graves.has(billing.grave.id)) {
      entry.graves.set(billing.grave.id, { id: billing.grave.id, code: billing.grave.code, isBlocked: false });
    }
    entry.billings.push({
      id: billing.id,
      code: billing.code,
      description: billing.description,
      referencePeriod: billing.referencePeriod,
      dueDate: billing.dueDate,
      daysOverdue: daysOverdue(billing.dueDate),
      totalAmount: billing.totalAmount,
      graveId: billing.graveId,
      graveCode: billing.grave?.code || null,
    });
  }

  const personIds = [...byPayer.keys()];

  // estado de bloqueio dos jazigos citados + último aviso — em lote
  const graveIds = [...new Set([...byPayer.values()].flatMap((e) => [...e.graves.keys()]))];
  const [graves, lastNotified] = await Promise.all([
    graveIds.length
      ? Grave.findAll({ where: { tenantId, id: { [Op.in]: graveIds } }, attributes: ['id', 'isBlocked'], raw: true })
      : [],
    lastNotifiedByPerson(tenantId, personIds),
  ]);
  const blockedById = new Map(graves.map((g) => [g.id, g.isBlocked]));

  const debtors = [...byPayer.values()]
    .map((entry) => {
      const debtorGraves = [...entry.graves.values()].map((g) => ({ ...g, isBlocked: !!blockedById.get(g.id) }));
      return {
        person: entry.person,
        overdueCount: entry.overdueCount,
        overdueTotal: entry.overdueTotal.toFixed(2),
        oldestDueDate: entry.oldestDueDate,
        oldestDaysOverdue: daysOverdue(entry.oldestDueDate),
        graves: debtorGraves,
        blocked: debtorGraves.some((g) => g.isBlocked),
        lastNotifiedAt: lastNotified.get(entry.person.id) || null,
        billings: entry.billings.sort((a, b) => b.daysOverdue - a.daysOverdue),
      };
    })
    .sort((a, b) => parseFloat(b.overdueTotal) - parseFloat(a.overdueTotal));

  return {
    rows: debtors.slice(offset, offset + limit),
    meta: buildPageMeta(debtors.length, page, perPage),
  };
}

async function getSummary(tenantId) {
  const overdue = await Billing.findAll({
    where: { tenantId, status: 'em_atraso' },
    attributes: ['totalAmount', 'payerPersonId', 'dueDate'],
  });
  const pending = await Billing.findAll({
    where: { tenantId, status: 'pendente' },
    attributes: ['totalAmount'],
  });

  const overdueTotal = overdue.reduce((sum, b) => sum + (parseFloat(b.totalAmount) || 0), 0);
  const pendingTotal = pending.reduce((sum, b) => sum + (parseFloat(b.totalAmount) || 0), 0);

  // aging: distribuição do vencido por faixa de atraso
  const buckets = emptyAgingBuckets();
  for (const b of overdue) {
    const bucket = bucketForDays(buckets, daysOverdue(b.dueDate));
    if (bucket) {
      bucket.total += parseFloat(b.totalAmount) || 0;
      bucket.count += 1;
    }
  }
  const aging = buckets.map((b) => ({
    label: b.label,
    minDays: b.min,
    maxDays: Number.isFinite(b.max) ? b.max : null,
    total: b.total.toFixed(2),
    count: b.count,
  }));

  // jazigos bloqueados por inadimplência
  const blockedGraves = await Grave.count({
    where: { tenantId, isBlocked: true, blockedReason: 'Inadimplência' },
  });

  // índice de inadimplência: fração do total a receber que está vencida.
  const totalReceivable = overdueTotal + pendingTotal;
  const delinquencyRate = totalReceivable > 0
    ? (overdueTotal / totalReceivable) * 100
    : 0;

  return {
    overdueBillings: overdue.length,
    overdueTotal: overdueTotal.toFixed(2),
    delinquentPayers: new Set(overdue.map((b) => b.payerPersonId)).size,
    // "a receber (a vencer)" = pendentes ainda não vencidas
    pendingReceivable: pendingTotal.toFixed(2),
    // total geral a receber (pendentes + em atraso) — mantido para compatibilidade
    totalReceivable: totalReceivable.toFixed(2),
    // % do total a receber que está vencido (para o card "Índice de inadimplência")
    delinquencyRate: delinquencyRate.toFixed(1),
    blockedGraves,
    aging,
  };
}

// ---------------------------------------------------------------------------
// Bloqueio/desbloqueio operacional de TODOS os jazigos de um pagador devedor.
// (o botão "Bloquear/Desbloquear jazigos" no detalhe do devedor). Reaproveita
// applyBlock numa única transação → atomicidade.
// ---------------------------------------------------------------------------
async function setPayerBlock(tenantId, personId, { blocked, reason } = {}, userId) {
  const person = await Person.findOne({ where: { id: personId, tenantId }, attributes: ['id'] });
  if (!person) throw AppError.notFound('Pagador não encontrado.');

  const graveIds = await graveIdsForPayer(tenantId, personId);
  if (!graveIds.length) {
    throw AppError.conflict('Nenhum jazigo vinculado a este pagador para bloquear/desbloquear.', 'NO_GRAVES_FOR_PAYER');
  }

  return sequelize.transaction(async (transaction) => {
    const graves = await Grave.findAll({
      where: { tenantId, id: { [Op.in]: graveIds } },
      transaction,
    });
    const affected = [];
    for (const grave of graves) {
      if (Boolean(grave.isBlocked) === Boolean(blocked)) continue; // já no estado desejado
      await applyBlock(
        tenantId,
        grave,
        { blocked, reason: blocked ? reason || 'Inadimplência' : null },
        userId,
        transaction
      );
      affected.push(grave.id);
    }
    return { blocked: Boolean(blocked), affected };
  });
}

// ---------------------------------------------------------------------------
// Notificação — individual (um devedor) e em lote (todos os inadimplentes).
// Reaproveita o módulo de notificações (não bloqueia se ele falhar).
// ---------------------------------------------------------------------------
function notifications() {
  return require('../notifications/notifications.service');
}

async function notifyPayer(tenantId, personId) {
  const person = await Person.findOne({ where: { id: personId, tenantId }, attributes: ['id', 'fullName'] });
  if (!person) throw AppError.notFound('Pagador não encontrado.');

  const overdue = await Billing.findAll({
    where: { tenantId, payerPersonId: personId, status: 'em_atraso' },
    attributes: ['totalAmount'],
  });
  if (!overdue.length) {
    throw AppError.conflict('Pagador não possui cobranças vencidas.', 'NO_OVERDUE_BILLINGS');
  }
  const total = overdue.reduce((sum, b) => sum + (parseFloat(b.totalAmount) || 0), 0);

  const result = await notifications().notifyPerson({
    tenantId,
    personId,
    notificationType: 'cobranca_vencida',
    subject: 'Cobranças vencidas',
    message: `Você possui ${overdue.length} cobrança(s) vencida(s), total de R$ ${total.toFixed(2)}. Regularize para evitar o bloqueio dos serviços do jazigo.`,
  });
  return { notified: !!result, overdueCount: overdue.length, overdueTotal: total.toFixed(2) };
}

async function notifyAll(tenantId) {
  const result = await notifications().notifySegment(tenantId, 'inadimplentes');
  return { notified: result?.created || 0 };
}

// Aplica bloqueio/desbloqueio de um jazigo replicando o efeito de
// graves.service.setBlocked (grave.update + evento na timeline) DENTRO da
// transação recebida. Necessário porque setBlocked abre a própria transação
// (sem CLS não haveria atomicidade) e não aceita `transaction`.
async function applyBlock(tenantId, grave, { blocked, reason }, userId, transaction) {
  await grave.update(
    { isBlocked: Boolean(blocked), blockedReason: blocked ? reason || 'Bloqueio administrativo' : null },
    { transaction }
  );
  await graveEvents.record(
    {
      tenantId,
      graveId: grave.id,
      eventType: blocked ? 'bloqueio' : 'desbloqueio',
      title: blocked ? `Jazigo bloqueado: ${reason || 'sem motivo informado'}` : 'Jazigo desbloqueado',
      userId,
    },
    { transaction }
  );
}

// Sincroniza bloqueio operacional dos jazigos com a situação de inadimplência.
// Bloqueia inadimplentes; desbloqueia só os bloqueados POR inadimplência que regularizaram.
// Todos os bloqueios/desbloqueios ocorrem numa ÚNICA transação → atomicidade
// (ou tudo é aplicado, ou nada; sem estado parcial em caso de falha no meio).
async function syncGraveBlocks(tenantId, userId) {
  // 1) jazigos inadimplentes: cobrança em atraso direta...
  const overdueBillings = await Billing.findAll({
    where: { tenantId, status: 'em_atraso' },
    attributes: ['graveId', 'payerPersonId'],
  });
  const delinquentGraveIds = new Set(overdueBillings.map((b) => b.graveId).filter(Boolean));

  // ...ou via pagador de taxa de manutenção ativa
  const delinquentPayerIds = [...new Set(overdueBillings.map((b) => b.payerPersonId))];
  if (delinquentPayerIds.length) {
    const fees = await MaintenanceFee.findAll({
      where: { tenantId, status: 'ativa', payerPersonId: { [Op.in]: delinquentPayerIds } },
      attributes: ['graveId'],
    });
    for (const fee of fees) delinquentGraveIds.add(fee.graveId);
  }

  return sequelize.transaction(async (transaction) => {
    const blocked = [];
    const unblocked = [];

    // 2) bloqueia inadimplentes ainda não bloqueados
    if (delinquentGraveIds.size) {
      const toBlock = await Grave.findAll({
        where: { tenantId, id: { [Op.in]: [...delinquentGraveIds] }, isBlocked: false },
        transaction,
      });
      for (const grave of toBlock) {
        await applyBlock(tenantId, grave, { blocked: true, reason: 'Inadimplência' }, userId, transaction);
        blocked.push(grave.id);
      }
    }

    // 3) desbloqueia os bloqueados por inadimplência que não estão mais inadimplentes
    const blockedForDelinquency = await Grave.findAll({
      where: { tenantId, isBlocked: true, blockedReason: 'Inadimplência' },
      transaction,
    });
    for (const grave of blockedForDelinquency) {
      if (!delinquentGraveIds.has(grave.id)) {
        await applyBlock(tenantId, grave, { blocked: false }, userId, transaction);
        unblocked.push(grave.id);
      }
    }

    return { blocked, unblocked };
  });
}

module.exports = {
  isGraveDelinquent,
  isPersonDelinquent,
  getPanel,
  getSummary,
  syncGraveBlocks,
  setPayerBlock,
  notifyPayer,
  notifyAll,
};
