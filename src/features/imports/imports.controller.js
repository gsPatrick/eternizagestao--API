'use strict';

const catchAsync = require('../../utils/catch-async');
const { ok, created } = require('../../utils/http-response');
const { requireFields, pick } = require('../../utils/validation');
const { getTenantId, getUserId } = require('../../utils/request-helpers');
const service = require('./imports.service');

const create = catchAsync(async (req, res) => {
  requireFields(req.body, ['entityScope', 'rows']);
  const data = pick(req.body, ['sourceName', 'fileName', 'entityScope', 'rows']);
  return created(res, await service.createBatch(getTenantId(req), data, getUserId(req)));
});

const validate = catchAsync(async (req, res) => {
  return ok(res, await service.validateBatch(getTenantId(req), req.params.id));
});

const commit = catchAsync(async (req, res) => {
  return ok(res, await service.commitBatch(getTenantId(req), req.params.id, getUserId(req)));
});

const list = catchAsync(async (req, res) => {
  const { rows, meta } = await service.list(getTenantId(req), req.query);
  return ok(res, rows, meta);
});

const getById = catchAsync(async (req, res) => {
  return ok(res, await service.getById(getTenantId(req), req.params.id));
});

const listRecords = catchAsync(async (req, res) => {
  const { rows, meta } = await service.listRecords(getTenantId(req), req.params.id, req.query);
  return ok(res, rows, meta);
});

const cancel = catchAsync(async (req, res) => {
  return ok(res, await service.cancel(getTenantId(req), req.params.id));
});

module.exports = { create, validate, commit, list, getById, listRecords, cancel };
