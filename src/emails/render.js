'use strict';

/**
 * Renderizador de e-mails do sistema.
 *
 * Cada disparo tem um template HTML em ./templates/<nome>.html (só o CORPO),
 * embrulhado pelo ./layout.html (cabeçalho com a marca — o mesmo visual navy
 * do login/gate — + rodapé). Variáveis usam a sintaxe {{chave}}.
 *
 * White label: a cor de acento do cabeçalho/botões vem do tenant (primaryColor);
 * na ausência, cai no navy padrão da marca Eterniza.
 *
 *   const { renderEmail } = require('./src/emails/render');
 *   const { subject, html } = renderEmail('fee-reminder', {
 *     nome: 'João', jazigo: 'A-12', valor: 'R$ 150,00',
 *     vencimento: '21/07/2026', cta_url: 'https://...'
 *   }, { tenant });
 */

const fs = require('fs');
const path = require('path');
const { EMAILS } = require('./index');
const storage = require('../providers/storage');

// MIME por extensão para embutir a logo local como data URI no e-mail.
const LOGO_MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
};

// Resolve a fonte da logo para o e-mail. Logo LOCAL (/files/...) é EMBUTIDA como
// data URI: o e-mail chega a um cliente externo que não carrega uma URL assinada
// (o token expira e a rota /files exige sessão) — inline torna a logo permanente.
// Logo externa (http da cidade) é mantida como está. Sem logo → string vazia.
function resolveLogoSrc(logoUrl) {
  if (!logoUrl) return '';
  const local = storage.readLocalFile(logoUrl);
  if (!local) return logoUrl; // externa (http) — mantém
  const ext = String(logoUrl).split('?')[0].split('.').pop().toLowerCase();
  const mime = LOGO_MIME[ext] || 'image/png';
  return `data:${mime};base64,${local.toString('base64')}`;
}

const TEMPLATES_DIR = path.join(__dirname, 'templates');
const LAYOUT_PATH = path.join(__dirname, 'layout.html');

// Paleta padrão navy Eterniza — usada quando NÃO há tenant (reproduz o visual atual).
const DEFAULT_ACCENT = {
  accent: '#032e59',
  accent_bright: '#0a4a8c',
  accent_deep: '#021a33', // fundo mais escuro (body + fim do gradiente)
  accent_mid: '#0b3358', // boxes internos (caixa do OTP, valores...)
  accent_border: '#1a4e82', // bordas de boxes/rodapé
  accent_glow: 'rgba(60, 130, 200, 0.28)', // brilho radial superior
  accent_glow_soft: 'rgba(120, 180, 235, 0.22)', // glow flutuante à esquerda
  accent_shadow: 'rgba(2, 16, 34, 0.85)', // sombra radial inferior (profundidade)
};

// cache dos arquivos em memória (lidos uma vez)
const cache = new Map();
function readFileCached(p) {
  if (!cache.has(p)) cache.set(p, fs.readFileSync(p, 'utf8'));
  return cache.get(p);
}

// substitui {{chave}} — valores ausentes viram string vazia (nunca vaza {{...}})
function fill(template, vars) {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) =>
    vars[key] === undefined || vars[key] === null ? '' : String(vars[key])
  );
}

const clamp = (x) => Math.max(0, Math.min(255, Math.round(x)));
const rgbToHex = (r, g, b) => `#${((1 << 24) | (clamp(r) << 16) | (clamp(g) << 8) | clamp(b)).toString(16).slice(1)}`;

