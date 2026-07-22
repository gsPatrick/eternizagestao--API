'use strict';

const catchAsync = require('../../utils/catch-async');
const { ok, created, noContent } = require('../../utils/http-response');
const { requireFields, pick } = require('../../utils/validation');
const { getTenantId } = require('../../utils/request-helpers');
const service = require('./deceased.service');

const list = catchAsync(async (req, res) => {
  const { rows, meta } = await service.list(getTenantId(req), req.query);
  return ok(res, rows, meta);
});

const locationCounts = catchAsync(async (req, res) => {
  return ok(res, await service.locationCounts(getTenantId(req), req.query));
});

const getById = catchAsync(async (req, res) => {
  return ok(res, await service.getById(getTenantId(req), req.params.id));
});

const create = catchAsync(async (req, res) => {
  requireFields(req.body, ['fullName']);
  return created(res, await service.create(getTenantId(req), pick(req.body, service.EDITABLE_FIELDS)));
});

const update = catchAsync(async (req, res) => {
  // Aceita também sepultura e data de sepultamento: para o operador são dados
  // do sepultado, ainda que morem no registro de sepultamento.
  const data = pick(req.body, [...service.EDITABLE_FIELDS, ...service.BURIAL_FIELDS]);
  return ok(res, await service.update(getTenantId(req), req.params.id, data));
});

const remove = catchAsync(async (req, res) => {
  // ?force=true: o operador confirmou na tela, ciente do impacto listado.
  const force = req.query.force === 'true' || req.query.force === true;
  await service.remove(getTenantId(req), req.params.id, { force });
  return noContent(res);
});

// GET /v1/deceased/:id/delete-impact — o que a exclusão arrasta junto.
const deleteImpact = catchAsync(async (req, res) => {
  return ok(res, await service.deleteImpact(getTenantId(req), req.params.id));
});

// POST /v1/deceased/:id/photo — upload da foto (base64). Body: { contentBase64, fileName, mimeType }
const uploadPhoto = catchAsync(async (req, res) => {
  requireFields(req.body, ['contentBase64', 'mimeType']);
  const data = pick(req.body, ['contentBase64', 'fileName', 'mimeType']);
  return ok(res, await service.uploadPhoto(getTenantId(req), req.params.id, data));
});

// POST /v1/deceased/:id/death-certificate — declaração/certidão de óbito (PDF base64).
const uploadDeathCertificate = catchAsync(async (req, res) => {
  requireFields(req.body, ['contentBase64', 'mimeType']);
  const data = pick(req.body, ['contentBase64', 'fileName', 'mimeType']);
  return ok(res, await service.uploadDeathCertificate(getTenantId(req), req.params.id, data));
});

module.exports = { list, locationCounts, getById, create, update, remove, deleteImpact, uploadPhoto, uploadDeathCertificate };
