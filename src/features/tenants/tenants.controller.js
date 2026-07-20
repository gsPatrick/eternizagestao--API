'use strict';

const catchAsync = require('../../utils/catch-async');
const { ok, created, noContent } = require('../../utils/http-response');
const { requireFields, pick } = require('../../utils/validation');
const service = require('./tenants.service');

const list = catchAsync(async (req, res) => {
  const { rows, meta } = await service.list(req.query);
  return ok(res, rows, meta);
});

const getById = catchAsync(async (req, res) => {
  return ok(res, service.serialize(await service.getById(req.params.id)));
});

// POST /v1/tenants — cria a cidade (tenant) + primeiro admin, 2 modos.
// Body: { tenant:{name,subdomain,...marca}, admin:{name,email}, mode:'completo'|'delegado' }
const create = catchAsync(async (req, res) => {
  const { tenant = {}, admin = {}, mode = 'completo' } = req.body || {};
  requireFields(tenant, ['name', 'subdomain']);
  requireFields(admin, ['name', 'email']);
  return created(res, await service.create({ tenant, admin, mode }, req.user));
});

const update = catchAsync(async (req, res) => {
  const data = pick(req.body, service.EDITABLE_FIELDS);
  return ok(res, await service.update(req.params.id, data));
});

const remove = catchAsync(async (req, res) => {
  await service.remove(req.params.id);
  return noContent(res);
});

// POST /v1/tenants/:id/activate — reativa a cidade.
const activate = catchAsync(async (req, res) => {
  return ok(res, await service.setActive(req.params.id, true));
});

// POST /v1/tenants/:id/deactivate — desativa a cidade (bloqueia login/resolução).
const deactivate = catchAsync(async (req, res) => {
  return ok(res, await service.setActive(req.params.id, false));
});

// POST /v1/tenants/:id/resend-invite — reenvia o convite ao primeiro admin
// (ou a um e-mail informado no body: { email }).
const resendInvite = catchAsync(async (req, res) => {
  return ok(res, await service.resendInvite(req.params.id, req.body?.email, req.user));
});

// GET /v1/tenants/current — branding do tenant do subdomínio (sem auth)
const current = catchAsync(async (req, res) => {
  return ok(res, service.publicProfile(req.tenant));
});

module.exports = { list, getById, create, update, remove, activate, deactivate, resendInvite, current };
