'use strict';

const catchAsync = require('../../utils/catch-async');
const { ok, created, noContent } = require('../../utils/http-response');
const { requireFields, pick } = require('../../utils/validation');
const { getTenantId } = require('../../utils/request-helpers');
const service = require('./people.service');

const list = catchAsync(async (req, res) => {
  const { rows, meta } = await service.list(getTenantId(req), req.query);
  return ok(res, rows, meta);
});

const summary = catchAsync(async (req, res) => {
  return ok(res, await service.summary(getTenantId(req)));
});

const getById = catchAsync(async (req, res) => {
  return ok(res, await service.getById(getTenantId(req), req.params.id));
});

const create = catchAsync(async (req, res) => {
  requireFields(req.body, ['fullName']);
  return created(res, await service.create(getTenantId(req), pick(req.body, service.EDITABLE_FIELDS)));
});

const update = catchAsync(async (req, res) => {
  return ok(res, await service.update(getTenantId(req), req.params.id, pick(req.body, service.EDITABLE_FIELDS)));
});

const remove = catchAsync(async (req, res) => {
  await service.remove(getTenantId(req), req.params.id);
  return noContent(res);
});

const addRelationship = catchAsync(async (req, res) => {
  requireFields(req.body, ['relatedPersonId', 'relationshipType']);
  const data = pick(req.body, ['relatedPersonId', 'relationshipType', 'notes']);
  return created(res, await service.addRelationship(getTenantId(req), req.params.id, data));
});

const removeRelationship = catchAsync(async (req, res) => {
  await service.removeRelationship(getTenantId(req), req.params.id, req.params.relationshipId);
  return noContent(res);
});

const invitePortal = catchAsync(async (req, res) => {
  const data = pick(req.body, ['email']);
  return created(res, await service.invitePortal(getTenantId(req), req.params.id, data));
});

const revokePortal = catchAsync(async (req, res) => {
  return ok(res, await service.revokePortal(getTenantId(req), req.params.id));
});

module.exports = {
  list, summary, getById, create, update, remove,
  addRelationship, removeRelationship, invitePortal, revokePortal,
};
