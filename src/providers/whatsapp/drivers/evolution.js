'use strict';

/**
 * Driver REAL de WhatsApp — Evolution API v2.
 * -----------------------------------------------------------------------------
 * Endpoints confirmados na doc oficial (doc.evolution-api.com → agora
 * docs.evolutionfoundation.com.br), Evolution API v2:
 *
 *   Base    : process.env.EVOLUTION_API_URL         (ex.: https://evo.suaempresa.com)
 *   Auth    : header `apikey: <EVOLUTION_API_KEY>`  (chave global do servidor)
 *
 *   POST   /instance/create                { instanceName, integration:'WHATSAPP-BAILEYS', qrcode:true }
 *                                          -> { instance:{...}, hash, qrcode:{ base64 } }
 *   GET    /instance/connect/{instance}    -> { base64 | code | pairingCode }   (QR para parear)
 *   GET    /instance/connectionState/{instance} -> { instance:{ state:'open'|'connecting'|'close' } }
 *   POST   /message/sendText/{instance}    { number, text } -> { key:{ id, ... } }
 *   POST   /webhook/set/{instance}         { enabled, url, events:[...], base64 }  (raiz; fallback nested)
 *   DELETE /instance/logout/{instance}     -> 200 "logged out"
 *   DELETE /instance/delete/{instance}     -> remove a instância (usado após logout)
 *
 * UMA instância por cidade (`cidade-<subdomain>`). Nenhum segredo mora aqui: a
 * chave é global (env); a instância é derivada do tenant via shared.instanceNameFor.
 */

const { instanceNameFor, mapState } = require('../shared');

const BASE_URL = (process.env.EVOLUTION_API_URL || '').replace(/\/+$/, '');
const API_KEY = process.env.EVOLUTION_API_KEY || '';
const TIMEOUT_MS = Number(process.env.EVOLUTION_TIMEOUT_MS || 15000);

// Eventos que queremos receber no webhook (v2 usa SNAKE_CASE em maiúsculas).
const WEBHOOK_EVENTS = ['CONNECTION_UPDATE', 'MESSAGES_UPSERT'];

class EvolutionError extends Error {
  constructor(message, { status, body } = {}) {
    super(message);
    this.name = 'EvolutionError';
    this.status = status;
    this.body = body;
  }
}

// Request base ao Evolution com timeout, auth e parse de erro.
async function request(method, path, body) {
  if (!BASE_URL) throw new EvolutionError('EVOLUTION_API_URL não configurada.', { status: 0 });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        apikey: API_KEY,
      },
      body: body != null ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    const reason = err.name === 'AbortError' ? `timeout após ${TIMEOUT_MS}ms` : err.message;
    throw new EvolutionError(`Falha de rede ao chamar o Evolution (${reason}).`, { status: 0 });
  } finally {
    clearTimeout(timer);
  }

  let parsed = null;
  const text = await res.text();
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }

  if (!res.ok) {
    throw new EvolutionError(
      evolutionErrorMessage(parsed, `Evolution respondeu ${res.status}.`),
      { status: res.status, body: parsed }
    );
  }
  return parsed || {};
}

// Mensagem amigável a partir dos formatos de erro comuns do Evolution.
function evolutionErrorMessage(body, fallback) {
  if (!body) return fallback;
  if (typeof body.message === 'string') return body.message;
  if (Array.isArray(body.message)) return body.message.join('; ');
  if (typeof body.error === 'string') return body.error;
  if (Array.isArray(body.response?.message)) return body.response.message.join('; ');
  return fallback;
}

// Normaliza um QR (com/sem prefixo data:) para data URL base64 pronto para <img>.
function toQrDataUrl(raw) {
  if (!raw || typeof raw !== 'string') return null;
  return raw.startsWith('data:') ? raw : `data:image/png;base64,${raw}`;
}

// -----------------------------------------------------------------------------
// Interface
// -----------------------------------------------------------------------------

/**
 * Garante a instância da cidade. Cria se não existir; se já existir (409/403/
 * "already in use"), trata como sucesso idempotente.
 */
async function ensureInstance(tenant) {
  const instanceName = instanceNameFor(tenant);
  try {
    const res = await request('POST', '/instance/create', {
      instanceName,
      integration: 'WHATSAPP-BAILEYS',
      qrcode: true,
    });
    // create já pode devolver o primeiro QR
    const qrCode = toQrDataUrl(res?.qrcode?.base64 || res?.qrcode?.code);
    return { instanceName, created: true, qrCode };
  } catch (err) {
    const already =
      err.status === 403 ||
      err.status === 409 ||
      /already|exists|in use/i.test(err.message || '');
    if (already) return { instanceName, created: false, qrCode: null };
    throw err;
  }
}

