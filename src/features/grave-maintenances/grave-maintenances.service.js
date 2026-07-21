'use strict';

const AppError = require('../../utils/app-error');
const { getPagination, buildPageMeta } = require('../../utils/pagination');
const graveEvents = require('../grave-timeline/grave-event.recorder');
const delinquency = require('../delinquency/delinquency.service');
const { todayISO } = require('../../utils/date-local');
const {
  sequelize, GraveMaintenance, Grave, Person,
} = require('../../models');

const CREATE_FIELDS = ['maintenanceType', 'description', 'requestedByPersonId', 'startDate', 'cost'];
const UPDATE_FIELDS = ['description', 'startDate', 'endDate', 'cost', 'performedBy', 'notes'];

// obras estruturais viram evento 'reforma'; o restante, 'manutencao'
const eventTypeFor = (maintenanceType) =>
  ['reforma', 'construcao'].includes(maintenanceType) ? 'reforma' : 'manutencao';

const VALID_TRANSITIONS = {
  solicitada: ['autorizada', 'cancelada'],
  autorizada: ['em_andamento', 'cancelada'],
  em_andamento: ['concluida', 'cancelada'],
  concluida: [],
  cancelada: [],
};

const canForce = (force, role) => force === true && ['admin', 'super_admin'].includes(role);

// Falha do módulo de inadimplência não pode travar a operação — trata como adimplente
async function isDelinquent(tenantId, graveId) {
  try {
    return await delinquency.isGraveDelinquent(tenantId, graveId);
  } catch (err) {
    return false;
  }
}

async function create(tenantId, graveId, data, userId, { force, role } = {}) {
  return sequelize.transaction(async (transaction) => {
    const grave = await Grave.findOne({ where: { id: graveId, tenantId }, transaction });
    if (!grave) throw AppError.notFound('Sepultura não encontrada.');

    if (!canForce(force, role)) {
      if (grave.isBlocked || (await isDelinquent(tenantId, grave.id))) {
        throw new AppError('Sepultura bloqueada ou com débitos em atraso — manutenção não permitida.', 422, 'GRAVE_DELINQUENT');
      }
    }

    const maintenance = await GraveMaintenance.create(
      {
        ...data,
        tenantId,
        graveId: grave.id,
        status: 'solicitada',
        registeredByUserId: userId,
      },
      { transaction }
    );

    await graveEvents.record(
      {
        tenantId, graveId: grave.id, eventType: eventTypeFor(maintenance.maintenanceType),
        title: `Manutenção solicitada (${maintenance.maintenanceType})`,
        description: maintenance.description || null,
        referenceType: 'grave_maintenance', referenceId: maintenance.id,
        userId,
      },
      { transaction }
    );
    return maintenance;
  });
}

async function changeStatus(tenantId, id, status, userId) {
  return sequelize.transaction(async (transaction) => {
    const maintenance = await GraveMaintenance.findOne({ where: { id, tenantId }, transaction });
    if (!maintenance) throw AppError.notFound('Manutenção não encontrada.');

    if (!VALID_TRANSITIONS[maintenance.status].includes(status)) {
      throw AppError.conflict(
        `Transição inválida: '${maintenance.status}' → '${status}'.`,
        'INVALID_STATUS_TRANSITION'
      );
    }

    const changes = { status };
    if (status === 'concluida' && !maintenance.endDate) {
      changes.endDate = todayISO();
    }
    await maintenance.update(changes, { transaction });

    if (status === 'concluida') {
      await graveEvents.record(
        {
          tenantId, graveId: maintenance.graveId, eventType: eventTypeFor(maintenance.maintenanceType),
          title: 'Manutenção concluída',
          referenceType: 'grave_maintenance', referenceId: maintenance.id,
          metadata: { maintenanceType: maintenance.maintenanceType },
          userId,
        },
        { transaction }
      );
    }
    return maintenance;
  });
}

async function update(tenantId, id, data) {
  const maintenance = await GraveMaintenance.findOne({ where: { id, tenantId } });
  if (!maintenance) throw AppError.notFound('Manutenção não encontrada.');
  return maintenance.update(data);
}

async function listByGrave(tenantId, graveId) {
  const grave = await Grave.findOne({ where: { id: graveId, tenantId } });
  if (!grave) throw AppError.notFound('Sepultura não encontrada.');
  return GraveMaintenance.findAll({
    where: { tenantId, graveId },
    include: [{ model: Person, as: 'requestedBy' }],
    order: [['createdAt', 'DESC']],
  });
}

async function list(tenantId, query) {
  const { page, perPage, limit, offset } = getPagination(query, { defaultPerPage: 30 });
  const where = { tenantId };
  if (query.status) where.status = query.status;
  if (query.maintenanceType) where.maintenanceType = query.maintenanceType;

  const { rows, count } = await GraveMaintenance.findAndCountAll({
    where, limit, offset,
    order: [['createdAt', 'DESC']],
    include: [{ model: Grave, as: 'grave' }],
  });
  return { rows, meta: buildPageMeta(count, page, perPage) };
}

async function getById(tenantId, id) {
  const maintenance = await GraveMaintenance.findOne({
    where: { id, tenantId },
    include: [{ model: Grave, as: 'grave' }, { model: Person, as: 'requestedBy' }],
  });
  if (!maintenance) throw AppError.notFound('Manutenção não encontrada.');
  return maintenance;
}

module.exports = { create, changeStatus, update, listByGrave, list, getById, CREATE_FIELDS, UPDATE_FIELDS };
