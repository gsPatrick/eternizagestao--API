'use strict';

/**
 * Provider do gateway de pagamento (boleto/PIX) — ABSTRAÇÃO TROCÁVEL, POR CIDADE.
 * -----------------------------------------------------------------------------
 * Cada cidade (tenant) usa a PRÓPRIA conta do gateway. O driver é selecionado por
 * `tenantAsaas.provider` (default `asaas`), a partir da config em
 * `features/tenants/integration-config.js`. Sem apiKey configurada, cai no driver
 * `mock` → o dev nunca quebra. Trocar de gateway = novo driver com a MESMA
 * interface; nenhuma feature muda.
 *
 * INTERFACE DO DRIVER (estável):
 *   name
 *   createCharge(tenantAsaas, data)  -> { provider, chargeId, boleto:{barcode,digitableLine,url}, pix:{qrCode,copyPaste,expiresAt}, raw }
 *   getCharge(tenantAsaas, id)       -> { chargeId, status, paid, raw }
 *   getPixQr(tenantAsaas, id)        -> { qrCode, copyPaste, expiresAt }
 *   cancelCharge(tenantAsaas, id)    -> boolean
 *   testConnection(tenantAsaas)      -> { ok, account?, message? }   (nunca lança)
 *   verifyWebhook(req, tenantAsaas)  -> boolean
 *   parseWebhookEvent(body)          -> evento normalizado | null
 *
 * `tenantAsaas` = { apiKey, environment, provider, webhookToken } (segredos em
 * claro, uso server-side — ver integration-config.js).
 *
 * COMPAT: o caminho MOCK legado (webhook `/v1/webhooks/payment-gateway` + a
 * simulação de baixa da tela de Cobranças) continua usando os utilitários HMAC
 * do driver mock, reexportados no topo (`name`, `verifyWebhook`, `parseWebhookEvent`).
 */

const mockDriver = require('./drivers/mock');
const asaasDriver = require('./drivers/asaas');

const drivers = { mock: mockDriver, asaas: asaasDriver };

/** Driver por nome (fallback mock). */
function getDriver(name) {
  return drivers[name] || mockDriver;
}

/**
 * Seleciona o driver para uma cidade a partir da sua config Asaas.
 * Sem apiKey => mock (degrada sem quebrar). Com apiKey => provider (default asaas).
 * @param {object|null} tenantAsaas { apiKey, environment, provider }
 */
function resolveDriver(tenantAsaas) {
  const hasKey = tenantAsaas && typeof tenantAsaas.apiKey === 'string' && tenantAsaas.apiKey.trim();
  if (!hasKey) return mockDriver;
  return drivers[tenantAsaas.provider || 'asaas'] || mockDriver;
}

module.exports = {
  drivers,
  getDriver,
  resolveDriver,
  asaas: asaasDriver,
  mock: mockDriver,
  // --- compat com o caminho MOCK legado (webhook HMAC + simulação) ---
  name: mockDriver.name, // 'mock'
  verifyWebhook: mockDriver.verifyWebhook, // HMAC(rawBody, signatureHeader)
  parseWebhookEvent: mockDriver.parseWebhookEvent,
};
