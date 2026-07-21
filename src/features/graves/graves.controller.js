'use strict';

const catchAsync = require('../../utils/catch-async');
const { ok, created, noContent } = require('../../utils/http-response');
const { requireFields, pick } = require('../../utils/validation');
const { getTenantId, getUserId } = require('../../utils/request-helpers');
const service = require('./graves.service');

const list = catchAsync(async (req, res) => {
  const { rows, meta } = await service.list(getTenantId(req), req.query);
  return ok(res, rows, meta);
});

const statusCounts = catchAsync(async (req, res) => {
  return ok(res, await service.statusCounts(getTenantId(req), req.query));
});

const getById = catchAsync(async (req, res) => {
  return ok(res, await service.getById(getTenantId(req), req.params.id));
});

const summary = catchAsync(async (req, res) => {
  return ok(res, await service.summary(getTenantId(req), req.params.id));
});

const create = catchAsync(async (req, res) => {
  // `code` é OPCIONAL: o sistema do cliente identifica a sepultura por
  // cemitério + quadra + lote, e o service deriva o código daí quando não vem.
  // A LOCALIZAÇÃO pode vir por lotId (compat) OU por texto (cemeteryId +
  // quadra/lote) — a validação do "onde" fica no service.
  const data = pick(req.body, [
    'lotId', 'cemeteryId', 'block', 'street', 'lot',
    'ownerPersonId', 'responsiblePersonId',
    'parentGraveId', 'statusId', ...service.EDITABLE_FIELDS,
  ]);
  return created(res, await service.create(getTenantId(req), data, getUserId(req)));
});

const update = catchAsync(async (req, res) => {
  const data = pick(req.body, service.EDITABLE_FIELDS);
  return ok(res, await service.update(getTenantId(req), req.params.id, data, getUserId(req)));
});

const changeStatus = catchAsync(async (req, res) => {
  const { statusId, slug, reason } = req.body;
  return ok(res, await service.changeStatus(getTenantId(req), req.params.id, { statusId, slug, reason }, getUserId(req)));
});

const block = catchAsync(async (req, res) => {
  return ok(res, await service.setBlocked(getTenantId(req), req.params.id, { blocked: true, reason: req.body.reason }, getUserId(req)));
});

const unblock = catchAsync(async (req, res) => {
  return ok(res, await service.setBlocked(getTenantId(req), req.params.id, { blocked: false }, getUserId(req)));
});

const remove = catchAsync(async (req, res) => {
  await service.remove(getTenantId(req), req.params.id);
  return noContent(res);
});

// POST /v1/graves/:id/photo — fotografia da sepultura (imagem base64).
const uploadPhoto = catchAsync(async (req, res) => {
  requireFields(req.body, ['contentBase64', 'mimeType']);
  const data = pick(req.body, ['contentBase64', 'fileName', 'mimeType']);
  return ok(res, await service.uploadPhoto(getTenantId(req), req.params.id, data));
});

module.exports = { list, statusCounts, getById, summary, create, update, changeStatus, block, unblock, remove, uploadPhoto };