/**
 * QR (base64) para parear a cidade. Garante a instância e chama /instance/connect.
 * Se já estiver conectada, o Evolution não devolve QR → retornamos status.
 */
async function getQrCode(tenant) {
  const instanceName = instanceNameFor(tenant);
  const ensured = await ensureInstance(tenant);

  // Estado atual: se já conectado, não há QR a mostrar.
  const state = await getStatus(tenant);
  if (state.status === 'conectado') {
    return { instanceName, qrCode: null, status: 'conectado' };
  }

  const res = await request('GET', `/instance/connect/${encodeURIComponent(instanceName)}`);
  const qrCode =
    toQrDataUrl(res?.base64) ||
    toQrDataUrl(res?.qrcode?.base64) ||
    toQrDataUrl(res?.code) ||
    ensured.qrCode ||
    null;

  return {
    instanceName,
    qrCode,
    pairingCode: res?.pairingCode || null,
    status: qrCode ? 'conectando' : state.status,
  };
}

/** Estado da conexão da cidade (desconectado|conectando|conectado). */
async function getStatus(tenant) {
  const instanceName = instanceNameFor(tenant);
  try {
    const res = await request('GET', `/instance/connectionState/${encodeURIComponent(instanceName)}`);
    const state = res?.instance?.state || res?.state;
    return { instanceName, status: mapState(state) };
  } catch (err) {
    // Instância inexistente / servidor fora → tratamos como desconectado.
    if (err.status === 404) return { instanceName, status: 'desconectado' };
    return { instanceName, status: 'desconectado', error: err.message };
  }
}

/**
 * Envia texto pela instância da cidade. LANÇA se a instância não estiver
 * conectada (o chamador marca falha amigável, sem derrubar a fila).
 */
async function sendText(tenant, number, text) {
  const instanceName = instanceNameFor(tenant);
  const to = String(number || '').replace(/\D/g, '');
  if (!to) throw new EvolutionError('Número de WhatsApp inválido.', { status: 0 });

  const res = await request('POST', `/message/sendText/${encodeURIComponent(instanceName)}`, {
    number: to,
    text,
  });
  return { providerMessageId: res?.key?.id || res?.messageId || `evo_${Date.now()}` };
}

/**
 * Configura o webhook da instância (recebe connection.update etc.).
 * v2 atual: corpo na RAIZ; deployments antigos aceitam aninhado em `webhook`.
 * Best-effort com fallback de formato.
 */
async function setWebhook(tenant, url) {
  const instanceName = instanceNameFor(tenant);
  const flat = { enabled: true, url, events: WEBHOOK_EVENTS, base64: true };
  try {
    await request('POST', `/webhook/set/${encodeURIComponent(instanceName)}`, flat);
    return { ok: true };
  } catch (err) {
    // Formato antigo: aninhado em `webhook` com `webhookByEvents`.
    try {
      await request('POST', `/webhook/set/${encodeURIComponent(instanceName)}`, {
        webhook: { enabled: true, url, webhookByEvents: false, base64: true, events: WEBHOOK_EVENTS },
      });
      return { ok: true };
    } catch (err2) {
      // Webhook é best-effort: não impede conectar. Loga e segue.
      console.warn('[whatsapp:evolution] setWebhook falhou:', err2.message || err.message);
      return { ok: false, message: err2.message || err.message };
    }
  }
}

/** Desconecta (logout) e remove a instância da cidade. */
async function logout(tenant) {
  const instanceName = instanceNameFor(tenant);
  try {
    await request('DELETE', `/instance/logout/${encodeURIComponent(instanceName)}`);
  } catch (err) {
    if (err.status !== 404) console.warn('[whatsapp:evolution] logout:', err.message);
  }
  // Remove a instância para permitir um novo pareamento limpo depois.
  try {
    await request('DELETE', `/instance/delete/${encodeURIComponent(instanceName)}`);
  } catch (err) {
    if (err.status !== 404) console.warn('[whatsapp:evolution] delete:', err.message);
  }
  return { ok: true };
}

module.exports = {
  name: 'evolution',
  instanceNameFor,
  ensureInstance,
  getQrCode,
  getStatus,
  sendText,
  setWebhook,
  logout,
  disconnect: logout, // alias
  EvolutionError,
};
