'use strict';

const catchAsync = require('../../utils/catch-async');
const { ok, created } = require('../../utils/http-response');
const { requireFields, pick, requireOneOf } = require('../../utils/validation');
const { getTenantId, getUserId } = require('../../utils/request-helpers');
const service = require('./exhumations.service');

const DESTINATION_TYPES = ['ossario', 'outro_jazigo', 'cremacao', 'translado_externo', 'outro'];

const create = catchAsync(async (req, res) => {
  requireFields(req.body, ['graveId', 'deceasedId']);
  const data = pick(req.body, service.CREATE_FIELDS);
  return created(res, await service.create(getTenantId(req), data, getUserId(req)));
});

const authorize = catchAsync(async (req, res) => {
  const data = pick(req.body, ['authorizationNumber']);
  return ok(res, await service.authorize(getTenantId(req), req.params.id, data, getUserId(req)));
});

const schedule = catchAsync(async (req, res) => {
  requireFields(req.body, ['scheduledDate']);
  return ok(res, await service.schedule(getTenantId(req), req.params.id, pick(req.body, ['scheduledDate'])));
});

const perform = catchAsync(async (req, res) => {
  requireFields(req.body, ['destinationType']);
  requireOneOf(req.body.destinationType, DESTINATION_TYPES, 'destinationType');
  const data = pick(req.body, [
    'performedAt', 'performedBy', 'destinationType', 'destinationGraveId',
    'destinationOssuaryNicheId', 'destinationDetails',
  ]);
  return ok(res, await service.perform(getTenantId(req), req.params.id, data, getUserId(req)));
});

// POST /v1/exhumations/performed — exumação JÁ REALIZADA em uma chamada
// (bloco "Exumação" do cadastro de sepultado).
const registerPerformed = catchAsync(async (req, res) => {
  requireFields(req.body, ['graveId', 'deceasedId', 'destinationType']);
  requireOneOf(req.body.destinationType, DESTINATION_TYPES, 'destinationType');
  const data = pick(req.body, [
    'graveId', 'deceasedId', 'reason', 'authorizationNumber',
    'performedAt', 'performedBy', 'destinationType', 'destinationGraveId',
    'destinationOssuaryNicheId', 'destinationDetails',
  ]);
  return created(res, await service.registerPerformed(getTenantId(req), data, getUserId(req)));
});

const cancel = catchAsync(async (req, res) => {
  return ok(res, await service.cancel(getTenantId(req), req.params.id, pick(req.body, ['reason'])));
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

module.exports = { create, registerPerformed, authorize, schedule, perform, cancel, list, stats, getById };
