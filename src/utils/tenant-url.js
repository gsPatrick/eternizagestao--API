'use strict';

/**
 * URLs POR CIDADE (multi-tenant) — deriva a base do link a partir do SUBDOMÍNIO
 * da cidade, para que e-mails de convite/ativação/redefinição levem ao domínio
 * BRANDED da cidade (ex.: https://guarulhos.eterniza.com.br) em vez de um
 * domínio genérico global.
 *
 * Base: `https://<subdomain>.<BASE_DOMAIN>` (BASE_DOMAIN de env, mesma paridade
 * do `computeDomain` de tenants.service). Quando NÃO há tenant/subdomínio
 * resolvível, cai nos envs globais legados (PANEL_URL/APP_WEB_URL para o painel,
 * PORTAL_URL para o portal) — FALLBACK, nunca o caminho principal.
 *
 * DNS wildcard (*.BASE_DOMAIN) + TLS é INFRAESTRUTURA — fora do código.
 */

// Domínio base da plataforma — mantém paridade com tenants.service.computeDomain.
const BASE_DOMAIN = process.env.BASE_DOMAIN || 'eterniza.com.br';

// Extrai/normaliza o subdomínio de um tenant (aceita objeto model, POJO ou string).
function subdomainOf(tenant) {
  if (!tenant) return null;
  const raw = typeof tenant === 'string' ? tenant : tenant.subdomain;
  const sub = String(raw || '').toLowerCase().trim();
  return sub || null;
}

// Remove barras finais para concatenar paths com segurança.
function trimTrailingSlash(url) {
  return String(url || '').replace(/\/+$/, '');
}

/**
 * Base do PAINEL administrativo da cidade: `https://<sub>.<BASE_DOMAIN>`.
 * Fallback (sem tenant/subdomínio): PANEL_URL → APP_WEB_URL → localhost:3000.
 */
function tenantBaseUrl(tenant) {
  const sub = subdomainOf(tenant);
  if (sub) return `https://${sub}.${BASE_DOMAIN}`;
  return trimTrailingSlash(
    process.env.PANEL_URL || process.env.APP_WEB_URL || 'http://localhost:3000'
  );
}

/**
 * Base do PORTAL DA FAMÍLIA da cidade. Hoje o portal vive no MESMO host da
 * cidade (mesmo subdomínio do painel). Fallback dedicado: PORTAL_URL.
 */
function portalBaseUrl(tenant) {
  const sub = subdomainOf(tenant);
  if (sub) return `https://${sub}.${BASE_DOMAIN}`;
  return trimTrailingSlash(process.env.PORTAL_URL || 'https://portal.local');
}

// Link de ativação do Portal da Família — path preservado: `/ativar/<token>`.
function portalActivationUrl(tenant, rawToken) {
  return `${portalBaseUrl(tenant)}/ativar/${rawToken}`;
}

// Link de acesso ao PAINEL (convite/redefinição) — path preservado: `/login`.
function panelLoginUrl(tenant) {
  return `${tenantBaseUrl(tenant)}/login`;
}

module.exports = {
  BASE_DOMAIN,
  subdomainOf,
  tenantBaseUrl,
  portalBaseUrl,
  portalActivationUrl,
  panelLoginUrl,
};
