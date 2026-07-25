'use strict';

const catchAsync = require('../../utils/catch-async');
const { ok, created, noContent } = require('../../utils/http-response');
const { pick } = require('../../utils/validation');
const { getTenantId } = require('../../utils/request-helpers');
const service = require('./roles.service');
const { MODULES } = require('./permissions.catalog');

// GET /roles/catalog — módulos × ações disponíveis (para a tela de perfis
// montar os checkboxes). Estático + tenant-agnóstico, mas exige admin.
const catalog = catchAsync(async (req, res) => {
  return ok(res, { modules: MODULES });
});

const list = catchAsync(async (req, res) => {
  return ok(res, await service.list(getTenantId(req)));
});

const getById = catchAsync(async (req, res) => {
  return ok(res, service.serialize(await service.getById(getTenantId(req), req.params.id)));
});

const create = catchAsync(async (req, res) => {
  const data = pick(req.body, ['name', 'baseRole', 'permissions', 'description']);
  return created(res, await service.create(getTenantId(req), data));
});

const update = catchAsync(async (req, res) => {
  const data = pick(req.body, ['name', 'baseRole', 'permissions', 'description']);
  return ok(res, await service.update(getTenantId(req), req.params.id, data));
});

const remove = catchAsync(async (req, res) => {
  await service.remove(getTenantId(req), req.params.id);
  return noContent(res);
});

module.exports = { catalog, list, getById, create, update, remove };
