'use strict';

const catchAsync = require('../../utils/catch-async');
const { ok, created, noContent } = require('../../utils/http-response');
const { requireFields, pick } = require('../../utils/validation');
const { getTenantId } = require('../../utils/request-helpers');
const service = require('./cemetery-structure.service');

const FIELDS = ['name', 'code', 'geoPolygon', 'notes'];

// Handlers genéricos parametrizados por nível — as rotas definem o nível
const listByParent = (level, parentParam) =>
  catchAsync(async (req, res) => {
    const { rows, meta } = await service.listByParent(level, getTenantId(req), req.params[parentParam], req.query);
    return ok(res, rows, meta);
  });

const getById = (level) =>
  catchAsync(async (req, res) => {
    return ok(res, await service.getById(level, getTenantId(req), req.params.id));
  });

const create = (level, parentParam) =>
  catchAsync(async (req, res) => {
    requireFields(req.body, ['name', 'code']);
    const data = pick(req.body, FIELDS);
    return created(res, await service.create(level, getTenantId(req), req.params[parentParam], data));
  });

const update = (level) =>
  catchAsync(async (req, res) => {
    const data = pick(req.body, FIELDS);
    return ok(res, await service.update(level, getTenantId(req), req.params.id, data));
  });

const remove = (level) =>
  catchAsync(async (req, res) => {
    await service.remove(level, getTenantId(req), req.params.id);
    return noContent(res);
  });

const tree = catchAsync(async (req, res) => {
  return ok(res, await service.tree(getTenantId(req), req.params.cemeteryId));
});

module.exports = { listByParent, getById, create, update, remove, tree };
