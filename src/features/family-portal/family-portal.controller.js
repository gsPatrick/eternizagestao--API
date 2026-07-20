'use strict';

const AppError = require('../../utils/app-error');
const catchAsync = require('../../utils/catch-async');
const { ok, created } = require('../../utils/http-response');
const { requireFields, pick } = require('../../utils/validation');
const { getTenantId } = require('../../utils/request-helpers');
const service = require('./family-portal.service');

// Contexto das rotas autenticadas do portal: garante que a conta do token
// pertence ao tenant resolvido no request (isolamento multi-tenant).
function getPortalContext(req) {
  const tenantId = getTenantId(req);
  const account = req.portalAccount;
  if (!account || account.tenantId !== tenantId) {
    throw AppError.unauthorized('Conta do portal não pertence a este cliente.', 'PORTAL_TENANT_MISMATCH');
  }
  return { tenantId, account, personId: account.personId };
}

const register = catchAsync(async (req, res) => {
  requireFields(req.body, ['email', 'cpf']);
  return created(res, await service.register(getTenantId(req), pick(req.body, ['email', 'cpf'])));
});

const activate = catchAsync(async (req, res) => {
  requireFields(req.body, ['email', 'activationToken', 'password']);
  const data = pick(req.body, ['email', 'activationToken', 'password']);
  return ok(res, await service.activate(getTenantId(req), data));
});

const login = catchAsync(async (req, res) => {
  requireFields(req.body, ['email', 'password']);
  return created(res, await service.login(getTenantId(req), pick(req.body, ['email', 'password'])));
});

const getMe = catchAsync(async (req, res) => {
  const { tenantId, personId, account } = getPortalContext(req);
  return ok(res, await service.getMe(tenantId, personId, account));
});

const updateMe = catchAsync(async (req, res) => {
  const { tenantId, personId } = getPortalContext(req);
  const data = pick(req.body, service.PORTAL_EDITABLE_FIELDS);
  return ok(res, await service.updateMe(tenantId, personId, data));
});

const changePassword = catchAsync(async (req, res) => {
  const { tenantId, account } = getPortalContext(req);
  requireFields(req.body, ['currentPassword', 'newPassword']);
  const data = pick(req.body, ['currentPassword', 'newPassword']);
  return ok(res, await service.changePassword(tenantId, account, data));
});

const listDebts = catchAsync(async (req, res) => {
  const { tenantId, personId } = getPortalContext(req);
  return ok(res, await service.listDebts(tenantId, personId));
});

const listBillings = catchAsync(async (req, res) => {
  const { tenantId, personId } = getPortalContext(req);
  const { rows, meta } = await service.listBillings(tenantId, personId, req.query);
  return ok(res, rows, meta);
});

const reissueBilling = catchAsync(async (req, res) => {
  const { tenantId, personId } = getPortalContext(req);
  return created(res, await service.reissueBilling(tenantId, personId, req.params.id));
});

const listGraves = catchAsync(async (req, res) => {
  const { tenantId, personId } = getPortalContext(req);
  return ok(res, await service.listGraves(tenantId, personId));
});

const listDeceased = catchAsync(async (req, res) => {
  const { tenantId, personId } = getPortalContext(req);
  return ok(res, await service.listDeceased(tenantId, personId));
});

module.exports = {
  register, activate, login, getMe, updateMe, changePassword, listDebts, listBillings,
  reissueBilling, listGraves, listDeceased,
};
