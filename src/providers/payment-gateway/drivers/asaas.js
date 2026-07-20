'use strict';

/**
 * Driver REAL do Asaas (gateway de pagamento) — API v3.
 * -----------------------------------------------------------------------------
 * Endpoints confirmados na doc oficial (docs.asaas.com, API v3):
 *   Base sandbox  : https://api-sandbox.asaas.com/v3
 *   Base produção : https://api.asaas.com/v3
 *   Header de auth: `access_token: <apiKey>`  (+ Content-Type e User-Agent obrigatórios)
 *
 *   POST /customers                 { name, cpfCnpj, email, mobilePhone } -> { id, ... }
 *   GET  /customers?cpfCnpj=...      -> { data:[ { id, ... } ] }           (dedup por CPF/CNPJ)
 *   POST /payments                  { customer, billingType, value, dueDate, description, externalReference } -> { id, status, invoiceUrl, bankSlipUrl }
 *   GET  /payments/{id}             -> { id, status, ... }
 *   GET  /payments/{id}/status      -> { status }
 *   GET  /payments/{id}/pixQrCode   -> { encodedImage, payload, expirationDate }
 *   GET  /payments/{id}/identificationField -> { identificationField, nossoNumero, barCode }  (linha digitável do boleto)
 *   DELETE /payments/{id}           -> remove/cancela a cobrança
 *   GET  /myAccount/commercialInfo  -> { name, email, cpfCnpj, status }    (teste de conexão)
 *
 * Cada cidade usa a PRÓPRIA apiKey + ambiente (tenantAsaas). Nenhum segredo mora
 * aqui: o 1º argumento de toda função é `tenantAsaas = { apiKey, environment, provider, webhookToken }`
 * vindo de features/tenants/integration-config.js.
 */

const crypto = require('crypto');

const BASE_URLS = {
  sandbox: 'https://api-sandbox.asaas.com/v3',
  producao: 'https://api.asaas.com/v3',
};
const USER_AGENT = process.env.ASAAS_USER_AGENT || 'EternizaGestao';
const TIMEOUT_MS = Number(process.env.ASAAS_TIMEOUT_MS || 15000);

// Eventos de webhook do Asaas que representam recebimento efetivo → baixa.
const PAID_EVENTS = ['PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED'];

// billingType do nosso sistema → enum do Asaas (default UNDEFINED: pagador escolhe).
function toAsaasBillingType(billingType) {
  const map = { PIX: 'PIX', BOLETO: 'BOLETO', UNDEFINED: 'UNDEFINED', CARTAO: 'CREDIT_CARD' };
  return map[String(billingType || 'UNDEFINED').toUpperCase()] || 'UNDEFINED';
}

// billingType do Asaas → método de pagamento interno (enum de Payment).
function fromAsaasBillingType(billingType) {
  const map = {
    PIX: 'pix',
    BOLETO: 'boleto',
    CREDIT_CARD: 'cartao_credito',
    DEBIT_CARD: 'cartao_debito',
    TRANSFER: 'transferencia',
    UNDEFINED: 'outro',
  };
  return map[String(billingType || '').toUpperCase()] || 'outro';
}

function baseUrl(tenantAsaas) {
  return tenantAsaas?.environment === 'producao' ? BASE_URLS.producao : BASE_URLS.sandbox;
}

// Erro de gateway com contexto — capturado como best-effort pelos services.
class AsaasError extends Error {
  constructor(message, { status, body } = {}) {
    super(message);
    this.name = 'AsaasError';
    this.status = status;
    this.body = body;
  }
}

// Extrai a 1ª mensagem amigável do formato de erro do Asaas: { errors:[{description}] }.
function asaasErrorMessage(body, fallback) {
  if (body && Array.isArray(body.errors) && body.errors.length) {
    return body.errors.map((e) => e.description || e.code).filter(Boolean).join('; ') || fallback;
  }
  return fallback;
}

