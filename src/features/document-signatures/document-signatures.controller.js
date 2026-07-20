'use strict';

const catchAsync = require('../../utils/catch-async');
const { ok, created } = require('../../utils/http-response');
const { requireFields, pick } = require('../../utils/validation');
const { getTenantId } = require('../../utils/request-helpers');
const service = require('./document-signatures.service');

const create = catchAsync(async (req, res) => {
  requireFields(req.body, ['signerName']);
  const data = pick(req.body, ['signerName', 'signerEmail', 'signerCpf', 'signerPersonId', 'signerRole']);
  return created(res, await service.createSignature(getTenantId(req), req.params.documentId, data));
});

const list = catchAsync(async (req, res) => {
  return ok(res, await service.list(getTenantId(req), req.params.documentId));
});

// Demo/homologação: simula o retorno do provedor (driver mock) sem depender do
// webhook externo assinado por HMAC. Reusa o mesmo caminho idempotente do webhook
// (handleWebhookEvent), preservando notificação e concorrência.
const simulate = catchAsync(async (req, res) => {
  return ok(res, await service.simulateProviderReturn(getTenantId(req), req.params.documentId));
});

// Webhook público do provedor — SEM auth/tenant. Controller fino: extrai o corpo
// bruto + header de assinatura e delega ao service. Assinatura inválida vira 401
// (via AppError no service); demais casos respondem 200 mesmo p/ envelope desconhecido.
const webhook = catchAsync(async (req, res) => {
  const result = await service.processWebhook({
    rawBody: req.rawBody,
    signature: req.get('x-webhook-signature'),
  });
  return res.status(200).json(result);
});

module.exports = { create, list, simulate, webhook };
