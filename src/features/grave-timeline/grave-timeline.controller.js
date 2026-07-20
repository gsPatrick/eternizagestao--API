'use strict';

const catchAsync = require('../../utils/catch-async');
const { ok } = require('../../utils/http-response');
const { getTenantId } = require('../../utils/request-helpers');
const service = require('./grave-timeline.service');

const listByGrave = catchAsync(async (req, res) => {
  const { rows, meta } = await service.listByGrave(getTenantId(req), req.params.graveId, req.query);
  return ok(res, rows, meta);
});

module.exports = { listByGrave };
