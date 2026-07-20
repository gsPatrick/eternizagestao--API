'use strict';

/**
 * Provider de e-mail (envio de notificações transacionais) — POR CIDADE.
 * -----------------------------------------------------------------------------
 * ABSTRAÇÃO TROCÁVEL: a interface é sempre a mesma; o driver concreto é
 * escolhido POR CHAMADA a partir da config SMTP DO TENANT:
 *
 *   sendEmail(tenantSmtp, { to, subject, html, text }) => Promise<{ providerMessageId }>
 *     - tenantSmtp = { host, port, secure, user, password, fromName, fromEmail }
 *       vem de features/tenants/integration-config.js → getIntegrationConfig().
 *     - Se o tenant TEM SMTP (host preenchido) → driver `smtp` (nodemailer, real).
 *     - Se NÃO tem (ou o driver real não carrega) → driver `mock` (só loga; dev).
 *     - assíncrono; LANÇA em falha real de envio (a fila de notificações reté).
 *
 *   resolveDriver(tenantSmtp) => driver ativo para aquela cidade (introspecção/teste).
 *
 * Trocar de tecnologia (SendGrid/SES) = novo arquivo em ./drivers, MESMA interface,
 * e um branch em resolveDriver — nenhuma feature muda.
 */

const mock = require('./drivers/mock');

// O driver `smtp` depende de `nodemailer` (require pode lançar se ausente).
// Carregamento preguiçoso + memoizado: só tentamos quando algum tenant tem SMTP.
let _smtp; // undefined = ainda não tentou; null = indisponível
let _smtpError = null;
function loadSmtpDriver() {
  if (_smtp === undefined) {
    try {
      // eslint-disable-next-line global-require
      _smtp = require('./drivers/smtp');
    } catch (err) {
      _smtp = null;
      _smtpError = err;
    }
  }
  return _smtp;
}

// Um tenant "tem SMTP" quando ao menos o host está preenchido.
function hasTenantSmtp(tenantSmtp) {
  return Boolean(tenantSmtp && typeof tenantSmtp.host === 'string' && tenantSmtp.host.trim());
}

/**
 * Escolhe o driver para a cidade: `smtp` quando há config e o driver carrega;
 * senão `mock` (nunca quebra o dispatch — cai no log).
 */
function resolveDriver(tenantSmtp) {
  if (hasTenantSmtp(tenantSmtp)) {
    const smtp = loadSmtpDriver();
    if (smtp) return smtp;
    console.warn(
      '[email] Tenant tem SMTP configurado, mas o driver real está indisponível — usando mock.',
      _smtpError && _smtpError.message
    );
  }
  return mock;
}

/**
 * Envia um e-mail usando o SMTP DA CIDADE (ou mock quando não configurado).
 * @param {object} tenantSmtp { host, port, secure, user, password, fromName, fromEmail }
 * @param {object} message    { to, subject, html, text }
 * @returns {Promise<{ providerMessageId: string }>}
 */
async function sendEmail(tenantSmtp, message) {
  return resolveDriver(tenantSmtp).sendEmail(tenantSmtp, message);
}

module.exports = { sendEmail, resolveDriver, mock };
