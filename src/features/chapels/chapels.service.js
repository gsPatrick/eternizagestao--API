'use strict';

const AppError = require('../../utils/app-error');
const { getPagination, buildPageMeta } = require('../../utils/pagination');
const { Cemetery, Chapel } = require('../../models');

const EDITABLE_FIELDS = ['name', 'code', 'capacity', 'active', 'notes'];

async function assertCemetery(tenantId, cemeteryId) {
  const cemetery = await Cemetery.findOne({ where: { id: cemeteryId, tenantId } });
  if (!cemetery) throw AppError.notFound('Cemitério não encontrado.');
  return cemetery;
}

async function list(tenantId, cemeteryId, query) {
  await assertCemetery(tenantId, cemeteryId);
  const { page, perPage, limit, offset } = getPagination(query, { defaultPerPage: 30 });
  const where = { tenantId, cemeteryId };
  if (query.active !== undefined) where.active = query.active === 'true';

  const { rows, count } = await Chapel.findAndCountAll({
    where, limit, offset, order: [['name', 'ASC']],
  });
  return { rows, meta: buildPageMeta(count, page, perPage) };
}

async function getById(tenantId, id) {
  const chapel = await Chapel.findOne({
    where: { id, tenantId },
    include: [{ model: Cemetery, as: 'cemetery', attributes: ['id', 'name'] }],
  });
  if (!chapel) throw AppError.notFound('Capela não encontrada.');
  return chapel;
}

async function create(tenantId, cemeteryId, data) {
  await assertCemetery(tenantId, cemeteryId);
  return Chapel.create({ ...data, tenantId, cemeteryId });
}

async function update(tenantId, id, data) {
  const chapel = await getById(tenantId, id);
  return chapel.update(data);
}

async function remove(tenantId, id) {
  const chapel = await getById(tenantId, id);
  await chapel.destroy(); // soft delete
}

module.exports = { list, getById, create, update, remove, EDITABLE_FIELDS };