/**
 * Request base ao Asaas com timeout, auth e parse de erro.
 * Lança AsaasError em status >= 400 (o chamador decide best-effort/log).
 */
async function request(tenantAsaas, method, path, body) {
  const apiKey = tenantAsaas?.apiKey;
  if (!apiKey) throw new AsaasError('Asaas sem apiKey configurada.', { status: 0 });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(`${baseUrl(tenantAsaas)}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': USER_AGENT,
        access_token: apiKey,
      },
      body: body != null ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    const reason = err.name === 'AbortError' ? `timeout após ${TIMEOUT_MS}ms` : err.message;
    throw new AsaasError(`Falha de rede ao chamar o Asaas (${reason}).`, { status: 0 });
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
    throw new AsaasError(
      asaasErrorMessage(parsed, `Asaas respondeu ${res.status}.`),
      { status: res.status, body: parsed }
    );
  }
  return parsed || {};
}

// -----------------------------------------------------------------------------
// Cliente Asaas (pagador): dedup por CPF/CNPJ, senão cria.
// -----------------------------------------------------------------------------
async function findOrCreateCustomer(tenantAsaas, payer = {}) {
  const cpfCnpj = onlyDigits(payer.cpf);
  if (cpfCnpj) {
    try {
      const found = await request(tenantAsaas, 'GET', `/customers?cpfCnpj=${cpfCnpj}&limit=1`);
      if (found && Array.isArray(found.data) && found.data[0]?.id) {
        return found.data[0].id;
      }
    } catch {
      // busca falhou → segue para criação
    }
  }
  const created = await request(tenantAsaas, 'POST', '/customers', {
    name: payer.fullName || 'Pagador',
    cpfCnpj: cpfCnpj || undefined,
    email: payer.email || undefined,
    mobilePhone: onlyDigits(payer.phone) || undefined,
  });
  return created.id;
}

function onlyDigits(v) {
  const d = String(v || '').replace(/\D/g, '');
  return d || null;
}

// -----------------------------------------------------------------------------
// Interface estável do gateway
// -----------------------------------------------------------------------------

/**
 * Cria a cobrança no Asaas e devolve os canais (PIX/boleto) normalizados.
 * @param {object} tenantAsaas { apiKey, environment }
 * @param {object} data { billingId, amount, dueDate, description, billingType, payer }
 */
async function createCharge(tenantAsaas, data = {}) {
  const customerId = await findOrCreateCustomer(tenantAsaas, data.payer || {});

  const payment = await request(tenantAsaas, 'POST', '/payments', {
    customer: customerId,
    billingType: toAsaasBillingType(data.billingType),
    value: Number(data.amount),
    dueDate: String(data.dueDate).slice(0, 10),
    description: data.description || undefined,
    // externalReference = billingId → o webhook localiza a cobrança por aqui.
    externalReference: data.billingId,
  });

  const result = {
    provider: 'asaas',
    chargeId: payment.id, // gravado em Billing.gatewayChargeId
    boleto: { barcode: null, digitableLine: null, url: payment.bankSlipUrl || payment.invoiceUrl || null },
    pix: { qrCode: null, copyPaste: null, expiresAt: null },
    raw: payment,
  };

  // PIX copia-e-cola / QR — best-effort (só existe p/ PIX/UNDEFINED).
  try {
    const pix = await getPixQr(tenantAsaas, payment.id);
    result.pix = pix;
  } catch {
    /* sem PIX disponível — segue só com boleto/invoice */
  }

  // Linha digitável do boleto — best-effort (só existe p/ BOLETO/UNDEFINED).
  try {
    const slip = await request(tenantAsaas, 'GET', `/payments/${payment.id}/identificationField`);
    result.boleto.digitableLine = slip.identificationField || null;
    result.boleto.barcode = slip.barCode || null;
  } catch {
    /* boleto ainda não emitido / não aplicável */
  }

  return result;
}

async function getCharge(tenantAsaas, id) {
  const payment = await request(tenantAsaas, 'GET', `/payments/${id}`);
  return {
    chargeId: payment.id,
    status: payment.status,
    paid: PAID_STATUSES.includes(payment.status),
    raw: payment,
  };
}

const PAID_STATUSES = ['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH'];

async function getPixQr(tenantAsaas, id) {
  const qr = await request(tenantAsaas, 'GET', `/payments/${id}/pixQrCode`);
  return {
    qrCode: qr.encodedImage ? `data:image/png;base64,${qr.encodedImage}` : null,
    copyPaste: qr.payload || null,
    expiresAt: qr.expirationDate || null,
  };
}

async function cancelCharge(tenantAsaas, id) {
  if (!id) return true;
  await request(tenantAsaas, 'DELETE', `/payments/${id}`);
  return true;
}

/**
 * Teste de conexão: valida a apiKey da cidade chamando /myAccount/commercialInfo.
 * NUNCA lança — devolve { ok, account? , message? } amigável para a UI.
 */
async function testConnection(tenantAsaas) {
  try {
    const info = await request(tenantAsaas, 'GET', '/myAccount/commercialInfo');
    return {
      ok: true,
      account: {
        name: info.name || info.companyName || null,
        email: info.email || null,
        cpfCnpj: info.cpfCnpj || null,
        status: info.status || null,
        environment: tenantAsaas?.environment || 'sandbox',
      },
    };
  } catch (err) {
    const unauthorized = err.status === 401;
    return {
      ok: false,
      message: unauthorized
        ? 'Chave de API inválida ou sem permissão para este ambiente. Confira a chave e o ambiente (Sandbox/Produção).'
        : err.message || 'Não foi possível validar a conexão com o Asaas.',
    };
  }
}

// -----------------------------------------------------------------------------
// Webhook do Asaas
// -----------------------------------------------------------------------------

/**
 * Autentica o webhook do Asaas: compara o header `asaas-access-token` com o
 * token esperado (por cidade `tenantAsaas.webhookToken` ou global
 * `ASAAS_WEBHOOK_TOKEN`) em tempo constante.
 * @param {object} req request Express (usa apenas o header)
 * @param {object} tenantAsaas config da cidade (pode ser null quando ainda não resolvido)
 */
function verifyWebhook(req, tenantAsaas) {
  const received = typeof req?.get === 'function'
    ? req.get('asaas-access-token')
    : req?.headers?.['asaas-access-token'];
  const expected = tenantAsaas?.webhookToken || process.env.ASAAS_WEBHOOK_TOKEN || null;

  // Sem token configurado (nem por cidade nem global): em produção NÃO aceita;
  // em desenvolvimento aceita com aviso (permite E2E sem configurar o Asaas).
  if (!expected) {
    if (process.env.NODE_ENV === 'production') return false;
    console.warn('[asaas] webhook sem ASAAS_WEBHOOK_TOKEN configurado — aceitando APENAS em desenvolvimento.');
    return true;
  }
  if (!received) return false;
  const a = Buffer.from(String(expected));
  const b = Buffer.from(String(received));
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/** Normaliza o corpo do webhook do Asaas para o formato interno único. */
function parseWebhookEvent(body) {
  const b = body || {};
  const payment = b.payment || {};
  if (!b.event) return null;
  return {
    eventType: b.event, // ex.: 'PAYMENT_RECEIVED'
    isPaid: PAID_EVENTS.includes(b.event),
    chargeId: payment.id || null, // = Billing.gatewayChargeId
    externalReference: payment.externalReference || null, // = billingId
    status: payment.status || null,
    amountPaid: payment.value != null ? payment.value : null,
    method: fromAsaasBillingType(payment.billingType),
    paidAt: payment.paymentDate || payment.clientPaymentDate || payment.confirmedDate || null,
  };
}

module.exports = {
  name: 'asaas',
  createCharge,
  getCharge,
  getPixQr,
  cancelCharge,
  testConnection,
  verifyWebhook,
  parseWebhookEvent,
  PAID_EVENTS,
  AsaasError,
};
