'use strict';

// Webhook do ASAAS — montado em /v1/webhooks/asaas.
// SEM auth/tenant do painel: o Asaas autentica pelo header `asaas-access-token`
// (validado no service) e a cobrança é localizada por externalReference (=billingId).
// Rate limit protege contra abuso. Sempre 200 {received:true}; token inválido → 401.
const { Router } = require('express');
const catchAsync = require('../../utils/catch-async');
const rateLimit = require('../../middlewares/rate-limit');
const service = require('./payments.service');

const router = Router();

router.post(
  '/',
  rateLimit({ max: 120, keyPrefix: 'rl:asaas-webhook' }),
  catchAsync(async (req, res) => {
    // passa o req (p/ ler o header asaas-access-token) + o corpo bruto
    const result = await service.processAsaasWebhook({ req, rawBody: req.rawBody });
    return res.status(200).json(result);
  })
);

module.exports = router;
