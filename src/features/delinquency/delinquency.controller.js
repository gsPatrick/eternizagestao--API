'use strict';

const catchAsync = require('../../utils/catch-async');
const { ok } = require('../../utils/http-response');
const { getTenantId, getUserId } = require('../../utils/request-helpers');
const service = require('./delinquency.service');

const panel = catchAsync(async (req, res) => {
  const { rows, meta } = await service.getPanel(getTenantId(req), req.query);
  return ok(res, rows, meta);
});

const summary = catchAsync(async (req, res) => {
  return ok(res, await service.getSummary(getTenantId(req)));
});

const syncBlocks = catchAsync(async (req, res) => {
  return ok(res, await service.syncGraveBlocks(getTenantId(req), getUserId(req)));
});

const blockPayer = catchAsync(async (req, res) => {
  const { reason } = req.body || {};
  return ok(res, await service.setPayerBlock(getTenantId(req), req.params.personId, { blocked: true, reason }, getUserId(req)));
});

const unblockPayer = catchAsync(async (req, res) => {
  return ok(res, await service.setPayerBlock(getTenantId(req), req.params.personId, { blocked: false }, getUserId(req)));
});

const notifyPayer = catchAsync(async (req, res) => {
  return ok(res, await service.notifyPayer(getTenantId(req), req.params.personId));
});

const notifyAll = catchAsync(async (req, res) => {
  return ok(res, await service.notifyAll(getTenantId(req)));
});

module.exports = { panel, summary, syncBlocks, blockPayer, unblockPayer, notifyPayer, notifyAll };
