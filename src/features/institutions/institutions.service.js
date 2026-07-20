'use strict';

const { Op } = require('sequelize');
const AppError = require('../../utils/app-error');
const { getPagination, buildPageMeta } = require('../../utils/pagination');
const { Institution } = require('../../models');

const EDITABLE_FIELDS = [
  'name', 'type', 'cnpj', 'phone', 'email',
  'addressStreet', 'addressState', 'addressCity', 'notes',
];

async function list(tenantId, query = {}) {
  const { page, perPage, limit, offset } = getPagination(query, { defaultPerPage: 30 });
  const where = { tenantId };
  if (query.search) {
    const term = `%${query.search}%`;
    where[Op.or] = [
      { name: { [Op.iLike]: term } },
      { type: { [Op.iLike]: term } },
      { addressCity: { [Op.iLike]: term } },
      { addressState: { [Op.iLike]: term } },
      { cnpj: { [Op.iLike]: term } },
    ];
  }
  const { rows, count } = await Institution.findAndCountAll({
    where, limit, offset, order: [['name', 'ASC']],
  });
  return { rows, meta: buildPageMeta(count, page, perPage) };
}

async function getById(tenantId, id) {
  const institution = await Institution.findOne({ where: { id, tenantId } });
  if (!institution) throw AppError.notFound('Instituição não encontrada.');
  return institution;
}

async function create(tenantId, data) {
  return Institution.create({ ...data, tenantId });
}

async function update(tenantId, id, data) {
  const institution = await getById(tenantId, id);
  return institution.update(data);
}

async function remove(tenantId, id) {
  const institution = await getById(tenantId, id);
  await institution.destroy(); // soft delete
}

module.exports = { list, getById, create, update, remove, EDITABLE_FIELDS };
