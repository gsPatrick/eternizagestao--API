'use strict';

const AppError = require('./app-error');

// Tenant efetivo do request (populado pelo middleware tenant-resolver).
// Toda query de feature DEVE filtrar por este id — é o coração do isolamento.
function getTenantId(req) {
  if (!req.tenant?.id) {
    throw AppError.badRequest(
      'Tenant não identificado. Use o subdomínio do cliente ou o header X-Tenant-Subdomain.',
      'TENANT_NOT_RESOLVED'
    );
  }
  return req.tenant.id;
}

// Id do usuário autenticado (quando houver) — para campos registered_by/created_by.
function getUserId(req) {
  return req.user?.id || null;
}

module.exports = { getTenantId, getUserId };
