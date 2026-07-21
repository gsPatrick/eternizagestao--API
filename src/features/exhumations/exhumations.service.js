'use strict';

const { Op } = require('sequelize');
const AppError = require('../../utils/app-error');
const { getPagination, buildPageMeta } = require('../../utils/pagination');
const graveEvents = require('../grave-timeline/grave-event.recorder');
const graveStatuses = require('../grave-statuses/grave-statuses.service');
const { assertGraveAcceptsBurial } = require('../burials/burials.helper');
const { nextNumber, formatExhumation } = require('../../utils/sequence');
const { todayISO } = require('../../utils/date-local');
const {
  sequelize, Exhumation, Burial, Grave, GraveStatus, Deceased, Person,
  OssuaryNiche, RemainsDeposit,
} = require('../../models');

const CREATE_FIELDS = [
  'graveId', 'deceasedId', 'burialId', 'requestedByPersonId', 'requestDate', 'reason',
];

// destino do exumado → nova localização do sepultado
const LOCATION_BY_DESTINATION = {
  cremacao: 'cremado',
  translado_externo: 'transladado',
  outro: 'desconhecido',
};

const today = () => todayISO();

function assertStatus(exhumation, allowed) {
  if (!allowed.includes(exhumation.status)) {
    throw AppError.conflict(
      `Transição inválida: exumação está '${exhumation.status}' (esperado: ${allowed.join(' ou ')}).`,
      'INVALID_STATUS_TRANSITION'
    );
  }
}

async function findOne(tenantId, id, { transaction, include } = {}) {
  const exhumation = await Exhumation.findOne({ where: { id, tenantId }, include, transaction });
  if (!exhumation) throw AppError.notFound('Exumação não encontrada.');
  return exhumation;
}

async function create(tenantId, data, userId) {
  return sequelize.transaction(async (transaction) => {
    const grave = await Grave.findOne({ where: { id: data.graveId, tenantId }, transaction });
    if (!grave) throw AppError.notFound('Sepultura não encontrada.');

    const deceased = await Deceased.findOne({ where: { id: data.deceasedId, tenantId }, transaction });
    if (!deceased) throw AppError.notFound('Sepultado não encontrado.');

    const burialWhere = { tenantId, graveId: grave.id, deceasedId: deceased.id, status: 'ativo' };
    if (data.burialId) burialWhere.id = data.burialId;
    const burial = await Burial.findOne({ where: burialWhere, transaction });
    if (!burial) {
      throw AppError.notFound('Sepultamento ativo do sepultado nesta sepultura não encontrado.', 'NO_ACTIVE_BURIAL');
    }

    // Número do processo de exumação (0044/2026) concorrência-safe: incremento sob
    // SELECT ... FOR UPDATE na MESMA transação (ver utils/sequence).
    const year = new Date().getFullYear();
    const number = await nextNumber({ tenantId, scope: 'exhumation', year }, { transaction });

    const exhumation = await Exhumation.create(
      {
        tenantId,
        processNumber: formatExhumation(number, year),
        cemeteryId: grave.cemeteryId,
        graveId: grave.id,
        burialId: burial.id,
        deceasedId: deceased.id,
        requestedByPersonId: data.requestedByPersonId || null,
        requestDate: data.requestDate || today(),
        reason: data.reason || null,
        status: 'solicitada',
        registeredByUserId: userId,
      },
      { transaction }
    );

    await graveEvents.record(
      {
        tenantId, graveId: grave.id, eventType: 'exumacao',
        title: 'Exumação solicitada',
        description: data.reason || null,
        referenceType: 'exhumation', referenceId: exhumation.id,
        metadata: { deceasedId: deceased.id },
        userId,
      },
      { transaction }
    );
    return exhumation;
  });
}

async function authorize(tenantId, id, { authorizationNumber }, userId) {
  const exhumation = await findOne(tenantId, id);
  assertStatus(exhumation, ['solicitada']);
  return exhumation.update({
    status: 'autorizada',
    authorizationNumber: authorizationNumber || null,
    authorizedByUserId: userId,
    authorizedAt: new Date(),
  });
}

async function schedule(tenantId, id, { scheduledDate }) {
  const exhumation = await findOne(tenantId, id);
  assertStatus(exhumation, ['autorizada']);
  return exhumation.update({ status: 'agendada', scheduledDate });
}

