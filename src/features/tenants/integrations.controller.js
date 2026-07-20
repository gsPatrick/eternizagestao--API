'use strict';

/**
 * Integrações POR CIDADE (financeiro/Asaas, e-mail/SMTP, WhatsApp/Evolution).
 * Tenant resolvido SEMPRE pelo token (tenantResolver ignora header/subdomínio
 * para usuário comum) → o admin só configura o PRÓPRIO tenant. FASE 1: só
 * armazenamento/config; os drivers reais são a FASE 2. Segredos nunca retornam
 * em claro (o service devolve status mascarado).
 */
const catchAsync = require('../../utils/catch-async');
const { ok } = require('../../utils/http-response');
const { pick } = require('../../utils/validation');
const { getTenantId } = require('../../utils/request-helpers');
const service = require('./tenants.service');

// GET /v1/tenant/integrations — status MASCARADO das integrações do tenant.
const getIntegrations = catchAsync(async (req, res) => {
  return ok(res, await service.getIntegrations(getTenantId(req)));
});

// PATCH /v1/tenant/integrations/financeiro — Asaas (apiKey opcional, environment).
const updateFinanceiro = catchAsync(async (req, res) => {
  const data = pick(req.body || {}, ['apiKey', 'environment']);
  return ok(res, await service.updateFinanceiro(getTenantId(req), data));
});

// POST /v1/tenant/integrations/financeiro/test — testa a conexão com o Asaas do
// tenant (driver.testConnection). Sempre 200 com { ok, account?/message? }.
const testFinanceiro = catchAsync(async (req, res) => {
  return ok(res, await service.testFinanceiro(getTenantId(req)));
});

// PATCH /v1/tenant/integrations/email — SMTP (password opcional).
const updateEmail = catchAsync(async (req, res) => {
  const data = pick(req.body || {}, ['host', 'port', 'secure', 'user', 'password', 'fromName', 'fromEmail']);
  return ok(res, await service.updateEmail(getTenantId(req), data));
});

// POST /v1/tenant/integrations/email/test — envia um e-mail de teste pelo SMTP
// do tenant. Sempre 200 com { ok, message } (nunca lança por credencial ruim).
const testEmail = catchAsync(async (req, res) => {
  return ok(res, await service.testEmail(getTenantId(req)));
});

// POST /v1/tenant/integrations/whatsapp/connect — garante a instância Evolution
// da cidade + webhook e devolve o QR (base64). { ok, qrCode, status, ... }.
const whatsappConnect = catchAsync(async (req, res) => {
  return ok(res, await service.whatsappConnect(getTenantId(req)));
});

// GET /v1/tenant/integrations/whatsapp/status — estado da conexão (atualiza settings).
const whatsappStatus = catchAsync(async (req, res) => {
  return ok(res, await service.whatsappStatus(getTenantId(req)));
});

// POST /v1/tenant/integrations/whatsapp/disconnect — logout/limpa a instância.
const whatsappDisconnect = catchAsync(async (req, res) => {
  return ok(res, await service.whatsappDisconnect(getTenantId(req)));
});

module.exports = {
  getIntegrations,
  updateFinanceiro,
  testFinanceiro,
  updateEmail,
  testEmail,
  whatsappConnect,
  whatsappStatus,
  whatsappDisconnect,
};
