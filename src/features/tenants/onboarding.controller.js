'use strict';

const catchAsync = require('../../utils/catch-async');
const { ok } = require('../../utils/http-response');
const { pick } = require('../../utils/validation');
const { getTenantId } = require('../../utils/request-helpers');
const service = require('./tenants.service');

// GET /v1/tenant/onboarding — status + config atual do tenant do usuário logado.
const getOnboarding = catchAsync(async (req, res) => {
  return ok(res, await service.getOnboarding(getTenantId(req)));
});

// PATCH /v1/tenant/onboarding — o admin configura o PRÓPRIO tenant (isolado).
const updateOnboarding = catchAsync(async (req, res) => {
  return ok(res, await service.updateOnboarding(getTenantId(req), req.body || {}));
});

// POST /v1/tenant/logo — upload da logo do PRÓPRIO tenant (isolado pelo token).
const uploadLogo = catchAsync(async (req, res) => {
  const data = pick(req.body || {}, ['contentBase64', 'fileName', 'mimeType']);
  return ok(res, await service.uploadLogo(getTenantId(req), data));
});

module.exports = { getOnboarding, updateOnboarding, uploadLogo };
