'use strict';

const AppError = require('../../utils/app-error');
const graveEvents = require('../grave-timeline/grave-event.recorder');
const {
  sequelize, Ossuary, OssuaryNiche, RemainsDeposit, Cemetery, Deceased, Exhumation, Grave,
} = require('../../models');

const OSSUARY_FIELDS = ['name', 'code', 'description', 'latitude', 'longitude', 'geoPolygon', 'active'];
const NICHE_FIELDS = ['code', 'rowLabel', 'columnLabel', 'notes'];

// ---- ossários ----

async function createOssuary(tenantId, cemeteryId, data) {
  const cemetery = await Cemetery.findOne({ where: { id: cemeteryId, tenantId } });
  if (!cemetery) throw AppError.notFound('Cemitério não encontrado.');
  return Ossuary.create({ ...data, tenantId, cemeteryId });
}

async function listByCemetery(tenantId, cemeteryId) {
  const cemetery = await Cemetery.findOne({ where: { id: cemeteryId, tenantId } });
  if (!cemetery) throw AppError.notFound('Cemitério não encontrado.');
  return Ossuary.findAll({ where: { tenantId, cemeteryId }, order: [['name', 'ASC']] });
}

async function getOssuary(tenantId, id) {
  const ossuary = await Ossuary.findOne({
    where: { id, tenantId },
    include: [{ model: OssuaryNiche, as: 'niches' }],
  });
  if (!ossuary) throw AppError.notFound('Ossário não encontrado.');
  return ossuary;
}

async function updateOssuary(tenantId, id, data) {
  const ossuary = await Ossuary.findOne({ where: { id, tenantId } });
  if (!ossuary) throw AppError.notFound('Ossário não encontrado.');
  return ossuary.update(data);
}

async function removeOssuary(tenantId, id) {
  const ossuary = await Ossuary.findOne({ where: { id, tenantId } });
  if (!ossuary) throw AppError.notFound('Ossário não encontrado.');
  // não se exclui ossário com restos mortais depositados
  const activeDeposits = await RemainsDeposit.count({
    where: { tenantId, status: 'depositado' },
    include: [{ model: OssuaryNiche, as: 'niche', where: { ossuaryId: id }, required: true }],
  });
  if (activeDeposits > 0) {
    throw AppError.conflict('Ossário possui depósitos ativos — não pode ser excluído.', 'OSSUARY_IN_USE');
  }
  await ossuary.destroy(); // soft delete
}

// ---- nichos ----

async function createNiches(tenantId, ossuaryId, payload) {
  const ossuary = await Ossuary.findOne({ where: { id: ossuaryId, tenantId } });
  if (!ossuary) throw AppError.notFound('Ossário não encontrado.');

  const items = Array.isArray(payload.niches) ? payload.niches : [payload];
  const records = items.map((item) => ({
    tenantId,
    ossuaryId,
    code: item.code,
    rowLabel: item.rowLabel || null,
    columnLabel: item.columnLabel || null,
    notes: item.notes || null,
  }));

  return sequelize.transaction(async (transaction) => {
    const created = await OssuaryNiche.bulkCreate(records, { transaction, validate: true });
    return Array.isArray(payload.niches) ? created : created[0];
  });
}

async function listNiches(tenantId, ossuaryId, query) {
  const ossuary = await Ossuary.findOne({ where: { id: ossuaryId, tenantId } });
  if (!ossuary) throw AppError.notFound('Ossário não encontrado.');
  const where = { tenantId, ossuaryId };
  if (query.status) where.status = query.status;
  // Traz o depósito ativo de cada nicho (ocupante, origem e processo) para a grade
  // do ossário exibir o nome e para a ação "registrar retirada" ter o id do depósito.
  return OssuaryNiche.findAll({
    where,
    order: [['code', 'ASC']],
    include: [
      {
        model: RemainsDeposit, as: 'deposits', required: false,
        where: { status: 'depositado' },
        include: [
          { model: Deceased, as: 'deceased' },
          { model: Grave, as: 'originGrave' },
          { model: Exhumation, as: 'exhumation' },
        ],
      },
    ],
  });
}

async function updateNiche(tenantId, id, data) {
  const niche = await OssuaryNiche.findOne({ where: { id, tenantId } });
  if (!niche) throw AppError.notFound('Nicho não encontrado.');

  if (data.status === 'livre') {
    const activeDeposits = await RemainsDeposit.count({
      where: { tenantId, ossuaryNicheId: id, status: 'depositado' },
    });
    if (activeDeposits > 0) {
      throw AppError.conflict('Nicho possui depósito ativo — não pode ser marcado como livre.', 'NICHE_HAS_ACTIVE_DEPOSIT');
    }
  }
  const { status, notes } = data;
  return niche.update({ status, notes });
}

// ---- depósitos ----

async function listNicheDeposits(tenantId, nicheId) {
  const niche = await OssuaryNiche.findOne({ where: { id: nicheId, tenantId } });
  if (!niche) throw AppError.notFound('Nicho não encontrado.');
  return RemainsDeposit.findAll({
    where: { tenantId, ossuaryNicheId: nicheId },
    include: [{ model: Deceased, as: 'deceased' }, { model: Exhumation, as: 'exhumation' }],
    order: [['depositedAt', 'DESC']],
  });
}

async function removeDeposit(tenantId, id, { removalReason, removalDestination }, userId) {
  return sequelize.transaction(async (transaction) => {
    const deposit = await RemainsDeposit.findOne({ where: { id, tenantId }, transaction });
    if (!deposit) throw AppError.notFound('Depósito não encontrado.');
    if (deposit.status !== 'depositado') {
      throw AppError.conflict(`Depósito já está '${deposit.status}'.`, 'DEPOSIT_NOT_ACTIVE');
    }

    await deposit.update(
      {
        status: 'retirado',
        removedAt: new Date(),
        removalReason,
        removalDestination: removalDestination || null,
      },
      { transaction }
    );

    // nicho só volta a "livre" se não restar nenhum depósito ativo
    const remaining = await RemainsDeposit.count({
      where: { tenantId, ossuaryNicheId: deposit.ossuaryNicheId, status: 'depositado' },
      transaction,
    });
    if (remaining === 0) {
      const niche = await OssuaryNiche.findOne({ where: { id: deposit.ossuaryNicheId, tenantId }, transaction });
      if (niche) await niche.update({ status: 'livre' }, { transaction });
    }

    if (deposit.originGraveId) {
      await graveEvents.record(
        {
          tenantId, graveId: deposit.originGraveId, eventType: 'deposito_ossario',
          title: 'Restos mortais retirados do ossário',
          description: removalReason || null,
          referenceType: 'remains_deposit', referenceId: deposit.id,
          metadata: { removalDestination: removalDestination || null },
          userId,
        },
        { transaction }
      );
    }
    return deposit;
  });
}

module.exports = {
  createOssuary, listByCemetery, getOssuary, updateOssuary, removeOssuary,
  createNiches, listNiches, updateNiche, listNicheDeposits, removeDeposit,
  OSSUARY_FIELDS, NICHE_FIELDS,
};
