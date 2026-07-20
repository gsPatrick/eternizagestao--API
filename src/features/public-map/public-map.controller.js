'use strict';

const catchAsync = require('../../utils/catch-async');
const { ok } = require('../../utils/http-response');
const { getTenantId } = require('../../utils/request-helpers');
const service = require('./public-map.service');

const cemeteryMap = catchAsync(async (req, res) => {
  return ok(res, await service.cemeteryMap(getTenantId(req), req.params.id));
});

const graveRoute = catchAsync(async (req, res) => {
  return ok(res, await service.graveRoute(getTenantId(req), req.params.id));
});

module.exports = { cemeteryMap, graveRoute };
