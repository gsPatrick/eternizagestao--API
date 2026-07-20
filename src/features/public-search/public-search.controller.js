'use strict';

const catchAsync = require('../../utils/catch-async');
const { ok } = require('../../utils/http-response');
const { getTenantId } = require('../../utils/request-helpers');
const service = require('./public-search.service');

const search = catchAsync(async (req, res) => {
  const { rows, meta } = await service.search(getTenantId(req), req.query);
  return ok(res, rows, meta);
});

module.exports = { search };
