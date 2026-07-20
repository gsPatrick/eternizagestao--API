'use strict';

const catchAsync = require('../../utils/catch-async');
const { ok } = require('../../utils/http-response');
const { requireFields } = require('../../utils/validation');
const service = require('./sessions.service');

const login = catchAsync(async (req, res) => {
  requireFields(req.body, ['email', 'password']);
  const result = await service.login({
    email: req.body.email,
    password: req.body.password,
    tenant: req.tenant, // resolvido (opcional) pelo tenant-resolver
  });
  return ok(res, result);
});

const refresh = catchAsync(async (req, res) => {
  requireFields(req.body, ['refreshToken']);
  const result = await service.refresh({ refreshToken: req.body.refreshToken });
  return ok(res, result);
});

const me = catchAsync(async (req, res) => {
  const result = await service.me(req.user.id);
  return ok(res, result);
});

module.exports = { login, refresh, me };
