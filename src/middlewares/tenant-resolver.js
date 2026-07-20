'use strict';

const AppError = require('../utils/app-error');
const catchAsync = require('../utils/catch-async');
const { setActor } = require('./request-context');
const { Tenant } = require('../models');

// Rótulos de 2º nível (ccTLDs com SLD): com.br, co.uk, gov.br… Servem só para
// medir quantos rótulos formam o domínio raiz e distinguir apex de subdomínio.
const SECOND_LEVEL = new Set([
  'com', 'co', 'org', 'net', 'gov', 'edu', 'mil', 'gob', 'ac', 'or', 'ne', 'in',
]);

function apexLabelCount(labels) {
  if (labels.length >= 3 && SECOND_LEVEL.has(labels[labels.length - 2])) return 3;
  return 2;
}

// Extrai o subdomínio de cidade — AGNÓSTICO ao domínio raiz: é o primeiro rótulo
// quando o host tem mais rótulos que o apex. A regra é do subdomínio, então
// serve para qualquer domínio (eternizagestao.com.br, domínio próprio, etc.).
//   guarulhos.eternizagestao.com.br → guarulhos ; eternizagestao.com.br → null
function extractSubdomain(hostname = '') {
  const host = String(hostname).split(':')[0].toLowerCase().trim();
  if (!host || host === 'localhost' || /^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return null;
  const labels = host.split('.').filter(Boolean);
  if (labels.length <= apexLabelCount(labels)) return null; // apex puro / raiz
  return labels[0] || null;
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
