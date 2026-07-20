'use strict';

const catchAsync = require('../../utils/catch-async');
const { ok, created, noContent } = require('../../utils/http-response');
const { requireFields, requireOneOf, pick } = require('../../utils/validation');
const { getTenantId } = require('../../utils/request-helpers');
const service = require('./document-templates.service');

const list = catchAsync(async (req, res) => {
  const { rows, meta } = await service.list(getTenantId(req), req.query);
  return ok(res, rows, meta);
});

const getById = catchAsync(async (req, res) => {
  return ok(res, await service.getById(getTenantId(req), req.params.id));
});

const create = catchAsync(async (req, res) => {
  requireFields(req.body, ['documentType', 'name']);
  requireOneOf(req.body.documentType, service.DOCUMENT_TYPES, 'documentType');
  const data = pick(req.body, service.CREATE_FIELDS);
  const template = await service.create(getTenantId(req), data, {
    deactivateOthers: req.body.deactivateOthers === true,
  });
  return created(res, template);
});

const update = catchAsync(async (req, res) => {
  const data = pick(req.body, service.UPDATE_FIELDS);
  return ok(res, await service.update(getTenantId(req), req.params.id, data));
});

const remove = catchAsync(async (req, res) => {
  await service.remove(getTenantId(req), req.params.id);
  return noContent(res);
});

module.exports = { list, getById, create, update, remove };
