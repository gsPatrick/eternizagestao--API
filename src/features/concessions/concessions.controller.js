'use strict';

const catchAsync = require('../../utils/catch-async');
const { ok, created } = require('../../utils/http-response');
const { requireFields, pick, requireOneOf } = require('../../utils/validation');
const { getTenantId, getUserId } = require('../../utils/request-helpers');
const service = require('./concessions.service');

const TRANSFER_REASONS = ['venda', 'doacao', 'heranca', 'decisao_judicial', 'regularizacao', 'outro'];

const issue = catchAsync(async (req, res) => {
  requireFields(req.body, ['personId', 'concessionType']);
  requireOneOf(req.body.concessionType, ['perpetua', 'temporaria'], 'concessionType');
  const data = pick(req.body, service.CREATE_FIELDS);
  return created(res, await service.issue(getTenantId(req), req.params.graveId, data, getUserId(req)));
});

const listByGrave = catchAsync(async (req, res) => {
  return ok(res, await service.listByGrave(getTenantId(req), req.params.graveId));
});

const list = catchAsync(async (req, res) => {
  const { rows, meta } = await service.list(getTenantId(req), req.query);
  return ok(res, rows, meta);
});

const summary = catchAsync(async (req, res) => {
  return ok(res, await service.summary(getTenantId(req)));
});

const getById = catchAsync(async (req, res) => {
  return ok(res, await service.getDetail(getTenantId(req), req.params.id));
});

const transfer = catchAsync(async (req, res) => {
  requireFields(req.body, ['toPersonId', 'transferReason']);
  requireOneOf(req.body.transferReason, TRANSFER_REASONS, 'transferReason');
  const data = pick(req.body, [
    'toPersonId', 'transferReason', 'familyRelationship', 'transferDate', 'notes', 'concessionType', 'endDate',
  ]);
  return created(res, await service.transfer(getTenantId(req), req.params.id, data, getUserId(req)));
});

const renew = catchAsync(async (req, res) => {
  requireFields(req.body, ['endDate']);
  const data = pick(req.body, ['endDate']);
  return ok(res, await service.renew(getTenantId(req), req.params.id, data, getUserId(req)));
});

const terminate = catchAsync(async (req, res) => {
  return ok(res, await service.terminate(getTenantId(req), req.params.id, getUserId(req)));
});

module.exports = { issue, listByGrave, list, summary, getById, transfer, renew, terminate };
