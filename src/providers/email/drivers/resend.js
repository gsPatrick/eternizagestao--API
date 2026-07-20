'use strict';

/**
 * Driver RESEND (envio REAL via HTTP) — usado como remetente da PLATAFORMA
 * (super_admin → cidades: convites de onboarding, redefinição de senha, etc.)
 * e como fallback para cidades sem SMTP próprio.
 *
 * Não usa SDK: chama a API HTTP do Resend com `fetch` (Node 18+). A credencial
 * é GLOBAL da plataforma, via env — diferente do SMTP, que é por cidade.
 *
 * Config (injetada pelo index a partir do env):
 *   { apiKey, fromEmail, fromName }
 *
 * Interface (idêntica aos demais drivers):
 *   sendEmail(config, { to, subject, html, text }) => { providerMessageId }
 *   verify(config) => true   (valida a chave — usado por um teste de config)
 *
 * Envs:
 *   RESEND_API_KEY   — chave da conta Resend (obrigatória para ativar)
 *   EMAIL_FROM       — remetente (ex.: "Eterniza <no-reply@eternizagestao.com.br>"
 *                      ou "no-reply@eternizagestao.com.br")
 *   EMAIL_FROM_NAME  — nome amigável (quando EMAIL_FROM é só o endereço)
 */

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

// Monta o campo `from` do Resend: "Nome <email>" quando há nome; senão o email.
function buildFrom(config) {
  const email = String(config.fromEmail || '').trim();
  const name = String(config.fromName || '').trim();
  if (!email) return null;
  // já veio no formato "Nome <email>"
  if (email.includes('<')) return email;
  return name ? `${name} <${email}>` : email;
}

async function sendEmail(config, { to, subject, html, text } = {}) {
  const apiKey = config && config.apiKey;
  if (!apiKey) throw new Error('Resend: RESEND_API_KEY ausente.');
  const from = buildFrom(config);
  if (!from) throw new Error('Resend: remetente (EMAIL_FROM) ausente.');

  const payload = {
    from,
    to: Array.isArray(to) ? to : [to],
    subject: subject || '(sem assunto)',
  };
  if (html) payload.html = html;
  if (text) payload.text = text;

  const res = await fetch(RESEND_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = body && (body.message || body.error) ? (body.message || body.error) : `HTTP ${res.status}`;
    throw new Error(`Resend: falha ao enviar (${msg}).`);
  }
  return { providerMessageId: body.id || `resend-${Date.now()}` };
}

// Valida a chave sem enviar e-mail (lista domínios). true se autenticou.
async function verify(config) {
  const apiKey = config && config.apiKey;
  if (!apiKey) throw new Error('Resend: RESEND_API_KEY ausente.');
  const res = await fetch('https://api.resend.com/domains', {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) throw new Error(`Resend: chave inválida (HTTP ${res.status}).`);
  return true;
}

module.exports = { name: 'resend', sendEmail, verify };
