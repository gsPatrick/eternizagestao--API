'use strict';

/**
 * Renderizador de mensagens de WhatsApp do sistema (white label por cidade).
 *
 * Cada disparo tem um template de TEXTO PURO em ./index.js (formato WhatsApp:
 * *negrito*, quebras de linha, emojis com moderação). Variáveis usam {{chave}} —
 * o MESMO conjunto de vars dos e-mails (src/emails), então `templateFor` serve
 * para os dois canais. A cidade se identifica no topo via `*{{tenant_name}}*`.
 *
 *   const { renderWhatsapp } = require('./src/whatsapp/render');
 *   const texto = renderWhatsapp('fee-reminder', {
 *     nome: 'João', jazigo: 'A-12', valor: 'R$ 150,00',
 *     vencimento: '21/07/2026', cta_url: 'https://...'
 *   }, { tenant });
 */

const { WHATSAPP } = require('./index');

// substitui {{chave}} — valores ausentes viram string vazia (nunca vaza {{...}})
function fill(template, vars) {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) =>
    vars[key] === undefined || vars[key] === null ? '' : String(vars[key])
  );
}

// limpa o texto após o fill: sem espaços à direita, sem 3+ linhas em branco
// (variáveis vazias que deixaram uma linha órfã são absorvidas), e trim final.
function tidy(text) {
  return text
    .split('\n')
    .map((line) => line.replace(/\s+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Renderiza uma mensagem de WhatsApp. Retorna a STRING de texto pronta.
 * @param {string} name  nome do template (chave em WHATSAPP)
 * @param {object} vars  variáveis ({{nome}}, {{valor}}, {{cta_url}}...)
 * @param {object} opts  { tenant } para white label (nome da cidade)
 */
function renderWhatsapp(name, vars = {}, opts = {}) {
  const tpl = WHATSAPP[name];
  if (!tpl) throw new Error(`Template de WhatsApp desconhecido: '${name}'`);

  const tenant = opts.tenant || null;
  const tenantName = (tenant && tenant.name) || vars.tenant_name || 'Eterniza Gestão';

  return tidy(fill(tpl, { ...vars, tenant_name: tenantName }));
}

module.exports = { renderWhatsapp, fill };