async function perform(tenantId, id, data, userId) {
  return sequelize.transaction(async (transaction) => {
    const exhumation = await findOne(tenantId, id, { transaction });
    assertStatus(exhumation, ['autorizada', 'agendada']);

    const performedAt = data.performedAt ? new Date(data.performedAt) : new Date();

    const deceased = await Deceased.findOne({ where: { id: exhumation.deceasedId, tenantId }, transaction });
    if (!deceased) throw AppError.notFound('Sepultado não encontrado.');

    // encerra o sepultamento de origem
    if (exhumation.burialId) {
      const originBurial = await Burial.findOne({ where: { id: exhumation.burialId, tenantId }, transaction });
      if (originBurial) await originBurial.update({ status: 'exumado' }, { transaction });
    }

    if (data.destinationType === 'ossario') {
      if (!data.destinationOssuaryNicheId) {
        throw AppError.badRequest('destinationOssuaryNicheId é obrigatório para destino ossário.', 'MISSING_FIELDS');
      }
      const niche = await OssuaryNiche.findOne({
        where: { id: data.destinationOssuaryNicheId, tenantId }, transaction,
      });
      if (!niche) throw AppError.notFound('Nicho do ossário não encontrado.');
      if (!['livre', 'reservado'].includes(niche.status)) {
        throw AppError.conflict(`Nicho está '${niche.status}' — não pode receber restos mortais.`, 'NICHE_UNAVAILABLE');
      }
      await RemainsDeposit.create(
        {
          tenantId,
          deceasedId: deceased.id,
          exhumationId: exhumation.id,
          ossuaryNicheId: niche.id,
          originGraveId: exhumation.graveId,
          depositedAt: performedAt,
          status: 'depositado',
          registeredByUserId: userId,
        },
        { transaction }
      );
      await niche.update({ status: 'ocupado' }, { transaction });
      await deceased.update({ currentGraveId: null, currentLocationType: 'ossario' }, { transaction });
    } else if (data.destinationType === 'outro_jazigo' && data.destinationGraveId) {
      // Translado para um jazigo RASTREADO no sistema: cria o sepultamento de
      // destino com todas as validações/concorrência. Se o painel não informar
      // um jazigo (apenas o detalhe textual do destino), cai no ramo genérico
      // abaixo — o destino fica documentado em destinationDetails.
      const destGrave = await Grave.findOne({
        where: { id: data.destinationGraveId, tenantId },
        include: [{ model: GraveStatus, as: 'status' }],
        transaction,
      });
      if (!destGrave) throw AppError.notFound('Sepultura de destino não encontrada.');

      // Translado cria um sepultamento no destino: aplica as MESMAS validações do
      // sepultamento direto (bloqueio, status, lotação, concessão ativa).
      const { activeBurials } = await assertGraveAcceptsBurial({
        grave: destGrave, tenantId, transaction,
      });

      const newBurial = await Burial.create(
        {
          tenantId,
          cemeteryId: destGrave.cemeteryId,
          graveId: destGrave.id,
          deceasedId: deceased.id,
          burialDate: performedAt,
          status: 'ativo',
          notes: 'Origem: exumação',
          registeredByUserId: userId,
        },
        { transaction }
      );
      await deceased.update({ currentGraveId: destGrave.id, currentLocationType: 'sepultado' }, { transaction });

      // ao atingir a capacidade, o jazigo destino passa automaticamente a "ocupada"
      if (activeBurials + 1 >= destGrave.capacity) {
        const occupied = await graveStatuses.resolve(tenantId, { slug: 'ocupada' });
        await destGrave.update({ statusId: occupied.id }, { transaction });
      }

      await graveEvents.record(
        {
          tenantId, graveId: destGrave.id, eventType: 'sepultamento',
          title: `Sepultamento de ${deceased.fullName} (origem: exumação)`,
          referenceType: 'burial', referenceId: newBurial.id,
          metadata: { exhumationId: exhumation.id },
          userId,
        },
        { transaction }
      );
    } else {
      await deceased.update(
        { currentGraveId: null, currentLocationType: LOCATION_BY_DESTINATION[data.destinationType] || 'desconhecido' },
        { transaction }
      );
    }

    await exhumation.update(
      {
        status: 'realizada',
        performedAt,
        performedBy: data.performedBy || null,
        destinationType: data.destinationType,
        destinationGraveId: data.destinationGraveId || null,
        destinationOssuaryNicheId: data.destinationOssuaryNicheId || null,
        destinationDetails: data.destinationDetails || null,
      },
      { transaction }
    );

    // sem ocupantes ativos, o jazigo de origem volta a ficar livre
    const remaining = await Burial.count({
      where: { tenantId, graveId: exhumation.graveId, status: 'ativo' }, transaction,
    });
    if (remaining === 0) {
      const originGrave = await Grave.findOne({ where: { id: exhumation.graveId, tenantId }, transaction });
      const free = await graveStatuses.resolve(tenantId, { slug: 'livre' });
      if (originGrave) await originGrave.update({ statusId: free.id }, { transaction });
    }

    await graveEvents.record(
      {
        tenantId, graveId: exhumation.graveId, eventType: 'exumacao',
        title: `Exumação realizada — destino: ${data.destinationType}`,
        referenceType: 'exhumation', referenceId: exhumation.id,
        metadata: { deceasedId: deceased.id, destinationType: data.destinationType },
        userId,
      },
      { transaction }
    );
    return exhumation;
  });
}

