'use strict';

const catchAsync = require('../../utils/catch-async');
const { ok, created } = require('../../utils/http-response');
const { requireFields, pick } = require('../../utils/validation');
const { getTenantId } = require('../../utils/request-helpers');
const service = require('./maintenance-fees.service');

const list = catchAsync(async (req, res) => {
  const { rows, meta } = await service.list(getTenantId(req), req.query);
  return ok(res, rows, meta);
});

const getById = catchAsync(async (req, res) => {
  return ok(res, await service.getById(getTenantId(req), req.params.id));
});

const create = catchAsync(async (req, res) => {
  requireFields(req.body, ['graveId', 'feeTypeId', 'payerPersonId']);
  const data = pick(req.body, [
    'graveId', 'feeTypeId', 'payerPersonId', 'amount', 'periodicity',
    'dueDay', 'dueMonth', 'nextDueDate', 'concessionId', 'notes',
  ]);
  return created(res, await service.create(getTenantId(req), data));
});

const update = catchAsync(async (req, res) => {
  const data = pick(req.body, service.UPDATABLE_FIELDS);
  return ok(res, await service.update(getTenantId(req), req.params.id, data));
});

const suspend = catchAsync(async (req, res) => {
  return ok(res, await service.setStatus(getTenantId(req), req.params.id, 'suspensa'));
});

const reactivate = catchAsync(async (req, res) => {
  return ok(res, await service.setStatus(getTenantId(req), req.params.id, 'ativa'));
});

const terminate = catchAsync(async (req, res) => {
  return ok(res, await service.setStatus(getTenantId(req), req.params.id, 'encerrada'));
});

const adjust = catchAsync(async (req, res) => {
  const data = pick(req.body, ['newAmount', 'percent', 'reason']);
  return ok(res, await service.adjust(getTenantId(req), req.params.id, data));
});

const batchAdjust = catchAsync(async (req, res) => {
  requireFields(req.body, ['feeTypeId']);
  const data = pick(req.body, ['feeTypeId', 'percent', 'newAmount', 'reason', 'dryRun']);
  return ok(res, await service.batchAdjust(getTenantId(req), data));
});

module.exports = { list, getById, create, update, suspend, reactivate, terminate, adjust, batchAdjust };
