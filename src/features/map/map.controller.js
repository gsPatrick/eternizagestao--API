'use strict';

const catchAsync = require('../../utils/catch-async');
const { ok, created, noContent } = require('../../utils/http-response');
const { requireFields, pick } = require('../../utils/validation');
const { getTenantId } = require('../../utils/request-helpers');
const service = require('./map.service');

const listOrthophotos = catchAsync(async (req, res) => {
  return ok(res, await service.listOrthophotos(getTenantId(req), req.params.cemeteryId));
});

const uploadOrthophoto = catchAsync(async (req, res) => {
  requireFields(req.body, ['name']);
  const data = pick(req.body, [
    'name', 'contentBase64', 'fileName', 'mimeType', 'fileUrl', 'bounds',
    'widthPx', 'heightPx', 'resolutionCmPx', 'capturedAt', 'setActive',
  ]);
  return created(res, await service.uploadOrthophoto(getTenantId(req), req.params.cemeteryId, data));
});

const updateOrthophoto = catchAsync(async (req, res) => {
  const data = pick(req.body, ['name', 'bounds', 'widthPx', 'heightPx', 'resolutionCmPx', 'capturedAt', 'isActive']);
  return ok(res, await service.updateOrthophoto(getTenantId(req), req.params.id, data));
});

const listPaths = catchAsync(async (req, res) => {
  return ok(res, await service.listPaths(getTenantId(req), req.params.cemeteryId));
});

const createPath = catchAsync(async (req, res) => {
  requireFields(req.body, ['pathCoordinates']);
  const data = pick(req.body, ['name', 'pathCoordinates', 'notes']);
  return created(res, await service.createPath(getTenantId(req), req.params.cemeteryId, data));
});

const removePath = catchAsync(async (req, res) => {
  await service.removePath(getTenantId(req), req.params.id);
  return noContent(res);
});

const setGraveGeometry = catchAsync(async (req, res) => {
  const data = pick(req.body, ['geoPolygon', 'latitude', 'longitude']);
  return ok(res, await service.setGraveGeometry(getTenantId(req), req.params.graveId, data));
});

module.exports = {
  listOrthophotos, uploadOrthophoto, updateOrthophoto,
  listPaths, createPath, removePath, setGraveGeometry,
};
