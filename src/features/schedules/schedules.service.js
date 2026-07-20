'use strict';

const { Op } = require('sequelize');
const AppError = require('../../utils/app-error');
const graveEvents = require('../grave-timeline/grave-event.recorder');
const { findConflicts, isExclusionConstraintError } = require('./schedules.helper');
const {
  sequelize, Schedule, Cemetery, Chapel, Grave, Deceased, Person,
} = require('../../models');

const SCHEDULE_TYPES = Schedule.rawAttributes.scheduleType.values;
const STATUSES = Schedule.rawAttributes.status.values;

// Transições permitidas: agendado→confirmado→(em_andamento)→concluido;
// o front conclui direto a partir de "confirmado" (o passo em_andamento é
// opcional e continua válido). Qualquer status não-concluído pode ser cancelado.
const STATUS_TRANSITIONS = {
  agendado: ['confirmado', 'cancelado'],
  confirmado: ['em_andamento', 'concluido', 'cancelado'],
  em_andamento: ['concluido', 'cancelado'],
  concluido: [],
  cancelado: ['cancelado'],
};

const CREATE_FIELDS = [
  'scheduleType', 'cemeteryId', 'startsAt', 'endsAt', 'chapelId', 'graveId',
  'deceasedId', 'exhumationId', 'responsiblePersonId', 'title', 'notes',
];
const UPDATE_FIELDS = ['startsAt', 'endsAt', 'chapelId', 'title', 'notes', 'responsiblePersonId'];

// Contrato externo (feature `notifications`, implementada em paralelo) —
// require defensivo para não derrubar o app enquanto ela não existir.
let notificationsService = null;
try {
  notificationsService = require('../notifications/notifications.service');
} catch (_err) {
  notificationsService = null;
}

// Best-effort: notifica o responsável pelo agendamento; nunca propaga erro.
function notifyResponsible(schedule, message) {
  if (!notificationsService || !schedule.responsiblePersonId) return;
  notificationsService
    .notifyPerson({
      tenantId: schedule.tenantId,
      personId: schedule.responsiblePersonId,
      notificationType: 'agendamento',
      subject: 'Agendamento no cemitério',
      message,
      referenceType: 'schedule',
      referenceId: schedule.id,
    })
    .catch(() => {});
}

function parseInterval(startsAt, endsAt) {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw AppError.badRequest('Datas inválidas em startsAt/endsAt.', 'INVALID_DATE');
  }
  if (end <= start) {
    throw AppError.badRequest('endsAt deve ser posterior a startsAt.', 'INVALID_INTERVAL');
  }
  return { start, end };
}

function conflictDetails(conflicts) {
  return conflicts.map((c) => ({
    id: c.id,
    title: c.title,
    scheduleType: c.scheduleType,
    startsAt: c.startsAt,
    endsAt: c.endsAt,
  }));
}

function scheduleConflictError(details) {
  return AppError.conflict(
    'Já existe agendamento na mesma capela ou sepultura neste horário.',
    'SCHEDULE_CONFLICT',
    details
  );
}

async function assertConflictFree(params) {
  const conflicts = await findConflicts(params);
  if (conflicts.length) {
    throw scheduleConflictError(conflictDetails(conflicts));
  }
}

const baseIncludes = [
  { model: Chapel, as: 'chapel', attributes: ['id', 'name', 'code'] },
  { model: Grave, as: 'grave', attributes: ['id', 'code'] },
  { model: Deceased, as: 'deceased', attributes: ['id', 'fullName'] },
  { model: Person, as: 'responsible', attributes: ['id', 'fullName', 'phonePrimary', 'whatsapp', 'email'] },
];

async function list(tenantId, query) {
  // Calendário: from/to obrigatórios; sem eles, limita aos próximos 30 dias.
  const from = query.from ? new Date(query.from) : new Date();
  const to = query.to ? new Date(query.to) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw AppError.badRequest('Parâmetros from/to inválidos.', 'INVALID_DATE');
  }

  const where = {
    tenantId,
    startsAt: { [Op.lt]: to },
    endsAt: { [Op.gt]: from },
  };
  if (query.cemeteryId) where.cemeteryId = query.cemeteryId;
  if (query.chapelId) where.chapelId = query.chapelId;
  if (query.scheduleType) where.scheduleType = query.scheduleType;
  if (query.status) where.status = query.status;

  return Schedule.findAll({ where, order: [['startsAt', 'ASC']], include: baseIncludes });
}

async function getById(tenantId, id, { transaction } = {}) {
  const schedule = await Schedule.findOne({
    where: { id, tenantId },
    include: baseIncludes,
    transaction,
  });
  if (!schedule) throw AppError.notFound('Agendamento não encontrado.');
  return schedule;
}

async function assertChapel(tenantId, chapelId, cemeteryId, transaction) {
  const chapel = await Chapel.findOne({ where: { id: chapelId, tenantId }, transaction });
  if (!chapel) throw AppError.notFound('Capela não encontrada.');
  if (cemeteryId && chapel.cemeteryId !== cemeteryId) {
    throw AppError.badRequest('Capela não pertence ao cemitério informado.', 'CHAPEL_CEMETERY_MISMATCH');
  }
  return chapel;
}

