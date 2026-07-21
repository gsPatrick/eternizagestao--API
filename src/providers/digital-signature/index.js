'use strict';

/**
 * Provider de assinatura eletrônica de documentos — ABSTRAÇÃO TROCÁVEL, POR CIDADE.
 * -----------------------------------------------------------------------------
 * Espelha o padrão do `payment-gateway` (que já é por cidade): cada cidade
 * (tenant) usa a PRÓPRIA conta do provedor de assinatura. O driver é selecionado
 * a partir da config em `Tenant.settings.integrations.signature`
 * (`{ provider, apiKey, webhookToken }`), lida server-side pela feature
 * `document-signatures` (getSignatureConfig).
 *
 * ESTADO REAL (produção): NENHUM provedor de assinatura está contratado. Só
 * existe o driver `mock`, que apenas inventava um `envelopeId` e uma URL
 * `https://mock-signature.local/...`. Com isso a DocumentSignature era gravada
 * como 'enviado' e o documento ia para 'aguardando_assinatura' — o cartório
 * ficava esperando eternamente uma assinatura que nunca foi solicitada a
 * ninguém. Por isso `createEnvelope` RECUSA o envio com AppError
 * (SIGNATURE_PROVIDER_NOT_CONFIGURED) em vez de fingir.
 *
 * SCAFFOLD / DÍVIDA TÉCNICA — como plugar um provedor real depois:
 *   1. criar `./drivers/<provedor>.js` (Clicksign / D4Sign / ZapSign) exportando
 *      { name, createEnvelope(tenantSignature, {...}), verifyWebhook, parseWebhookEvent };
 *   2. registrá-lo no objeto `drivers` abaixo;
 *   3. gravar `{ provider, apiKey, webhookToken }` em
 *      `Tenant.settings.integrations.signature` (endpoint de integrações em
 *      tenants.service — ainda não implementado para assinatura).
 * Feito isso, `resolveDriver` já devolve o driver real e nada mais muda: a
 * feature `document-signatures` não conhece provedor nenhum.
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
const AppError = require('../../utils/app-error');

const IS_PROD = process.env.NODE_ENV === 'production';

// Mensagem única do estado "sem provedor" — acionável e sem prometer nada.
const SIGNATURE_NOT_CONFIGURED_MESSAGE =
  'Assinatura eletrônica indisponível: nenhum provedor de assinatura está contratado/configurado '
  + 'para esta cidade. O documento NÃO foi enviado para assinatura.';

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
// DRIVER MOCK (único hoje) — SENTINELA de "sem provedor contratado".
// createEnvelope recebe a config DA CIDADE como 1º arg (paridade com
// payment-gateway). Um driver real usaria `tenantSignature.apiKey` para
// autenticar no provedor e devolveria o envelopeId/signUrl DELE.
//
// O envio RECUSA: sem provedor não existe envelope, não existe link de
// assinatura e ninguém é notificado. Fingir sucesso aqui deixava o documento
// preso em 'aguardando_assinatura' para sempre.
// Os utilitários de webhook (verifyWebhook/parseWebhookEvent) continuam válidos:
// são o contrato de RECEPÇÃO, reaproveitado pelo futuro driver real.
// -----------------------------------------------------------------------------
const mockDriver = {
  name: 'mock',

  async createEnvelope(tenantSignature, { documentId, signer } = {}) {
    console.warn(
      `[SIGNATURE] envio RECUSADO — nenhum provedor configurado. doc=${documentId} signer=${signer?.email}`
    );
    // 503: a operação é válida, falta a integração — não é erro de payload.
    throw new AppError(SIGNATURE_NOT_CONFIGURED_MESSAGE, 503, 'SIGNATURE_PROVIDER_NOT_CONFIGURED');
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
 * Hoje SEMPRE cai no mock (sentinela) porque não há driver real registrado —
 * mesmo com apiKey salva, `drivers` só conhece 'mock'. Assim que um driver real
 * for registrado, uma cidade com apiKey passa a usá-lo sem mudar nenhuma feature.
 * @param {object|null} tenantSignature { provider, apiKey, webhookToken }
 */
function resolveDriver(tenantSignature) {
  const hasKey =
    tenantSignature && typeof tenantSignature.apiKey === 'string' && tenantSignature.apiKey.trim();
  if (!hasKey) return mockDriver;
  return drivers[tenantSignature.provider || 'mock'] || mockDriver;
}

/** Existe provedor de assinatura REAL para esta cidade? (hoje: sempre false) */
function isConfigured(tenantSignature) {
  return resolveDriver(tenantSignature).name !== 'mock';
}

module.exports = {
  drivers,
  getDriver,
  resolveDriver,
  isConfigured,
  SIGNATURE_NOT_CONFIGURED_MESSAGE,
  mock: mockDriver,
  GLOBAL_WEBHOOK_SECRET,
  // --- utilitários de webhook (segredo por cidade, fallback global) ---
  verifyWebhook,
  parseWebhookEvent,
  // compat: nome do driver default (mock)
  name: mockDriver.name,
};
