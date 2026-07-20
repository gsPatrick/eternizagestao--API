'use strict';

const catchAsync = require('../../utils/catch-async');
const { ok, created } = require('../../utils/http-response');
const { requireFields, pick } = require('../../utils/validation');
const { getTenantId, getUserId } = require('../../utils/request-helpers');
const service = require('./billings.service');

const list = catchAsync(async (req, res) => {
  const { rows, meta } = await service.list(getTenantId(req), req.query);
  return ok(res, rows, meta);
});

const summary = catchAsync(async (req, res) => {
  return ok(res, await service.summary(getTenantId(req), req.query));
});

const getById = catchAsync(async (req, res) => {
  return ok(res, await service.getById(getTenantId(req), req.params.id));
});

const create = catchAsync(async (req, res) => {
  requireFields(req.body, ['payerPersonId', 'amount', 'dueDate']);
  const data = pick(req.body, [
    'payerPersonId', 'amount', 'dueDate', 'origin', 'graveId', 'description',
    'referencePeriod', 'discountAmount', 'fineAmount', 'interestAmount',
  ]);
  return created(res, await service.create(getTenantId(req), data, getUserId(req)));
});

const generate = catchAsync(async (req, res) => {
  const { until } = req.body || {};
  return ok(res, await service.generate(getTenantId(req), { until }, getUserId(req)));
});

const reissue = catchAsync(async (req, res) => {
  const { dueDate } = req.body || {};
  return created(res, await service.reissue(getTenantId(req), req.params.id, { dueDate }, getUserId(req)));
});

const cancel = catchAsync(async (req, res) => {
  const { reason } = req.body || {};
  return ok(res, await service.cancel(getTenantId(req), req.params.id, { reason }));
});

const markOverdue = catchAsync(async (req, res) => {
  return ok(res, await service.markOverdue(getTenantId(req)));
});

module.exports = { list, summary, getById, create, generate, reissue, cancel, markOverdue };