async function create(tenantId, data, userId) {
  const { start, end } = parseInterval(data.startsAt, data.endsAt);

  let schedule;
  try {
    schedule = await sequelize.transaction(async (transaction) => {
    const cemetery = await Cemetery.findOne({ where: { id: data.cemeteryId, tenantId }, transaction });
    if (!cemetery) throw AppError.notFound('Cemitério não encontrado.');

    if (data.chapelId) await assertChapel(tenantId, data.chapelId, cemetery.id, transaction);

    if (data.graveId) {
      const grave = await Grave.findOne({ where: { id: data.graveId, tenantId }, transaction });
      if (!grave) throw AppError.notFound('Sepultura não encontrada.');
    }

    await assertConflictFree({
      tenantId,
      chapelId: data.chapelId || null,
      graveId: data.graveId || null,
      startsAt: start,
      endsAt: end,
      transaction,
    });

    const created = await Schedule.create(
      { ...data, tenantId, startsAt: start, endsAt: end, createdByUserId: userId },
      { transaction }
    );

    if (created.graveId) {
      await graveEvents.record(
        {
          tenantId,
          graveId: created.graveId,
          eventType: 'agendamento',
          title: `Agendamento criado: ${created.scheduleType}${created.title ? ` — ${created.title}` : ''}`,
          referenceType: 'schedule',
          referenceId: created.id,
          metadata: { scheduleType: created.scheduleType, startsAt: created.startsAt, endsAt: created.endsAt },
          occurredAt: new Date(),
          userId,
        },
        { transaction }
      );
    }
    return created;
    });
  } catch (err) {
    // corrida: a constraint de exclusão do banco pegou a sobreposição que o
    // findConflicts (validação rápida em memória) não viu → 409 limpo.
    if (isExclusionConstraintError(err)) throw scheduleConflictError();
    throw err;
  }

  notifyResponsible(
    schedule,
    `Agendamento de ${schedule.scheduleType} registrado para ${new Date(schedule.startsAt).toLocaleString('pt-BR')}.`
  );
  return getById(tenantId, schedule.id);
}

async function update(tenantId, id, data) {
  let updated;
  try {
    updated = await sequelize.transaction(async (transaction) => {
    const schedule = await Schedule.findOne({ where: { id, tenantId }, transaction });
    if (!schedule) throw AppError.notFound('Agendamento não encontrado.');
    if (schedule.status === 'concluido' || schedule.status === 'cancelado') {
      throw AppError.conflict('Agendamento concluído/cancelado não pode ser alterado.', 'SCHEDULE_LOCKED');
    }

    const nextChapelId = data.chapelId !== undefined ? data.chapelId || null : schedule.chapelId;
    if (data.chapelId) await assertChapel(tenantId, data.chapelId, schedule.cemeteryId, transaction);

    const { start, end } = parseInterval(
      data.startsAt !== undefined ? data.startsAt : schedule.startsAt,
      data.endsAt !== undefined ? data.endsAt : schedule.endsAt
    );

    await assertConflictFree({
      tenantId,
      chapelId: nextChapelId,
      graveId: schedule.graveId,
      startsAt: start,
      endsAt: end,
      excludeId: schedule.id,
      transaction,
    });

    await schedule.update({ ...data, chapelId: nextChapelId, startsAt: start, endsAt: end }, { transaction });
    return schedule;
    });
  } catch (err) {
    // corrida: constraint de exclusão do banco garante a não-sobreposição → 409 limpo.
    if (isExclusionConstraintError(err)) throw scheduleConflictError();
    throw err;
  }
  return getById(tenantId, updated.id);
}

// StatCard "Agendados hoje": contagem dos agendamentos de HOJE por tipo, no
// fuso do servidor. Uma única query agrupada (sem N+1). Cancelados não contam.
async function todayCount(tenantId) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  const grouped = await Schedule.findAll({
    where: {
      tenantId,
      status: { [Op.ne]: 'cancelado' },
      startsAt: { [Op.gte]: start, [Op.lt]: end },
    },
    attributes: ['scheduleType', [sequelize.fn('COUNT', sequelize.col('id')), 'total']],
    group: ['scheduleType'],
    raw: true,
  });

  const byType = { velorio: 0, sepultamento: 0, exumacao: 0 };
  let total = 0;
  for (const row of grouped) {
    const n = Number(row.total);
    total += n;
    if (Object.prototype.hasOwnProperty.call(byType, row.scheduleType)) {
      byType[row.scheduleType] = n;
    }
  }
  return { total, byType };
}

async function changeStatus(tenantId, id, status) {
  if (!STATUSES.includes(status)) {
    throw AppError.badRequest(`Status inválido. Permitidos: ${STATUSES.join(', ')}`, 'INVALID_ENUM_VALUE');
  }
  const schedule = await Schedule.findOne({ where: { id, tenantId } });
  if (!schedule) throw AppError.notFound('Agendamento não encontrado.');

  const allowed = STATUS_TRANSITIONS[schedule.status] || [];
  if (!allowed.includes(status)) {
    throw AppError.conflict(
      `Transição de status inválida: ${schedule.status} → ${status}.`,
      'INVALID_STATUS_TRANSITION'
    );
  }

  await schedule.update({ status });

  if (status === 'confirmado') {
    notifyResponsible(
      schedule,
      `Agendamento de ${schedule.scheduleType} confirmado para ${new Date(schedule.startsAt).toLocaleString('pt-BR')}.`
    );
  }
  return getById(tenantId, schedule.id);
}

module.exports = {
  list, getById, create, update, changeStatus, todayCount,
  SCHEDULE_TYPES, CREATE_FIELDS, UPDATE_FIELDS,
};
