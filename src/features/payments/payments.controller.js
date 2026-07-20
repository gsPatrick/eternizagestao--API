'use strict';

const catchAsync = require('../../utils/catch-async');
const { ok, created } = require('../../utils/http-response');
const { requireFields, requireOneOf, pick } = require('../../utils/validation');
const { getTenantId, getUserId } = require('../../utils/request-helpers');
const service = require('./payments.service');

const createManual = catchAsync(async (req, res) => {
  requireFields(req.body, ['method']);
  requireOneOf(req.body.method, service.PAYMENT_METHODS, 'method');
  const data = pick(req.body, ['paidAt', 'amountPaid', 'method', 'notes']);
  return created(res, await service.createManual(getTenantId(req), req.params.billingId, data, getUserId(req)));
});

const simulateGateway = catchAsync(async (req, res) => {
  const data = pick(req.body || {}, ['method']);
  return ok(res, await service.simulateGatewayPayment(getTenantId(req), req.params.billingId, data));
});

const list = catchAsync(async (req, res) => {
  const { rows, meta } = await service.list(getTenantId(req), req.query);
  return ok(res, rows, meta);
});

const getById = catchAsync(async (req, res) => {
  return ok(res, await service.getById(getTenantId(req), req.params.id));
});

const receipt = catchAsync(async (req, res) => {
  return ok(res, await service.receipt(getTenantId(req), req.params.id));
});

module.exports = { createManual, simulateGateway, list, getById, receipt };
