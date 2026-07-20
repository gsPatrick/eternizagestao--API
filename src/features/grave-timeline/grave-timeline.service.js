'use strict';

const AppError = require('../../utils/app-error');
const { getPagination, buildPageMeta } = require('../../utils/pagination');
const { Grave, GraveEvent, User } = require('../../models');

// Consulta da linha do tempo (somente leitura — escrita via grave-event.recorder)
async function listByGrave(tenantId, graveId, query) {
  const grave = await Grave.findOne({ where: { id: graveId, tenantId } });
  if (!grave) throw AppError.notFound('Sepultura não encontrada.');

  const { page, perPage, limit, offset } = getPagination(query, { defaultPerPage: 30 });
  const where = { tenantId, graveId };
  if (query.eventType) where.eventType = query.eventType;

  const { rows, count } = await GraveEvent.findAndCountAll({
    where,
    limit,
    offset,
    order: [['occurredAt', 'DESC'], ['createdAt', 'DESC']],
    include: [{ model: User, as: 'registeredBy', attributes: ['id', 'name'] }],
  });
  return { rows, meta: buildPageMeta(count, page, perPage) };
}

module.exports = { listByGrave };
