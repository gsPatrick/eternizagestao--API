'use strict';

const AppError = require('../utils/app-error');
const catchAsync = require('../utils/catch-async');
const { setActor } = require('./request-context');
const { Tenant } = require('../models');

// Extrai o subdomínio de um hostname (cidade.plataforma.com => cidade).
function extractSubdomain(hostname = '') {
  const parts = hostname.split('.');
  // localhost / IP / domínio raiz não têm subdomínio útil
  if (parts.length < 3 || hostname === 'localhost') return null;
  return parts[0];
}

/**
 * Resolve o tenant do request e popula req.tenant.
 *
 * Segurança do isolamento multi-tenant:
 *  - Usuário comum autenticado: o tenant é SEMPRE o do próprio usuário
 *    (header/subdomínio são ignorados — impede acesso cruzado).
 *  - super_admin ou rota pública: resolve por header X-Tenant-Subdomain
 *    ou pelo subdomínio do Host.
 */
function tenantResolver({ required = true } = {}) {
  return catchAsync(async (req, res, next) => {
    let tenant = null;

    if (req.user && req.user.tenantId) {
      tenant = await Tenant.findByPk(req.user.tenantId);
    } else {
      const sub =
        req.headers['x-tenant-subdomain'] || extractSubdomain(req.hostname);
      if (sub) {
        tenant = await Tenant.findOne({ where: { subdomain: sub, active: true } });
      }
    }

    if (!tenant && required) {
      throw AppError.badRequest(
        'Tenant não identificado. Acesse pelo subdomínio do cliente ou envie X-Tenant-Subdomain.',
        'TENANT_NOT_RESOLVED'
      );
    }
    if (tenant && !tenant.active) {
      throw AppError.forbidden('Cliente desativado.', 'TENANT_INACTIVE');
    }

    req.tenant = tenant;

    // Propaga o tenant resolvido para o contexto ALS (auditoria multi-tenant).
    if (tenant) setActor({ tenantId: tenant.id });

    return next();
  });
}

module.exports = tenantResolver;
