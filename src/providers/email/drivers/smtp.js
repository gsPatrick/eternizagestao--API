'use strict';

/**
 * Driver SMTP (envio REAL) via nodemailer — POR CIDADE.
 * -----------------------------------------------------------------------------
 * Recebe a config SMTP DO TENANT em cada chamada (host/port/secure/user/password
 * /fromName/fromEmail). Não há credencial global: cada cidade envia pelo próprio
 * servidor. `nodemailer` é dependência do projeto (package.json). Se por algum
 * motivo não carregar, o require lança e o index cai para o driver `mock`.
 *
 * Interface:
 *   sendEmail(tenantSmtp, { to, subject, html, text }) => { providerMessageId }
 *   verify(tenantSmtp) => true            (valida conexão/credenciais — teste)
 */

// eslint-disable-next-line global-require
const nodemailer = require('nodemailer');

// Cache de transporters por config (evita recriar pool a cada e-mail). A chave
// inclui apenas dados de conexão (não a senha em claro no log de chave).
const transporters = new Map();

function transporterKey(smtp) {
  return [smtp.host, smtp.port, smtp.secure ? 1 : 0, smtp.user || ''].join('|');
}

function transporterFor(smtp) {
  const key = transporterKey(smtp);
  let transporter = transporters.get(key);
  if (!transporter) {
    const port = Number(smtp.port) || 587;
    transporter = nodemailer.createTransport({
      host: smtp.host,
      port,
      // secure explícito do tenant; se ausente, TLS implícito só na 465.
      secure: smtp.secure != null ? Boolean(smtp.secure) : port === 465,
      auth: smtp.user ? { user: smtp.user, pass: smtp.password || '' } : undefined,
    });
    transporters.set(key, transporter);
  }
  return transporter;
}

// Remetente: "Nome <email>" quando há nome; senão o e-mail (ou o usuário).
function fromAddress(smtp) {
  const address = smtp.fromEmail || smtp.user;
  if (!address) return undefined;
  return smtp.fromName ? `"${smtp.fromName}" <${address}>` : address;
}

module.exports = {
  name: 'smtp',
  async sendEmail(smtp, { to, subject, html, text } = {}) {
    // lança em falha para a fila poder reter (não engole o erro)
    const info = await transporterFor(smtp).sendMail({
      from: fromAddress(smtp),
      to,
      subject,
      html,
      text,
    });
    return { providerMessageId: info.messageId };
  },

  // Valida a conexão/credenciais SMTP do tenant (usado no teste de e-mail).
  async verify(smtp) {
    await transporterFor(smtp).verify();
    return true;
  },
};
