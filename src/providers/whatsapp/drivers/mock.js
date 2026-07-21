'use strict';

/**
 * Driver mock de WhatsApp (fallback quando NÃO há EVOLUTION_API_URL).
 * Não conecta nada de verdade: devolve um QR PLACEHOLDER (honesto — deixa claro
 * que é modo demonstração) e status 'desconectado'.
 *
 * DUAS METADES, DUAS REGRAS:
 *  - CONEXÃO (getQrCode/getStatus/ensureInstance/logout): continua não lançando.
 *    A tela de conexão já mostra "modo demonstração" com `mock:true` — ali a
 *    honestidade já existe e o operador não é enganado.
 *  - ENVIO (sendText): LANÇA. Antes ele só logava e devolvia um id sintético, o
 *    que fazia a notificação ser gravada como 'enviada' sem ninguém receber
 *    nada. Mensagem não entregue tem que aparecer como falha.
 *
 * Mesma interface do driver real (evolution.js).
 */
const { instanceNameFor } = require('../shared');
const AppError = require('../../../utils/app-error');

// Mensagem única do estado "não configurado" (reusada no dispatch da notificação).
const WHATSAPP_NOT_CONFIGURED_MESSAGE =
  'WhatsApp não configurado: o servidor Evolution (EVOLUTION_API_URL) não está definido. '
  + 'Nenhuma mensagem foi enviada.';

// QR placeholder: SVG (data URL base64) que a UI renderiza como <img>. Deixa
// explícito que o servidor Evolution não está configurado — sem botão morto.
const PLACEHOLDER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="220" height="220" viewBox="0 0 220 220">
<rect width="220" height="220" rx="12" fill="#f1f5f9"/>
<rect x="16" y="16" width="188" height="188" rx="8" fill="none" stroke="#cbd5e1" stroke-width="2" stroke-dasharray="6 6"/>
<text x="110" y="100" text-anchor="middle" font-family="sans-serif" font-size="13" fill="#475569">QR de demonstração</text>
<text x="110" y="122" text-anchor="middle" font-family="sans-serif" font-size="11" fill="#94a3b8">Evolution não configurado</text>
</svg>`;
const PLACEHOLDER_QR = `data:image/svg+xml;base64,${Buffer.from(PLACEHOLDER_SVG).toString('base64')}`;

const MOCK_MESSAGE =
  'Servidor Evolution não configurado (EVOLUTION_API_URL ausente) — modo demonstração. ' +
  'Configure o servidor Evolution para conectar o WhatsApp de verdade.';

async function ensureInstance(tenant) {
  return { instanceName: instanceNameFor(tenant), created: false, qrCode: PLACEHOLDER_QR };
}

async function getQrCode(tenant) {
  return {
    instanceName: instanceNameFor(tenant),
    qrCode: PLACEHOLDER_QR,
    status: 'desconectado',
    mock: true,
    message: MOCK_MESSAGE,
  };
}

async function getStatus(tenant) {
  return { instanceName: instanceNameFor(tenant), status: 'desconectado', mock: true };
}

// ENVIO: recusa explícita. Sem servidor Evolution não existe entrega possível —
// devolver um providerMessageId sintético faria a notificação constar como
// 'enviada'. 503: a operação é válida, falta a integração.
async function sendText(tenant, number) {
  console.warn(
    `[whatsapp:mock] envio RECUSADO — Evolution não configurado. instancia=${instanceNameFor(tenant)} para=${number}`
  );
  throw new AppError(WHATSAPP_NOT_CONFIGURED_MESSAGE, 503, 'WHATSAPP_NOT_CONFIGURED');
}

async function setWebhook() {
  return { ok: true, mock: true };
}

async function logout(tenant) {
  console.log(`[whatsapp:mock] logout instancia=${instanceNameFor(tenant)}`);
  return { ok: true, mock: true };
}

module.exports = {
  name: 'mock',
  WHATSAPP_NOT_CONFIGURED_MESSAGE,
  instanceNameFor,
  ensureInstance,
  getQrCode,
  getStatus,
  sendText,
  setWebhook,
  logout,
  disconnect: logout,
};
