'use strict';

const { Op } = require('sequelize');
const AppError = require('../../utils/app-error');
const { GraveStatus } = require('../../models');

// Statuses visíveis do tenant = de sistema (tenant NULL) + próprios
async function list(tenantId) {
  return GraveStatus.findAll({
    where: { [Op.or]: [{ tenantId: null }, { tenantId }], active: true },
    order: [['isSystem', 'DESC'], ['name', 'ASC']],
  });
}

// Resolve um status utilizável pelo tenant (por id ou slug)
async function resolve(tenantId, { id, slug }) {
  const where = { [Op.or]: [{ tenantId: null }, { tenantId }], active: true };
  if (id) where.id = id;
  else if (slug) where.slug = slug;
  else throw AppError.badRequest('Informe id ou slug do status.');
  const status = await GraveStatus.findOne({ where });
  if (!status) throw AppError.notFound('Status de sepultura não encontrado.');
  return status;
}

async function create(tenantId, data) {
  const slug = String(data.slug || data.name).toLowerCase().trim().replace(/\s+/g, '_').replace(/[^\w]/g, '');
  return GraveStatus.create({
    tenantId,
    name: data.name,
    slug,
    color: data.color,
    allowsBurial: Boolean(data.allowsBurial),
    isSystem: false,
  });
}

async function update(tenantId, id, data) {
  const status = await GraveStatus.findOne({ where: { id, tenantId } });
  if (!status) throw AppError.notFound('Status não encontrado (statuses de sistema não são editáveis).');
  const { name, color, allowsBurial, active } = data;
  return status.update({ name, color, allowsBurial, active });
}

async function remove(tenantId, id) {
  const status = await GraveStatus.findOne({ where: { id, tenantId } });
  if (!status) throw AppError.notFound('Status não encontrado (statuses de sistema não são removíveis).');
  try {
    await status.destroy();
  } catch (err) {
    if (err.name === 'SequelizeForeignKeyConstraintError') {
      throw AppError.conflict('Status em uso por sepulturas — desative-o em vez de excluir.', 'STATUS_IN_USE');
    }
    throw err;
  }
}

module.exports = { list, resolve, create, update, remove };