async function cancel(tenantId, id, { reason }) {
  const exhumation = await findOne(tenantId, id);
  if (exhumation.status === 'realizada') {
    throw AppError.conflict('Exumação já realizada não pode ser cancelada.', 'EXHUMATION_PERFORMED');
  }
  const notes = reason
    ? [exhumation.notes, `Cancelamento: ${reason}`].filter(Boolean).join('\n')
    : exhumation.notes;
  return exhumation.update({ status: 'cancelada', notes });
}

async function list(tenantId, query) {
  const { page, perPage, limit, offset } = getPagination(query, { defaultPerPage: 30 });
  const where = { tenantId };
  if (query.status) where.status = query.status;
  if (query.graveId) where.graveId = query.graveId;
  if (query.deceasedId) where.deceasedId = query.deceasedId;
  if (query.cemeteryId) where.cemeteryId = query.cemeteryId;

  const { rows, count } = await Exhumation.findAndCountAll({
    where, limit, offset,
    order: [['createdAt', 'DESC']],
    include: [
      { model: Deceased, as: 'deceased' },
      { model: Grave, as: 'grave' },
      { model: Person, as: 'requestedBy' },
      { model: Grave, as: 'destinationGrave' },
      { model: OssuaryNiche, as: 'destinationNiche' },
    ],
  });
  return { rows, meta: buildPageMeta(count, page, perPage) };
}

// Indicadores da tela: em andamento, aguardando autorização, realizadas no ano,
// além dos contadores por etapa (chips).
async function stats(tenantId, query) {
  const where = { tenantId };
  if (query.cemeteryId) where.cemeteryId = query.cemeteryId;

  const yearStart = `${new Date().getFullYear()}-01-01`;
  const grouped = await Exhumation.findAll({
    where,
    attributes: ['status', [sequelize.fn('COUNT', sequelize.col('id')), 'total']],
    group: ['status'],
    raw: true,
  });
  const byStatus = {};
  let total = 0;
  grouped.forEach((r) => { byStatus[r.status] = Number(r.total); total += Number(r.total); });

  const performedThisYear = await Exhumation.count({
    where: { ...where, status: 'realizada', performedAt: { [Op.gte]: new Date(yearStart) } },
  });

  const inProgress = (byStatus.solicitada || 0) + (byStatus.autorizada || 0) + (byStatus.agendada || 0);
  return {
    total,
    inProgress,
    awaitingAuthorization: byStatus.solicitada || 0,
    performedThisYear,
    byStatus,
  };
}

async function getById(tenantId, id) {
  return findOne(tenantId, id, {
    include: [
      { model: Grave, as: 'grave' },
      { model: Deceased, as: 'deceased' },
      { model: Grave, as: 'destinationGrave' },
      { model: OssuaryNiche, as: 'destinationNiche' },
      { model: Burial, as: 'burial' },
      { model: Person, as: 'requestedBy' },
    ],
  });
}

module.exports = { create, authorize, schedule, perform, cancel, list, stats, getById, CREATE_FIELDS };
