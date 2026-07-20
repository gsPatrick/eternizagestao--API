'use strict';

/**
 * LOADER DE CONFIG POR TENANT (server-side, SEGREDOS EM CLARO).
 * -----------------------------------------------------------------------------
 * Fonte única para os drivers reais lerem as credenciais de cada cidade a partir
 * de `Tenant.settings.integrations` (JSONB). Enquanto o GET público
 * (`/v1/tenant/integrations`) devolve tudo MASCARADO, este módulo devolve os
 * segredos EM CLARO — é de uso EXCLUSIVAMENTE server-side (providers/services),
 * nunca deve ser serializado para o cliente.
 *
 * Genérico DE PROPÓSITO: além do financeiro (Asaas) devolve também smtp e
 * whatsapp, para que os drivers de e-mail / WhatsApp REUSEM este mesmo loader.
 *
 * TODO(produção — criptografia em repouso): hoje `asaas.apiKey` e `smtp.password`
 * ficam em CLARO no JSONB do tenant. Antes de produção, cifrar em repouso
 * (KMS/secret store/`pgcrypto`) e DECIFRAR aqui, de modo que este continue sendo
 * o ÚNICO ponto que entrega segredos em claro aos drivers. A gravação
 * (tenants.service.updateFinanceiro/updateEmail) cifra; a leitura (aqui) decifra.
 */

const { Tenant } = require('../../models');
const { decryptSecret } = require('../../utils/secret-crypto');

const ASAAS_ENVIRONMENTS = ['sandbox', 'producao'];

// Forma vazia/segura — usada quando o tenant não existe ou não tem integrações.
// Mantém o contrato estável para os drivers (nunca `undefined`).
function emptyConfig() {
  return {
    asaas: { apiKey: null, environment: 'sandbox', provider: 'asaas', webhookToken: null },
    smtp: {
      host: '', port: null, secure: false, user: '', password: '', fromName: '', fromEmail: '',
    },
    whatsapp: { instanceName: '', status: 'desconectado' },
  };
}

// Normaliza o bloco `integrations` (JSONB) para o contrato dos drivers,
// devolvendo os SEGREDOS EM CLARO. Aceita o objeto já lido do tenant.
function fromIntegrations(integrations = {}) {
  const asaas = integrations.asaas || {};
  const smtp = integrations.smtp || {};
  const whatsapp = integrations.whatsapp || {};
  // ÚNICO ponto de DECRYPT dos segredos: valores cifrados (`enc:v1:...`) voltam a
  // claro aqui; valores legados em TEXTO passam direto (decryptSecret é no-op neles).
  const asaasApiKey = decryptSecret(asaas.apiKey);
  const asaasWebhookToken = decryptSecret(asaas.webhookToken);
  const smtpPassword = decryptSecret(smtp.password);
  return {
    asaas: {
      // segredo em claro (server-side)
      apiKey: typeof asaasApiKey === 'string' && asaasApiKey.trim() ? asaasApiKey.trim() : null,
      environment: ASAAS_ENVIRONMENTS.includes(asaas.environment) ? asaas.environment : 'sandbox',
      // driver selecionável: default 'asaas' (troca de gateway sem tocar features)
      provider: asaas.provider || 'asaas',
      // token que o Asaas envia no header `asaas-access-token` do webhook (opcional,
      // por cidade). Sem ele, cai no global `process.env.ASAAS_WEBHOOK_TOKEN`.
      webhookToken:
        typeof asaasWebhookToken === 'string' && asaasWebhookToken.trim()
          ? asaasWebhookToken.trim()
          : null,
    },
    smtp: {
      host: smtp.host || '',
      port: Number.isInteger(smtp.port) ? smtp.port : null,
      secure: Boolean(smtp.secure),
      user: smtp.user || '',
      password: typeof smtpPassword === 'string' ? smtpPassword : '', // segredo em claro
      fromName: smtp.fromName || '',
      fromEmail: smtp.fromEmail || '',
    },
    whatsapp: {
      instanceName: whatsapp.instanceName || '',
      status: whatsapp.status || 'desconectado',
    },
  };
}

/**
 * Config de integrações do tenant, com SEGREDOS EM CLARO (uso server-side).
 * @param {string} tenantId
 * @returns {Promise<{ asaas:{apiKey,environment,provider,webhookToken}, smtp:{...}, whatsapp:{instanceName,status} }>}
 */
async function getIntegrationConfig(tenantId) {
  if (!tenantId) return emptyConfig();
  const tenant = await Tenant.findByPk(tenantId, { attributes: ['id', 'settings'] });
  if (!tenant) return emptyConfig();
  const settings = tenant.settings || {};
  return fromIntegrations(settings.integrations || {});
}

/** Variante síncrona a partir de um tenant já carregado (evita 2ª query). */
function fromTenant(tenant) {
  if (!tenant) return emptyConfig();
  const settings = tenant.settings || {};
  return fromIntegrations(settings.integrations || {});
}

module.exports = { getIntegrationConfig, fromTenant, ASAAS_ENVIRONMENTS };
