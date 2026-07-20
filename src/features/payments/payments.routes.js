'use strict';

// Montado em /v1 — paths absolutos (a baixa manual vive sob /billings/:billingId).
const { Router } = require('express');
const controller = require('./payments.controller');
const auth = require('../../middlewares/auth');
const authorize = require('../../middlewares/authorize');
const tenantResolver = require('../../middlewares/tenant-resolver');

const router = Router();
router.use(auth, tenantResolver());

const write = authorize('admin', 'operador');

router.post('/billings/:billingId/payments', write, controller.createManual);
router.post('/billings/:billingId/simulate-gateway-payment', write, controller.simulateGateway);
router.get('/payments', controller.list);
router.get('/payments/:id', controller.getById);
router.get('/payments/:id/receipt', controller.receipt);

module.exports = router;
