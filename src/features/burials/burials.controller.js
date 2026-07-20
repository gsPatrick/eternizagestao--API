'use strict';

const catchAsync = require('../../utils/catch-async');
const { ok, created } = require('../../utils/http-response');
const { requireFields, pick } = require('../../utils/validation');
const { getTenantId, getUserId } = require('../../utils/request-helpers');
const service = require('./burials.service');

const create = catchAsync(async (req, res) => {
  requireFields(req.body, ['graveId', 'deceasedId', 'burialDate']);
  const data = pick(req.body, service.CREATE_FIELDS);
  const options = {
    force: req.body.force === true,
    role: req.user?.role,
    // auto-emite a Autorização de Sepultamento por padrão; front pode desligar
    autoAuthorize: req.body.autoAuthorize !== false,
  };
  return created(res, await service.create(getTenantId(req), data, getUserId(req), options));
});

const list = catchAsync(async (req, res) => {
  const { rows, meta } = await service.list(getTenantId(req), req.query);
  return ok(res, rows, meta);
});

const stats = catchAsync(async (req, res) => {
  return ok(res, await service.stats(getTenantId(req), req.query));
});

const getById = catchAsync(async (req, res) => {
  return ok(res, await service.getById(getTenantId(req), req.params.id));
});

module.exports = { create, list, stats, getById };
