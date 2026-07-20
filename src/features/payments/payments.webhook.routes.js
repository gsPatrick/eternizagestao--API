'use strict';

// Webhook do gateway de pagamento — montado em /v1/webhooks/payment-gateway.
// SEM auth/tenant: a assinatura é validada pelo provider e a cobrança é
// localizada pelo gatewayChargeId. Rate limit protege contra abuso.
const { Router } = require('express');
const catchAsync = require('../../utils/catch-async');
const rateLimit = require('../../middlewares/rate-limit');
const service = require('./payments.service');

const router = Router();

router.post(
  '/',
  rateLimit({ max: 120, keyPrefix: 'rl:payment-webhook' }),
  catchAsync(async (req, res) => {
    // Desacoplado do Express: passa só o corpo bruto + assinatura (HMAC sobre req.rawBody)
    const result = await service.processWebhook({
      rawBody: req.rawBody,
      signature: req.get('x-webhook-signature'),
    });
    return res.status(200).json(result); // sempre 200 {received:true} (401 só p/ assinatura inválida)
  })
);

module.exports = router;
