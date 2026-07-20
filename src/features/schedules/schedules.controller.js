'use strict';

const catchAsync = require('../../utils/catch-async');
const { ok, created } = require('../../utils/http-response');
const { requireFields, requireOneOf, pick } = require('../../utils/validation');
const { getTenantId, getUserId } = require('../../utils/request-helpers');
const service = require('./schedules.service');

const list = catchAsync(async (req, res) => {
  return ok(res, await service.list(getTenantId(req), req.query));
});

const todayCount = catchAsync(async (req, res) => {
  return ok(res, await service.todayCount(getTenantId(req)));
});

const getById = catchAsync(async (req, res) => {
  return ok(res, await service.getById(getTenantId(req), req.params.id));
});

const create = catchAsync(async (req, res) => {
  requireFields(req.body, ['scheduleType', 'cemeteryId', 'startsAt', 'endsAt']);
  requireOneOf(req.body.scheduleType, service.SCHEDULE_TYPES, 'scheduleType');
  const data = pick(req.body, service.CREATE_FIELDS);
  return created(res, await service.create(getTenantId(req), data, getUserId(req)));
});

const update = catchAsync(async (req, res) => {
  const data = pick(req.body, service.UPDATE_FIELDS);
  return ok(res, await service.update(getTenantId(req), req.params.id, data));
});

const changeStatus = catchAsync(async (req, res) => {
  requireFields(req.body, ['status']);
  return ok(res, await service.changeStatus(getTenantId(req), req.params.id, req.body.status));
});

module.exports = { list, todayCount, getById, create, update, changeStatus };
