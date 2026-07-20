'use strict';

/**
 * Marca white-label do órgão gestor (Tenant) para documentos oficiais,
 * exportações a órgãos públicos e relatórios. FONTE ÚNICA — replica a postura
 * dos e-mails (src/emails/render.js): nome do órgão + logo + paleta a partir de
 * primaryColor. Os dados institucionais vêm de Tenant.documentHeader (JSONB:
 * nome/cnpj/telefone/email/cabecalho) com fallback nas colunas do próprio Tenant.
 *
 *   const { brandingVars } = require('./tenant-branding');
 *   const brand = brandingVars(tenant); // { tenant_name, orgao_*, accent, logo_url, ... }
 */

const DEFAULT_ACCENT = '#032e59'; // navy padrão Eterniza (quando não há primaryColor)

const clamp = (x) => Math.max(0, Math.min(255, Math.round(x)));
const rgbToHex = (r, g, b) =>
  `#${((1 << 24) | (clamp(r) << 16) | (clamp(g) << 8) | clamp(b)).toString(16).slice(1)}`;

function toRgb(hex) {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(String(hex || '').trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function darken(hex, factor = 0.5) {
  const c = toRgb(hex);
  return c ? rgbToHex(c.r * factor, c.g * factor, c.b * factor) : hex;
}

function lighten(hex, amount = 0.85) {
  const c = toRgb(hex);
  return c ? rgbToHex(c.r + (255 - c.r) * amount, c.g + (255 - c.g) * amount, c.b + (255 - c.b) * amount) : hex;
}

function rgba(hex, alpha = 1) {
  const c = toRgb(hex);
  return c ? `rgba(${c.r}, ${c.g}, ${c.b}, ${alpha})` : hex;
}

// Cor de texto legível SOBRE a cor de acento (branco em fundos escuros, tinta escura em claros).
function readableOn(hex) {
  const c = toRgb(hex);
  if (!c) return '#ffffff';
  const L = (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) / 255;
  return L > 0.62 ? '#1f2933' : '#ffffff';
}

/**
 * Deriva as variáveis de marca de um Tenant (pode ser null → padrão Eterniza).
 * As chaves são estáveis e ficam disponíveis tanto para o DEFAULT_HTML quanto
 * para os templates customizados do tenant ({{logo_url}}, {{tenant_name}},
 * {{orgao_nome}}, {{orgao_cnpj}}, {{accent}}, ...).
 */
function brandingVars(tenant) {
  const t = tenant || {};
  const dh = t.documentHeader && typeof t.documentHeader === 'object' ? t.documentHeader : {};

  const accent = toRgb(t.primaryColor) ? t.primaryColor : DEFAULT_ACCENT;
  const tenantName = t.name || 'Eterniza Gestão';
  const orgaoNome = dh.nome || t.name || tenantName;

  const line1 = [t.addressStreet, t.addressNumber].filter(Boolean).join(', ');
  const city = [t.addressCity, t.addressState].filter(Boolean).join(' - ');
  const endereco = [line1, t.addressDistrict, city].filter(Boolean).join(' · ');

  return {
    tenant_name: tenantName,
    subdomain: t.subdomain || '',
    logo_url: t.logoUrl || '',
    // Órgão gestor (documentHeader com fallback nas colunas do Tenant)
    orgao_nome: orgaoNome,
    orgao_cnpj: dh.cnpj || t.cnpj || '',
    orgao_telefone: dh.telefone || t.phone || '',
    orgao_email: dh.email || t.email || '',
    orgao_cabecalho: dh.cabecalho || '',
    orgao_endereco: endereco,
    orgao_cidade: city,
    // Paleta derivada da cor primária da cidade
    accent,
    accent_bright: lighten(accent, 0.18),
    accent_deep: darken(accent, 0.62),
    accent_soft: rgba(accent, 0.08),
    accent_border: rgba(accent, 0.32),
    accent_contrast: readableOn(accent),
  };
}

module.exports = { brandingVars, DEFAULT_ACCENT };
