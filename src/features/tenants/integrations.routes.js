'use strict';

/**
 * Integrações da PRÓPRIA cidade (admin). Montado em /v1/tenant. Tenant sempre
 * pelo token (isolado); RBAC: admin (super_admin também passa). Auditoria e
 * concorrência herdadas dos hooks globais do Sequelize via tenant.update().
 */
const { Router } = require('express');
const controller = require('./integrations.controller');
const auth = require('../../middlewares/auth');
const authorize = require('../../middlewares/authorize');
const tenantResolver = require('../../middlewares/tenant-resolver');

const router = Router();

router.use(auth, tenantResolver());

router.get('/integrations', authorize('admin'), controller.getIntegrations);
router.patch('/integrations/financeiro', authorize('admin'), controller.updateFinanceiro);
router.post('/integrations/financeiro/test', authorize('admin'), controller.testFinanceiro);
router.patch('/integrations/email', authorize('admin'), controller.updateEmail);
router.post('/integrations/email/test', authorize('admin'), controller.testEmail);
router.post('/integrations/whatsapp/connect', authorize('admin'), controller.whatsappConnect);
router.get('/integrations/whatsapp/status', authorize('admin'), controller.whatsappStatus);
router.post('/integrations/whatsapp/disconnect', authorize('admin'), controller.whatsappDisconnect);

module.exports = router;