// converte #rrggbb → {r,g,b}; null se não for um hex válido
function toRgb(hex) {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(String(hex || '').trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

// escurece uma cor #rrggbb multiplicando por um fator (0..1) — dá profundidade ao gradiente
function darken(hex, factor = 0.5) {
  const c = toRgb(hex);
  if (!c) return hex;
  return rgbToHex(c.r * factor, c.g * factor, c.b * factor);
}

// clareia uma cor #rrggbb em direção ao branco por um valor (0..1)
function lighten(hex, amount = 0.35) {
  const c = toRgb(hex);
  if (!c) return hex;
  return rgbToHex(c.r + (255 - c.r) * amount, c.g + (255 - c.g) * amount, c.b + (255 - c.b) * amount);
}

// versão rgba() de uma cor #rrggbb com alpha (0..1) — para glows/sombras translúcidos
function rgba(hex, alpha = 1) {
  const c = toRgb(hex);
  if (!c) return hex;
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${alpha})`;
}

// deriva a PALETA COMPLETA de acento a partir da cor primária do tenant (ou navy padrão)
function accentFromTenant(tenant) {
  if (!tenant || !tenant.primaryColor) return { ...DEFAULT_ACCENT };
  const accent = tenant.primaryColor;
  const bright = tenant.secondaryColor || lighten(accent, 0.32); // secundária, ou clareado da primária
  return {
    accent,
    accent_bright: bright,
    accent_deep: darken(accent, 0.45), // fundo MAIS escuro (body + fim do gradiente)
    accent_mid: darken(accent, 0.72), // boxes internos (caixa do OTP, valores...)
    accent_border: lighten(accent, 0.16), // bordas de boxes/rodapé (levemente clareado)
    accent_glow: rgba(lighten(bright, 0.25), 0.3), // brilho radial superior
    accent_glow_soft: rgba(lighten(bright, 0.4), 0.22), // glow flutuante à esquerda
    accent_shadow: rgba(darken(accent, 0.25), 0.85), // sombra radial inferior (profundidade)
  };
}

// monta a "marca" do cabeçalho: a LOGO da cidade se houver, senão o emblema ◎.
// logoSrc já vem RESOLVIDO (data URI se local, http se externa, '' se ausente).
function brandMarkFor(logoSrc, tenantName) {
  if (logoSrc) {
    return `<img src="${logoSrc}" alt="${tenantName}" style="display:inline-block; vertical-align:middle; height:34px; width:auto; max-height:34px; border-radius:9px; background-color:#ffffff; padding:3px;" />`;
  }
  return '<span style="display:inline-block; vertical-align:middle; font-size:30px; line-height:1; color:#ffffff;">&#9678;</span>';
}

/**
 * Renderiza um e-mail. Retorna { subject, html, text }.
 * @param {string} name  nome do template (chave em EMAILS)
 * @param {object} vars  variáveis do corpo ({{nome}}, {{valor}}, {{cta_url}}...)
 * @param {object} opts  { tenant } para white label
 */
function renderEmail(name, vars = {}, opts = {}) {
  const meta = EMAILS[name];
  if (!meta) throw new Error(`Template de e-mail desconhecido: '${name}'`);

  const tenant = opts.tenant || null;
  const accent = accentFromTenant(tenant);

  // A marca do cabeçalho é o NOME DA CIDADE (tenant.name); sem tenant → padrão Eterniza.
  const tenantName = (tenant && tenant.name) || vars.tenant_name || 'Eterniza Gestão';
  // Logo INLINE (data URI) se local; o e-mail é auto-contido e não depende de token.
  const logoUrl = resolveLogoSrc((tenant && tenant.logoUrl) || vars.logo_url || '');
  const brandMark = brandMarkFor(logoUrl, tenantName);
  const commonVars = { ...accent, tenant_name: tenantName, logo_url: logoUrl };

  const subject = fill(meta.subject, { ...commonVars, ...vars });

  const bodyTpl = readFileCached(path.join(TEMPLATES_DIR, `${meta.template}.html`));
  const body = fill(bodyTpl, { ...commonVars, ...vars });

  const layout = readFileCached(LAYOUT_PATH);
  const html = fill(layout, {
    ...accent,
    subject,
    preheader: vars.preheader || meta.preheader || subject,
    tenant_name: tenantName,
    logo_url: logoUrl,
    brand_mark: brandMark,
    footer_note: vars.footer_note || meta.footer_note || '',
    year: new Date().getFullYear(),
    body,
  });

  // versão texto simples (fallback para clientes sem HTML / acessibilidade)
  const text = html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&zwnj;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return { subject, html, text };
}

module.exports = { renderEmail, fill };
