'use strict';

/**
 * Driver MOCK do gateway de pagamento — SENTINELA de "gateway não configurado".
 * Usado quando a cidade NÃO tem Asaas configurado (sem apiKey).
 *
 * O QUE MUDOU (e por quê): este driver gerava código de barras aleatório e PIX
 * inventado, e a Billing PERSISTIA isso. O cidadão recebia um boleto que nenhum
 * banco aceita e o município achava que tinha cobrado. Agora `createCharge`
 * RECUSA a emissão (AppError PAYMENT_GATEWAY_NOT_CONFIGURED); as leituras
 * (getCharge/getPixQr) também não inventam dado.
 *
 * O que CONTINUA: os utilitários de webhook por HMAC usados pela rota
 * `/v1/webhooks/payment-gateway` e pela simulação de baixa (restrita a
 * NÃO-produção + gateway realmente mock — ver payments.service):
 *   verifyWebhook(rawBody, signatureHeader) / parseWebhookEvent(rawBodyOrBody)
 *
 * Implementa a MESMA interface do driver real (asaas.js):
 *   createCharge(tenantAsaas, data) / getCharge / getPixQr / cancelCharge / testConnection
 */
const crypto = require('crypto');
const AppError = require('../../../utils/app-error');

// Mensagem única do estado "não configurado" — acionável, aponta a tela.
const PAYMENT_GATEWAY_NOT_CONFIGURED_MESSAGE =
  'Gateway de pagamento não configurado: cadastre a chave da conta Asaas desta cidade '
  + 'em Configurações › Integrações antes de emitir cobranças. Nenhuma cobrança foi emitida.';

function notConfigured() {
  // 503: a operação é válida, falta a integração — não é erro de payload.
  return new AppError(
    PAYMENT_GATEWAY_NOT_CONFIGURED_MESSAGE,
    503,
    'PAYMENT_GATEWAY_NOT_CONFIGURED'
  );
}

const IS_PROD = process.env.NODE_ENV === 'production';

// Segredo do HMAC do webhook mock — obrigatório em produção, sem default inseguro.
const WEBHOOK_SECRET =
  process.env.PAYMENT_GATEWAY_WEBHOOK_SECRET ||
  (IS_PROD ? undefined : 'dev-payment-webhook-secret');

if (IS_PROD && !process.env.PAYMENT_GATEWAY_WEBHOOK_SECRET) {
  // decisão de segurança: nunca subir produção sem segredo próprio do webhook mock
  throw new Error('PAYMENT_GATEWAY_WEBHOOK_SECRET obrigatório em produção');
}
if (!IS_PROD && !process.env.PAYMENT_GATEWAY_WEBHOOK_SECRET) {
  console.warn(
    '[payment-gateway] PAYMENT_GATEWAY_WEBHOOK_SECRET ausente — usando default APENAS de desenvolvimento. NÃO usar em produção.'
  );
}

/**
 * Verificação de assinatura do webhook mock em tempo constante.
 * HMAC-SHA256(rawBody) com o segredo, comparado com o header (hex).
 */
function verifyWebhook(rawBody, signatureHeader) {
  try {
    if (!signatureHeader || rawBody == null) return false;
    const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody);
    const expected = crypto.createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');
    const a = Buffer.from(expected);
    const b = Buffer.from(String(signatureHeader));
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// Normaliza o payload mock para o formato interno único.
function parseWebhookEvent(rawBodyOrBody) {
  let body = rawBodyOrBody;
  if (Buffer.isBuffer(body)) {
    try {
      body = JSON.parse(body.toString('utf8'));
    } catch {
      return null;
    }
  }
  body = body || {};
  if (!body.event || !body.chargeId) return null;
  return {
    eventType: body.event, // ex.: 'charge.paid'
    chargeId: body.chargeId,
    paidAt: body.paidAt || new Date().toISOString(),
    amountPaid: body.amountPaid,
    method: body.method || 'pix',
  };
}

// -----------------------------------------------------------------------------
// Interface de charge (mesma assinatura do driver Asaas: 1º arg tenantAsaas).
// TODAS as operações que produziriam DADO FINANCEIRO recusam: sem conta no
// gateway não existe boleto nem PIX, e um valor inventado aqui é persistido na
// Billing e entregue ao cidadão como se fosse pagável.
// -----------------------------------------------------------------------------
async function createCharge() {
  throw notConfigured();
}

async function getCharge() {
  throw notConfigured();
}

async function getPixQr() {
  throw notConfigured();
}

// Cancelamento é o único caminho tolerante: não há nada real para cancelar e os
// chamadores usam isto como compensação best-effort (ver safeCancelCharge).
async function cancelCharge() {
  return true;
}

async function testConnection() {
  // sem apiKey real não há o que validar — devolve estado amigável (não é erro)
  return {
    ok: false,
    message: 'Nenhuma chave Asaas configurada. Salve a chave da sua conta para testar a conexão.',
  };
}

module.exports = {
  name: 'mock',
  PAYMENT_GATEWAY_NOT_CONFIGURED_MESSAGE,
  createCharge,
  getCharge,
  getPixQr,
  cancelCharge,
  testConnection,
  verifyWebhook,
  parseWebhookEvent,
};
