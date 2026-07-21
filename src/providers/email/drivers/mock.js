'use strict';

/**
 * Driver mock de e-mail — SENTINELA de "e-mail não configurado".
 * Não envia nada de verdade. NÃO é mais um caminho de envio: `providers/email`
 * recusa o envio (AppError EMAIL_NOT_CONFIGURED) quando resolve para este
 * driver, porque reportar sucesso sem entregar nada é mentir para o operador.
 * O que resta aqui é só o rastro de log, útil quando alguém chama o driver
 * diretamente em teste/desenvolvimento.
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
