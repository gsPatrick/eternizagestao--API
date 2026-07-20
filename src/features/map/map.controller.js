'use strict';

const catchAsync = require('../../utils/catch-async');
const { ok, created, noContent } = require('../../utils/http-response');
const { requireFields, pick } = require('../../utils/validation');
const { getTenantId } = require('../../utils/request-helpers');
const service = require('./map.service');

// cemeteryId aceito por rota (/cemeteries/:cemeteryId/...), query (?cemeteryId=)
// ou body — suporta tanto o estilo path-param quanto o /v1/orthophotos?cemeteryId=.
function resolveCemeteryId(req) {
  return req.params.cemeteryId || req.query.cemeteryId || req.body.cemeteryId;
}

const listOrthophotos = catchAsync(async (req, res) => {
  return ok(res, await service.listOrthophotos(getTenantId(req), resolveCemeteryId(req)));
});

const uploadOrthophoto = catchAsync(async (req, res) => {
  const data = pick(req.body, [
    'name', 'contentBase64', 'fileName', 'mimeType', 'fileUrl', 'bounds', 'corners', 'opacity',
    'widthPx', 'heightPx', 'resolutionCmPx', 'capturedAt', 'setActive',
  ]);
  // O painel envia só { cemeteryId, contentBase64, fileName, mimeType } — o
  // nome exibível deriva do arquivo quando não vier explícito.
  if (!data.name) data.name = data.fileName || 'Ortofoto';
  return created(res, await service.uploadOrthophoto(getTenantId(req), resolveCemeteryId(req), data));
});

const updateOrthophoto = catchAsync(async (req, res) => {
  const data = pick(req.body, ['name', 'bounds', 'corners', 'opacity', 'widthPx', 'heightPx', 'resolutionCmPx', 'capturedAt', 'isActive']);
  // alias do painel: { active } ≡ { isActive }
  if (data.isActive === undefined && req.body.active !== undefined) data.isActive = Boolean(req.body.active);
  return ok(res, await service.updateOrthophoto(getTenantId(req), req.params.id, data));
});

const removeOrthophoto = catchAsync(async (req, res) => {
  await service.removeOrthophoto(getTenantId(req), req.params.id);
  return noContent(res);
});

const getMapContext = catchAsync(async (req, res) => {
  return ok(res, await service.getMapContext(getTenantId(req), req.query.cemeteryId));
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
  listOrthophotos, uploadOrthophoto, updateOrthophoto, removeOrthophoto, getMapContext,
  listPaths, createPath, removePath, setGraveGeometry,
};
