'use strict';

const { Op } = require('sequelize');
const AppError = require('../../utils/app-error');
const { getPagination, buildPageMeta } = require('../../utils/pagination');
const { FuneralHome } = require('../../models');

const EDITABLE_FIELDS = [
  'name', 'cnpj', 'phone', 'email',
  'addressStreet', 'addressDistrict', 'addressState', 'addressCity',
  'contactName', 'contactCpf', 'contactPhone', 'contactEmail', 'contactAddress',
  'notes',
];

async function list(tenantId, query = {}) {
  const { page, perPage, limit, offset } = getPagination(query, { defaultPerPage: 30 });
  const where = { tenantId };
  if (query.search) {
    const term = `%${query.search}%`;
    where[Op.or] = [
      { name: { [Op.iLike]: term } },
      { cnpj: { [Op.iLike]: term } },
      { addressCity: { [Op.iLike]: term } },
      { addressState: { [Op.iLike]: term } },
      { contactName: { [Op.iLike]: term } },
    ];
  }
  const { rows, count } = await FuneralHome.findAndCountAll({
    where, limit, offset, order: [['name', 'ASC']],
  });
  return { rows, meta: buildPageMeta(count, page, perPage) };
}

async function getById(tenantId, id) {
  const funeralHome = await FuneralHome.findOne({ where: { id, tenantId } });
  if (!funeralHome) throw AppError.notFound('Funerária não encontrada.');
  return funeralHome;
}

async function create(tenantId, data) {
  return FuneralHome.create({ ...data, tenantId });
}

async function update(tenantId, id, data) {
  const funeralHome = await getById(tenantId, id);
  return funeralHome.update(data);
}

async function remove(tenantId, id) {
  const funeralHome = await getById(tenantId, id);
  await funeralHome.destroy(); // soft delete
}

module.exports = { list, getById, create, update, remove, EDITABLE_FIELDS };
