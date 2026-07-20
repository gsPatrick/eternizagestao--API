'use strict';

const catchAsync = require('../../utils/catch-async');
const { ok } = require('../../utils/http-response');
const { getTenantId } = require('../../utils/request-helpers');
const service = require('./dashboard.service');

const getDashboard = catchAsync(async (req, res) => {
  const { cemeteryId } = req.query;
  return ok(res, await service.getDashboard(getTenantId(req), { cemeteryId }));
});

module.exports = { getDashboard };
