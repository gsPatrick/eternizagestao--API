'use strict';

/**
 * Driver mock de e-mail (fallback quando o tenant NÃO tem SMTP configurado).
 * Não envia nada de verdade — apenas loga e devolve um id sintético.
 * NUNCA falha (é o default em dev e o fallback seguro em produção sem config).
 *
 * Interface (idêntica ao driver real):
 *   sendEmail(tenantSmtp, { to, subject, html, text }) => { providerMessageId }
 */
const crypto = require('crypto');

module.exports = {
  name: 'mock',
  // eslint-disable-next-line no-unused-vars
  async sendEmail(tenantSmtp, { to, subject } = {}) {
    // mock: nenhum envio real — apenas rastro no log
    console.log(`[email:mock] -> ${to} (${subject || 'sem assunto'})`);
    return { providerMessageId: `mock-${Date.now()}-${crypto.randomUUID()}` };
  },
};
