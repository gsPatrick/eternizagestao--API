'use strict';

const catchAsync = require('../../utils/catch-async');
const { ok, created, noContent } = require('../../utils/http-response');
const { requireFields, pick } = require('../../utils/validation');
const { getTenantId, getUserId } = require('../../utils/request-helpers');
const service = require('./attachments.service');

const list = catchAsync(async (req, res) => {
  const { rows, meta } = await service.list(getTenantId(req), req.query);
  return ok(res, rows, meta);
});

const create = catchAsync(async (req, res) => {
  requireFields(req.body, ['attachableType', 'attachableId', 'fileName', 'contentBase64']);
  const data = pick(req.body, [
    'attachableType', 'attachableId', 'category', 'fileName', 'contentBase64', 'mimeType', 'description',
  ]);
  return created(res, await service.create(getTenantId(req), data, getUserId(req)));
});

const remove = catchAsync(async (req, res) => {
  await service.remove(getTenantId(req), req.params.id);
  return noContent(res);
});

module.exports = { list, create, remove };
