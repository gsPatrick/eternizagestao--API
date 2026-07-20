'use strict';

const { Router } = require('express');
const controller = require('./maintenance-fees.controller');
const auth = require('../../middlewares/auth');
const authorize = require('../../middlewares/authorize');
const tenantResolver = require('../../middlewares/tenant-resolver');

const router = Router();
router.use(auth, tenantResolver());

const write = authorize('admin', 'operador');

router.get('/', controller.list);
router.post('/batch-adjust', write, controller.batchAdjust);
router.get('/:id', controller.getById);
router.post('/', write, controller.create);
router.patch('/:id', write, controller.update);
router.patch('/:id/adjust', write, controller.adjust);
router.patch('/:id/suspend', write, controller.suspend);
router.patch('/:id/reactivate', write, controller.reactivate);
router.patch('/:id/terminate', write, controller.terminate);

module.exports = router;
