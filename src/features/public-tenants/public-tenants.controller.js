'use strict';

const catchAsync = require('../../utils/catch-async');
const { ok } = require('../../utils/http-response');
const { getTenantId } = require('../../utils/request-helpers');
const service = require('./public-tenants.service');

// GET /public/tenants — lista pública de clientes ativos (cidades). Sem auth,
// sem tenant no contexto.
const listTenants = catchAsync(async (req, res) => {
  return ok(res, await service.listTenants());
});

// GET /public/cemeteries — lista pública de cemitérios do tenant (id, name).
// Tenant resolvido via X-Tenant-Subdomain (tenantResolver obrigatório na rota).
const listCemeteries = catchAsync(async (req, res) => {
  return ok(res, await service.listCemeteries(getTenantId(req)));
});

// GET /public/cemeteries/:cemeteryId/agenda — agenda pública do cemitério.
// Tenant resolvido via X-Tenant-Subdomain (tenantResolver obrigatório na rota).
const cemeteryAgenda = catchAsync(async (req, res) => {
  return ok(res, await service.cemeteryAgenda(getTenantId(req), req.params.cemeteryId));
});

module.exports = { listTenants, listCemeteries, cemeteryAgenda };
