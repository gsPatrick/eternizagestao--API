'use strict';

const catchAsync = require('../../utils/catch-async');
const { ok, created } = require('../../utils/http-response');
const { requireFields, pick } = require('../../utils/validation');
const { getTenantId, getUserId } = require('../../utils/request-helpers');
const service = require('./grave-maintenances.service');

const create = catchAsync(async (req, res) => {
  requireFields(req.body, ['maintenanceType']);
  const data = pick(req.body, service.CREATE_FIELDS);
  const result = await service.create(
    getTenantId(req), req.params.graveId, data, getUserId(req),
    { force: req.body.force === true, role: req.user.role }
  );
  return created(res, result);
});

const changeStatus = catchAsync(async (req, res) => {
  requireFields(req.body, ['status']);
  return ok(res, await service.changeStatus(getTenantId(req), req.params.id, req.body.status, getUserId(req)));
});

const update = catchAsync(async (req, res) => {
  const data = pick(req.body, service.UPDATE_FIELDS);
  return ok(res, await service.update(getTenantId(req), req.params.id, data));
});

const listByGrave = catchAsync(async (req, res) => {
  return ok(res, await service.listByGrave(getTenantId(req), req.params.graveId));
});

const list = catchAsync(async (req, res) => {
  const { rows, meta } = await service.list(getTenantId(req), req.query);
  return ok(res, rows, meta);
});

const getById = catchAsync(async (req, res) => {
  return ok(res, await service.getById(getTenantId(req), req.params.id));
});

module.exports = { create, changeStatus, update, listByGrave, list, getById };
