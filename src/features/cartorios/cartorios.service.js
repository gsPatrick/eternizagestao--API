'use strict';

const { Op } = require('sequelize');
const AppError = require('../../utils/app-error');
const { getPagination, buildPageMeta } = require('../../utils/pagination');
const { Cartorio } = require('../../models');

const EDITABLE_FIELDS = [
  'name', 'addressState', 'addressCity',
  'cnpj', 'phone', 'email', 'addressStreet', 'notes',
];

async function list(tenantId, query = {}) {
  const { page, perPage, limit, offset } = getPagination(query, { defaultPerPage: 30 });
  const where = { tenantId };
  if (query.search) {
    const term = `%${query.search}%`;
    where[Op.or] = [
      { name: { [Op.iLike]: term } },
      { addressCity: { [Op.iLike]: term } },
      { addressState: { [Op.iLike]: term } },
      { cnpj: { [Op.iLike]: term } },
    ];
  }
  const { rows, count } = await Cartorio.findAndCountAll({
    where, limit, offset, order: [['name', 'ASC']],
  });
  return { rows, meta: buildPageMeta(count, page, perPage) };
}

async function getById(tenantId, id) {
  const cartorio = await Cartorio.findOne({ where: { id, tenantId } });
  if (!cartorio) throw AppError.notFound('Cartório não encontrado.');
  return cartorio;
}

async function create(tenantId, data) {
  return Cartorio.create({ ...data, tenantId });
}

async function update(tenantId, id, data) {
  const cartorio = await getById(tenantId, id);
  return cartorio.update(data);
}

async function remove(tenantId, id) {
  const cartorio = await getById(tenantId, id);
  await cartorio.destroy(); // soft delete
}

module.exports = { list, getById, create, update, remove, EDITABLE_FIELDS };
