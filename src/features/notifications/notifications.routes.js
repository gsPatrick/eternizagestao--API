'use strict';

// Montar em /v1/notifications (paths relativos).
const { Router } = require('express');
const controller = require('./notifications.controller');
const auth = require('../../middlewares/auth');
const authorize = require('../../middlewares/authorize');
const tenantResolver = require('../../middlewares/tenant-resolver');

const router = Router();
router.use(auth, tenantResolver());

router.get('/', controller.list);
// Somente leitura — estado real do agendador. ANTES de '/:id' para não ser
// capturada como um id de notificação.
router.get('/automations', controller.listAutomations);
router.get('/:id', controller.getById);

// Avulsa (manual) e reenvio: admin ou operador.
router.post('/', authorize('admin', 'operador'), controller.create);
router.post('/:id/retry', authorize('admin', 'operador'), controller.retry);

// Bulk e teste: admin.
router.post('/bulk', authorize('admin'), controller.bulk);
router.post('/test', authorize('admin'), controller.test);

module.exports = router;
