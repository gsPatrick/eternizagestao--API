'use strict';

// Montar em /v1/portal (paths relativos).
// Auth própria do Portal da Família — NUNCA usa o auth administrativo.
const { Router } = require('express');
const controller = require('./family-portal.controller');
const tenantResolver = require('../../middlewares/tenant-resolver');
const portalAuth = require('../../middlewares/portal-auth');
const rateLimit = require('../../middlewares/rate-limit');

const router = Router();
router.use(tenantResolver({ required: true }));

// Endpoints de credencial: rate-limit contra força bruta/enumeração.
const credentialLimiter = rateLimit({ windowMs: 60_000, max: 10, keyPrefix: 'portal' });

router.post('/register', credentialLimiter, controller.register);
router.post('/activate', credentialLimiter, controller.activate);
router.post('/sessions', credentialLimiter, controller.login);

router.get('/me', portalAuth, controller.getMe);
router.patch('/me', portalAuth, controller.updateMe);
router.patch('/password', portalAuth, credentialLimiter, controller.changePassword);
router.get('/debts', portalAuth, controller.listDebts);
router.get('/billings', portalAuth, controller.listBillings);
router.post('/billings/:id/reissue', portalAuth, controller.reissueBilling);
router.get('/graves', portalAuth, controller.listGraves);
router.get('/deceased', portalAuth, controller.listDeceased);

module.exports = router;
