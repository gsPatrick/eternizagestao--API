'use strict';

const catchAsync = require('../../utils/catch-async');
const { ok, created, noContent } = require('../../utils/http-response');
const { requireFields, pick, requireOneOf } = require('../../utils/validation');
const { getTenantId, getUserId } = require('../../utils/request-helpers');
const service = require('./ossuaries.service');

const NICHE_STATUSES = ['livre', 'ocupado', 'reservado', 'em_manutencao'];

// ---- ossários ----

const createOssuary = catchAsync(async (req, res) => {
  requireFields(req.body, ['name']);
  const data = pick(req.body, service.OSSUARY_FIELDS);
  return created(res, await service.createOssuary(getTenantId(req), req.params.cemeteryId, data));
});

const listByCemetery = catchAsync(async (req, res) => {
  return ok(res, await service.listByCemetery(getTenantId(req), req.params.cemeteryId));
});

const getOssuary = catchAsync(async (req, res) => {
  return ok(res, await service.getOssuary(getTenantId(req), req.params.id));
});

const updateOssuary = catchAsync(async (req, res) => {
  const data = pick(req.body, service.OSSUARY_FIELDS);
  return ok(res, await service.updateOssuary(getTenantId(req), req.params.id, data));
});

const removeOssuary = catchAsync(async (req, res) => {
  await service.removeOssuary(getTenantId(req), req.params.id);
  return noContent(res);
});

// ---- nichos ----

const createNiches = catchAsync(async (req, res) => {
  if (Array.isArray(req.body.niches)) {
    req.body.niches.forEach((niche) => requireFields(niche, ['code']));
    const niches = req.body.niches.map((niche) => pick(niche, service.NICHE_FIELDS));
    return created(res, await service.createNiches(getTenantId(req), req.params.ossuaryId, { niches }));
  }
  requireFields(req.body, ['code']);
  const data = pick(req.body, service.NICHE_FIELDS);
  return created(res, await service.createNiches(getTenantId(req), req.params.ossuaryId, data));
});

const listNiches = catchAsync(async (req, res) => {
  return ok(res, await service.listNiches(getTenantId(req), req.params.ossuaryId, req.query));
});

const updateNiche = catchAsync(async (req, res) => {
  if (req.body.status !== undefined) requireOneOf(req.body.status, NICHE_STATUSES, 'status');
  const data = pick(req.body, ['status', 'notes']);
  return ok(res, await service.updateNiche(getTenantId(req), req.params.id, data));
});

// ---- depósitos ----

const listNicheDeposits = catchAsync(async (req, res) => {
  return ok(res, await service.listNicheDeposits(getTenantId(req), req.params.id));
});

const removeDeposit = catchAsync(async (req, res) => {
  requireFields(req.body, ['removalReason']);
  const data = pick(req.body, ['removalReason', 'removalDestination']);
  return ok(res, await service.removeDeposit(getTenantId(req), req.params.id, data, getUserId(req)));
});

module.exports = {
  createOssuary, listByCemetery, getOssuary, updateOssuary, removeOssuary,
  createNiches, listNiches, updateNiche, listNicheDeposits, removeDeposit,
};
