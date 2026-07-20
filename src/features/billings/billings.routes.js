'use strict';

const { Router } = require('express');
const controller = require('./billings.controller');
const auth = require('../../middlewares/auth');
const authorize = require('../../middlewares/authorize');
const tenantResolver = require('../../middlewares/tenant-resolver');

const router = Router();
router.use(auth, tenantResolver());

const write = authorize('admin', 'operador');

// rotas fixas antes das parametrizadas
router.get('/', controller.list);
router.get('/summary', controller.summary);
router.post('/', write, controller.create);
router.post('/generate', write, controller.generate);
router.post('/mark-overdue', write, controller.markOverdue);
router.get('/:id', controller.getById);
router.post('/:id/reissue', write, controller.reissue);
router.patch('/:id/cancel', write, controller.cancel);

module.exports = router;
