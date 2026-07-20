'use strict';

const AppError = require('../../utils/app-error');
const { getPagination, buildPageMeta } = require('../../utils/pagination');
const { sequelize, DocumentTemplate } = require('../../models');

const DOCUMENT_TYPES = DocumentTemplate.rawAttributes.documentType.values;
const CREATE_FIELDS = ['documentType', 'name', 'fileUrl', 'bodyHtml', 'active'];
const UPDATE_FIELDS = ['name', 'fileUrl', 'bodyHtml', 'active'];

async function list(tenantId, query) {
  const { page, perPage, limit, offset } = getPagination(query, { defaultPerPage: 30 });
  const where = { tenantId };
  if (query.documentType) where.documentType = query.documentType;
  if (query.active !== undefined) where.active = query.active === 'true';

  const { rows, count } = await DocumentTemplate.findAndCountAll({
    where,
    limit,
    offset,
    order: [['documentType', 'ASC'], ['version', 'DESC']],
  });
  return { rows, meta: buildPageMeta(count, page, perPage) };
}

async function getById(tenantId, id) {
  const template = await DocumentTemplate.findOne({ where: { id, tenantId } });
  if (!template) throw AppError.notFound('Modelo de documento não encontrado.');
  return template;
}

// Cria uma nova versão do modelo para o tipo; opcionalmente desativa as demais.
async function create(tenantId, data, { deactivateOthers = false } = {}) {
  return sequelize.transaction(async (transaction) => {
    const lastVersion = await DocumentTemplate.max('version', {
      where: { tenantId, documentType: data.documentType },
      transaction,
    });

    if (deactivateOthers === true) {
      await DocumentTemplate.update(
        { active: false },
        { where: { tenantId, documentType: data.documentType }, transaction }
      );
    }

    return DocumentTemplate.create(
      { ...data, tenantId, version: (lastVersion || 0) + 1 },
      { transaction }
    );
  });
}

async function update(tenantId, id, data) {
  const template = await getById(tenantId, id);
  return template.update(data);
}

async function remove(tenantId, id) {
  const template = await getById(tenantId, id);
  await template.destroy(); // soft delete
}

module.exports = { list, getById, create, update, remove, DOCUMENT_TYPES, CREATE_FIELDS, UPDATE_FIELDS };
