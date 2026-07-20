'use strict';

const catchAsync = require('../../utils/catch-async');
const { ok, created, noContent } = require('../../utils/http-response');
const { requireFields, pick } = require('../../utils/validation');
const { getTenantId } = require('../../utils/request-helpers');
const service = require('./grave-statuses.service');

const list = catchAsync(async (req, res) => {
  return ok(res, await service.list(getTenantId(req)));
});

const create = catchAsync(async (req, res) => {
  requireFields(req.body, ['name']);
  const data = pick(req.body, ['name', 'slug', 'color', 'allowsBurial']);
  return created(res, await service.create(getTenantId(req), data));
});

const update = catchAsync(async (req, res) => {
  const data = pick(req.body, ['name', 'color', 'allowsBurial', 'active']);
  return ok(res, await service.update(getTenantId(req), req.params.id, data));
});

const remove = catchAsync(async (req, res) => {
  await service.remove(getTenantId(req), req.params.id);
  return noContent(res);
});

module.exports = { list, create, update, remove };
