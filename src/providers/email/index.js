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
 *     - Se NÃO tem, mas há RESEND_API_KEY → driver `resend` (plataforma, real).
 *     - Se NÃO há NENHUM dos dois → driver `mock` (sentinela de "não configurado").
 *     - assíncrono; LANÇA em falha real de envio (a fila de notificações reté).
 *
 *   resolveDriver(tenantSmtp) => driver ativo para aquela cidade (introspecção/teste).
 *   isConfigured(tenantSmtp)  => há caminho REAL de envio para aquela cidade?
 *
 * REGRA DE HONESTIDADE (produção): o driver `mock` NÃO envia nada — ele existe
 * apenas como sentinela do estado "e-mail não configurado". Enviar por ele e
 * reportar sucesso é MENTIR para o operador (a notificação apareceria como
 * 'enviada' sem que ninguém tenha recebido nada). Por isso `sendEmail` RECUSA
 * o envio com AppError(EMAIL_NOT_CONFIGURED) quando o driver resolvido é o mock.
 *
 * Trocar de tecnologia (SendGrid/SES) = novo arquivo em ./drivers, MESMA interface,
 * e um branch em resolveDriver — nenhuma feature muda.
 */

const mock = require('./drivers/mock');
const AppError = require('../../utils/app-error');

// Mensagem única do estado "não configurado" — reusada pelo provider e pelo
// dispatch de notificações (errorMessage da linha), para o operador ver sempre
// a MESMA instrução acionável.
const EMAIL_NOT_CONFIGURED_MESSAGE =
  'E-mail não configurado: defina o SMTP da cidade em Configurações › Integrações '
  + 'ou configure a RESEND_API_KEY da plataforma. Nenhum e-mail foi enviado.';

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

// Driver RESEND (remetente da PLATAFORMA) — carregado preguiçosamente.
let _resend;
function loadResendDriver() {
  if (_resend === undefined) {
    try {
      // eslint-disable-next-line global-require
      _resend = require('./drivers/resend');
    } catch (err) {
      _resend = null;
    }
  }
  return _resend;
}

// Config Resend da PLATAFORMA (global, via env). Usada quando a cidade NÃO tem
// SMTP próprio — ex.: convite ao 1º admin de uma cidade recém-criada, que ainda
// não configurou nada. Retorna null se RESEND_API_KEY não estiver setada.
function platformResendConfig() {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || !apiKey.trim()) return null;
  return {
    apiKey: apiKey.trim(),
    // Remetente da PLATAFORMA (super_admin/suporte). Trocável por env EMAIL_FROM.
    fromEmail: process.env.EMAIL_FROM || 'suporte@eternizagestao.com.br',
    fromName: process.env.EMAIL_FROM_NAME || 'Eterniza Gestão',
  };
}

// Um tenant "tem SMTP" quando ao menos o host está preenchido.
function hasTenantSmtp(tenantSmtp) {
  return Boolean(tenantSmtp && typeof tenantSmtp.host === 'string' && tenantSmtp.host.trim());
}

/**
 * Escolhe o driver da mensagem, por PRECEDÊNCIA:
 *   1) SMTP DA CIDADE (quando o tenant configurou o próprio servidor);
 *   2) RESEND DA PLATAFORMA (quando há RESEND_API_KEY) — cobre cidades sem SMTP
 *      e os e-mails do super_admin (convites/onboarding);
 *   3) MOCK = SENTINELA de "não configurado" (não envia; `sendEmail` recusa).
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
  if (platformResendConfig()) {
    const resend = loadResendDriver();
    if (resend) return resend;
  }
  return mock;
}

/**
 * Existe caminho REAL de envio para esta cidade? (SMTP próprio ou Resend global)
 * Usado por quem precisa decidir ANTES de chamar `sendEmail` — ex.: o dispatch
 * de notificações, que marca a linha como 'falha' em vez de fingir 'enviada'.
 * @param {object|null} tenantSmtp
 * @returns {boolean}
 */
function isConfigured(tenantSmtp) {
  return resolveDriver(tenantSmtp).name !== 'mock';
}

/**
 * Envia um e-mail usando o SMTP DA CIDADE (ou o Resend da plataforma).
 * RECUSA o envio (AppError EMAIL_NOT_CONFIGURED) quando não há nenhum caminho
 * real configurado: melhor um erro visível na tela do que um "enviado" falso —
 * quem chama (convite de admin, teste de SMTP) precisa saber que ninguém recebeu.
 * @param {object} tenantSmtp { host, port, secure, user, password, fromName, fromEmail }
 * @param {object} message    { to, subject, html, text }
 * @returns {Promise<{ providerMessageId: string }>}
 */
async function sendEmail(tenantSmtp, message) {
  const driver = resolveDriver(tenantSmtp);
  if (driver.name === 'mock') {
    // 503: a operação é válida, falta a integração — não é erro do cliente.
    throw new AppError(EMAIL_NOT_CONFIGURED_MESSAGE, 503, 'EMAIL_NOT_CONFIGURED');
  }
  // Resend usa a config GLOBAL da plataforma; smtp usa o SMTP da cidade.
  const config = driver.name === 'resend' ? platformResendConfig() : tenantSmtp;
  return driver.sendEmail(config, message);
}

module.exports = {
  sendEmail,
  resolveDriver,
  isConfigured,
  mock,
  platformResendConfig,
  EMAIL_NOT_CONFIGURED_MESSAGE,
};
