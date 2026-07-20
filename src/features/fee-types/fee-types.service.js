'use strict';

const { Op, fn, col } = require('sequelize');
const AppError = require('../../utils/app-error');
const { FeeType, MaintenanceFee } = require('../../models');

const EDITABLE_FIELDS = ['name', 'description', 'defaultAmount', 'periodicity', 'active'];

// Catálogo pequeno por tenant — lista completa, sem paginação.
// Enriquece cada tipo com `inUse`: nº de taxas de manutenção vinculadas
// (alimenta o contador "N jazigo(s)" do catálogo no front).
async function list(tenantId) {
  const feeTypes = await FeeType.findAll({ where: { tenantId }, order: [['name', 'ASC']] });
  if (!feeTypes.length) return feeTypes;

  const counts = await MaintenanceFee.findAll({
    where: { tenantId, feeTypeId: { [Op.in]: feeTypes.map((f) => f.id) } },
    attributes: ['feeTypeId', [fn('COUNT', col('id')), 'total']],
    group: ['feeTypeId'],
    raw: true,
  });
  const usageByType = {};
  counts.forEach((c) => { usageByType[c.feeTypeId] = Number(c.total); });

  return feeTypes.map((ft) => ({ ...ft.toJSON(), inUse: usageByType[ft.id] || 0 }));
}

async function getById(tenantId, id) {
  const feeType = await FeeType.findOne({ where: { id, tenantId } });
  if (!feeType) throw AppError.notFound('Tipo de taxa não encontrado.');
  return feeType;
}

async function create(tenantId, data) {
  return FeeType.create({ ...data, tenantId });
}

async function update(tenantId, id, data) {
  const feeType = await getById(tenantId, id);
  return feeType.update(data);
}

async function remove(tenantId, id) {
  const feeType = await getById(tenantId, id);
  // Soft delete não dispara FK — checagem explícita de uso antes de excluir.
  const inUse = await MaintenanceFee.count({ where: { tenantId, feeTypeId: id } });
  if (inUse > 0) {
    throw AppError.conflict('Tipo de taxa vinculado a taxas de manutenção — desative em vez de excluir.', 'FEE_TYPE_IN_USE');
  }
  try {
    await feeType.destroy(); // soft delete
  } catch (err) {
    if (err.name === 'SequelizeForeignKeyConstraintError') {
      throw AppError.conflict('Tipo de taxa em uso — desative em vez de excluir.', 'FEE_TYPE_IN_USE');
    }
    throw err;
  }
}

module.exports = { list, getById, create, update, remove, EDITABLE_FIELDS };
