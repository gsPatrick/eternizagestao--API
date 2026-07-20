'use strict';

/**
 * Provider de assinatura eletrônica de documentos — ABSTRAÇÃO TROCÁVEL, POR CIDADE.
 * -----------------------------------------------------------------------------
 * Espelha o padrão do `payment-gateway` (que já é por cidade): cada cidade
 * (tenant) usa a PRÓPRIA conta do provedor de assinatura. O driver é selecionado
 * a partir da config em `Tenant.settings.integrations.signature`
 * (`{ provider, apiKey, webhookToken }`), lida server-side pela feature
 * `document-signatures` (getSignatureConfig). Sem apiKey configurada, cai no
 * driver `mock` → o dev nunca quebra.
 *
 * SCAFFOLD / DÍVIDA TÉCNICA: só existe o driver `mock` hoje. Plugar
 * Clicksign / D4Sign / ZapSign POR CIDADE = novo arquivo driver com a MESMA
 * interface (baixo esforço; nenhuma feature muda). A gravação da config por
 * cidade (endpoint de integrações em tenants.service) é o próximo passo — hoje
 * a config vem de `settings.integrations.signature` se estiver lá, senão mock.
 *
 * INTERFACE DO DRIVER (estável):
 *   name
 *   createEnvelope(tenantSignature, { documentId, fileUrl, signer:{name,email,cpf} })
 *       => { envelopeId, signUrl }
 *   verifyWebhook(rawBody, signatureHeader, secret?) => boolean
 *       // HMAC-SHA256 do corpo bruto; `secret` = segredo DA CIDADE, fallback global
 *   parseWebhookEvent(rawBodyOrBody)
 *       => { envelopeId, status:'assinado'|'recusado'|'expirado', signedAt?, signatureHash? } | null
 *
 * `tenantSignature` = { provider, apiKey, webhookToken } (segredos em claro,
 * uso server-side — ver document-signatures.service.getSignatureConfig).
 */
const crypto = require('crypto');

const IS_PROD = process.env.NODE_ENV === 'production';

// Segredo GLOBAL do HMAC do webhook — FALLBACK quando a cidade não define o seu
// (`settings.integrations.signature.webhookToken`). Obrigatório em produção.
const GLOBAL_WEBHOOK_SECRET =
  process.env.SIGNATURE_WEBHOOK_SECRET ||
  (IS_PROD ? undefined : 'dev-signature-webhook-secret');

if (IS_PROD && !process.env.SIGNATURE_WEBHOOK_SECRET) {
  // decisão de segurança: nunca subir produção sem segredo próprio do webhook
  throw new Error('SIGNATURE_WEBHOOK_SECRET obrigatório em produção');
}
if (!IS_PROD && !process.env.SIGNATURE_WEBHOOK_SECRET) {
  console.warn(
    '[digital-signature] SIGNATURE_WEBHOOK_SECRET ausente — usando default APENAS de desenvolvimento. NÃO usar em produção.'
  );
}

/**
 * Verificação de assinatura do webhook em tempo constante.
 * Calcula HMAC-SHA256(rawBody) com o segredo DA CIDADE (se houver) ou o global,
 * e compara com o header recebido.
 * @param {Buffer|string} rawBody corpo bruto do request (Buffer via req.rawBody)
 * @param {string} signatureHeader valor do header x-webhook-signature (hex)
 * @param {string} [secret] segredo do tenant (fallback: global de env)
 * @returns {boolean}
 */
function verifyWebhook(rawBody, signatureHeader, secret) {
  const key = (typeof secret === 'string' && secret) ? secret : GLOBAL_WEBHOOK_SECRET;
  try {
    if (!key || !signatureHeader || rawBody == null) return false;
    const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody);
    const expected = crypto.createHmac('sha256', key).update(body).digest('hex');
    const a = Buffer.from(expected);
    const b = Buffer.from(String(signatureHeader));
    // timingSafeEqual exige tamanhos iguais; tamanhos diferentes => assinatura inválida
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// Normaliza o payload do provedor de assinatura para o formato interno único.
// Aceita Buffer (corpo bruto) OU objeto já parseado.
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
  if (!body.envelopeId || !body.status) return null;
  return {
    envelopeId: body.envelopeId,
    status: body.status, // assinado | recusado | expirado
    signedAt: body.signedAt || new Date().toISOString(),
    signatureHash:
      body.signatureHash || crypto.createHash('sha256').update(body.envelopeId).digest('hex'),
  };
}

// -----------------------------------------------------------------------------
// DRIVER MOCK (único hoje). createEnvelope recebe a config DA CIDADE como 1º arg
// (paridade com payment-gateway); ignora-a por ser mock. Um driver real usaria
// `tenantSignature.apiKey` para autenticar no provedor.
// -----------------------------------------------------------------------------
const mockDriver = {
  name: 'mock',

  async createEnvelope(tenantSignature, { documentId, signer } = {}) {
    const envelopeId = `env_mock_${crypto.randomUUID()}`;
    console.log(`[SIGNATURE mock] envelope ${envelopeId} p/ doc=${documentId} signer=${signer?.email}`);
    return { envelopeId, signUrl: `https://mock-signature.local/sign/${envelopeId}` };
  },

  verifyWebhook,
  parseWebhookEvent,
};

// Registry de drivers. Plugar Clicksign/D4Sign/ZapSign = adicionar aqui.
const drivers = { mock: mockDriver };

/** Driver por nome (fallback mock). */
function getDriver(name) {
  return drivers[name] || mockDriver;
}

/**
 * Seleciona o driver para uma cidade a partir da sua config de assinatura.
 * Sem apiKey => mock (degrada sem quebrar). Com apiKey => provider (default mock
 * enquanto não há driver real registrado).
 * @param {object|null} tenantSignature { provider, apiKey, webhookToken }
 */
function resolveDriver(tenantSignature) {
  const hasKey =
    tenantSignature && typeof tenantSignature.apiKey === 'string' && tenantSignature.apiKey.trim();
  if (!hasKey) return mockDriver;
  return drivers[tenantSignature.provider || 'mock'] || mockDriver;
}

module.exports = {
  drivers,
  getDriver,
  resolveDriver,
  mock: mockDriver,
  GLOBAL_WEBHOOK_SECRET,
  // --- utilitários de webhook (segredo por cidade, fallback global) ---
  verifyWebhook,
  parseWebhookEvent,
  // compat: nome do driver default (mock)
  name: mockDriver.name,
};
