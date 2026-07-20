'use strict';

const catchAsync = require('../../utils/catch-async');
const { ok, created, noContent } = require('../../utils/http-response');
const { requireFields, pick } = require('../../utils/validation');
const { getTenantId } = require('../../utils/request-helpers');
const service = require('./fee-types.service');

const list = catchAsync(async (req, res) => {
  return ok(res, await service.list(getTenantId(req)));
});

const getById = catchAsync(async (req, res) => {
  return ok(res, await service.getById(getTenantId(req), req.params.id));
});

const create = catchAsync(async (req, res) => {
  requireFields(req.body, ['name']);
  return created(res, await service.create(getTenantId(req), pick(req.body, service.EDITABLE_FIELDS)));
});

const update = catchAsync(async (req, res) => {
  return ok(res, await service.update(getTenantId(req), req.params.id, pick(req.body, service.EDITABLE_FIELDS)));
});

const remove = catchAsync(async (req, res) => {
  await service.remove(getTenantId(req), req.params.id);
  return noContent(res);
});

module.exports = { list, getById, create, update, remove };
