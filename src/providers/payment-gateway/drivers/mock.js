'use strict';

/**
 * Driver MOCK do gateway de pagamento — fallback de DESENVOLVIMENTO.
 * Usado quando a cidade NÃO tem Asaas configurado (sem apiKey) → o dev nunca
 * quebra: cobranças ganham boleto/PIX fictícios e a "baixa automática" pode ser
 * simulada pelo webhook mock (HMAC).
 *
 * Implementa a MESMA interface do driver real (asaas.js):
 *   createCharge(tenantAsaas, data) / getCharge / getPixQr / cancelCharge / testConnection
 * e MAIS os utilitários de webhook por HMAC usados pela rota
 * `/v1/webhooks/payment-gateway` e pela simulação da tela de Cobranças:
 *   verifyWebhook(rawBody, signatureHeader) / parseWebhookEvent(rawBodyOrBody)
 */
const crypto = require('crypto');

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
// -----------------------------------------------------------------------------
async function createCharge(tenantAsaas, data = {}) {
  const { billingId, amount, dueDate } = data;
  const chargeId = `mock_${crypto.randomUUID()}`;
  const digits = crypto.randomBytes(24).toString('hex').replace(/\D/g, '').padEnd(47, '0');
  return {
    provider: 'mock',
    chargeId,
    boleto: {
      barcode: digits.slice(0, 44),
      digitableLine: digits.slice(0, 47),
      url: `https://mock-gateway.local/boleto/${chargeId}`,
    },
    pix: {
      qrCode: `data:image/png;base64,MOCKQR_${chargeId}`,
      copyPaste: `00020126MOCKPIX${chargeId}5204000053039865802BR6304ABCD`,
      expiresAt: dueDate ? new Date(`${dueDate}T23:59:59Z`).toISOString() : null,
    },
    raw: { billingId, amount, dueDate },
  };
}

async function getCharge(tenantAsaas, id) {
  return { chargeId: id, status: 'PENDING', paid: false, raw: null };
}

async function getPixQr(tenantAsaas, id) {
  return {
    qrCode: `data:image/png;base64,MOCKQR_${id}`,
    copyPaste: `00020126MOCKPIX${id}5204000053039865802BR6304ABCD`,
    expiresAt: null,
  };
}

async function cancelCharge() {
  return true; // mock: sempre aceita
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
  createCharge,
  getCharge,
  getPixQr,
  cancelCharge,
  testConnection,
  verifyWebhook,
  parseWebhookEvent,
};
