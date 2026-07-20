'use strict';

const catchAsync = require('../../utils/catch-async');
const { ok, created, noContent } = require('../../utils/http-response');
const { requireFields, pick } = require('../../utils/validation');
const { getTenantId } = require('../../utils/request-helpers');
const service = require('./users.service');

const list = catchAsync(async (req, res) => {
  const { rows, meta } = await service.list(getTenantId(req), req.query);
  return ok(res, rows, meta);
});

const getById = catchAsync(async (req, res) => {
  return ok(res, await service.getById(getTenantId(req), req.params.id));
});

const create = catchAsync(async (req, res) => {
  requireFields(req.body, ['name', 'email', 'password']);
  const data = pick(req.body, ['name', 'email', 'phone', 'password', 'role']);
  return created(res, await service.create(getTenantId(req), data));
});

const update = catchAsync(async (req, res) => {
  const data = pick(req.body, ['name', 'email', 'phone', 'role']);
  return ok(res, await service.update(getTenantId(req), req.params.id, data));
});

const changePassword = catchAsync(async (req, res) => {
  requireFields(req.body, ['password']);
  await service.changePassword(getTenantId(req), req.params.id, req.body.password);
  return noContent(res);
});

const activate = catchAsync(async (req, res) => {
  return ok(res, await service.setActive(getTenantId(req), req.params.id, true));
});

const deactivate = catchAsync(async (req, res) => {
  return ok(res, await service.setActive(getTenantId(req), req.params.id, false));
});

const remove = catchAsync(async (req, res) => {
  await service.remove(getTenantId(req), req.params.id);
  return noContent(res);
});

const invite = catchAsync(async (req, res) => {
  requireFields(req.body, ['name', 'email']);
  const data = pick(req.body, ['name', 'email', 'phone', 'role']);
  return created(res, await service.invite(getTenantId(req), data, req.user));
});

const resendInvite = catchAsync(async (req, res) => {
  return ok(res, await service.resendInvite(getTenantId(req), req.params.id, req.user));
});

const passwordReset = catchAsync(async (req, res) => {
  return ok(res, await service.sendPasswordReset(getTenantId(req), req.params.id));
});

module.exports = {
  list,
  getById,
  create,
  update,
  changePassword,
  activate,
  deactivate,
  remove,
  invite,
  resendInvite,
  passwordReset,
};
