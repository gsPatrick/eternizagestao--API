'use strict';

const catchAsync = require('../../utils/catch-async');
const { ok, created } = require('../../utils/http-response');
const { requireFields, pick } = require('../../utils/validation');
const { getTenantId, getUserId } = require('../../utils/request-helpers');
const service = require('./data-exports.service');

const create = catchAsync(async (req, res) => {
  requireFields(req.body, ['exportType']);
  const data = pick(req.body, [
    'exportType', 'format', 'periodStart', 'periodEnd', 'cemeteryId', 'parameters',
  ]);
  // 201 mesmo quando a geração falha — o registro volta com status 'erro'.
  return created(res, service.toResponse(await service.create(getTenantId(req), data, getUserId(req))));
});

const list = catchAsync(async (req, res) => {
  const { rows, meta } = await service.list(getTenantId(req), req.query);
  return ok(res, rows.map(service.toResponse), meta);
});

const getById = catchAsync(async (req, res) => {
  return ok(res, service.toResponse(await service.getById(getTenantId(req), req.params.id)));
});

module.exports = { create, list, getById };
