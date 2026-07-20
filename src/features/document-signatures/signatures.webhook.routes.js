'use strict';

// Webhook do provedor de assinatura — SEM auth, com rate-limit.
// Montar em /v1/webhooks/signature.
const { Router } = require('express');
const rateLimit = require('../../middlewares/rate-limit');
const controller = require('./document-signatures.controller');

const router = Router();

router.post('/', rateLimit({ windowMs: 60_000, max: 120, keyPrefix: 'signature-webhook' }), controller.webhook);

module.exports = router;
