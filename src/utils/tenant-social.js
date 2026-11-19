'use strict';

/**
 * Redes sociais da CIDADE (canais institucionais exibidos no site público).
 *
 * Guardadas em `tenant.settings.social` (JSONB, sem migration) como
 * { instagram, facebook, youtube, tiktok, x, linkedin, site } → URL https.
 *
 * O admin pode digitar do jeito que souber — "@prefeitura", "prefeitura",
 * "instagram.com/prefeitura" ou o link completo — e aqui vira sempre uma URL
 * https válida. Qualquer coisa que não seja http(s) (ex.: "javascript:") é
 * descartada: o valor vai parar num <a href> do site público.
 */

const NETWORKS = ['instagram', 'facebook', 'youtube', 'tiktok', 'x', 'linkedin', 'site'];

// Como montar a URL a partir de um @usuário (sem domínio).
const FROM_HANDLE = {
  instagram: (h) => `https://www.instagram.com/${h}`,
  facebook: (h) => `https://www.facebook.com/${h}`,
  youtube: (h) => `https://www.youtube.com/@${h}`,
  tiktok: (h) => `https://www.tiktok.com/@${h}`,
  x: (h) => `https://x.com/${h}`,
  linkedin: (h) => `https://www.linkedin.com/company/${h}`,
};

const MAX_LEN = 300;

function toUrl(network, raw) {
  let value = String(raw ?? '').trim();
  if (!value) return null;
  if (value.length > MAX_LEN) value = value.slice(0, MAX_LEN);

  // É LINK quando tem protocolo ou caminho ("instagram.com/prefeitura"), ou no
  // campo Site. "prefeitura.itaberaba" sozinho é @usuário (Instagram aceita
  // ponto no nome) — não pode virar o domínio https://prefeitura.itaberaba.
  const looksLikeUrl =
    network === 'site' || /^https?:\/\//i.test(value) || (!value.startsWith('@') && value.includes('/'));
  if (!looksLikeUrl) {
    // @usuário / usuário — o site exige domínio, então sem ele é inválido.
    const handle = value.replace(/^@+/, '').replace(/\s+/g, '');
    if (!/^[\w.-]+$/.test(handle)) return null;
    return FROM_HANDLE[network](handle);
  }

  if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (!url.hostname.includes('.')) return null; // "semdominio" não é site
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * Normaliza o objeto vindo do painel. Campos vazios/inválidos somem — só as
 * redes realmente preenchidas ficam salvas (e aparecem no site).
 */
function normalizeSocial(input) {
  const out = {};
  if (!input || typeof input !== 'object') return out;
  for (const network of NETWORKS) {
    const url = toUrl(network, input[network]);
    if (url) out[network] = url;
  }
  return out;
}

// Leitura: o que está salvo no settings do tenant (sempre um objeto).
function readSocial(settings) {
  const social = settings && settings.social;
  return social && typeof social === 'object' ? normalizeSocial(social) : {};
}

module.exports = { NETWORKS, normalizeSocial, readSocial };
