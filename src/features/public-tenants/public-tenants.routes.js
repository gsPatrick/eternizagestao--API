'use strict';

const { Router } = require('express');
const controller = require('./public-tenants.controller');
const tenantResolver = require('../../middlewares/tenant-resolver');
const rateLimit = require('../../middlewares/rate-limit');

const router = Router();

// Rate limit por-rota (não via router.use): assim este router pode ser montado
// junto de outros em /v1/public sem impor middleware às rotas dos vizinhos
// (public-search/public-map) que apenas atravessam este stack.
const limiter = rateLimit({ windowMs: 60_000, max: 60, keyPrefix: 'public-tenants' });

// Lista de cidades: NÃO exige tenant (não passa pelo tenantResolver).
router.get('/tenants', limiter, controller.listTenants);

// Lista de cemitérios do tenant: tenant OBRIGATÓRIO (X-Tenant-Subdomain / subdomínio).
router.get(
  '/cemeteries',
  limiter,
  tenantResolver({ required: true }),
  controller.listCemeteries
);

// Agenda pública do cemitério: tenant OBRIGATÓRIO (X-Tenant-Subdomain / subdomínio).
router.get(
  '/cemeteries/:cemeteryId/agenda',
  limiter,
  tenantResolver({ required: true }),
  controller.cemeteryAgenda
);

module.exports = router;
