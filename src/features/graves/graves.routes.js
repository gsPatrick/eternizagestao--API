'use strict';

const { Router } = require('express');
const controller = require('./graves.controller');
const auth = require('../../middlewares/auth');
const authorize = require('../../middlewares/authorize');
const tenantResolver = require('../../middlewares/tenant-resolver');

const router = Router();
router.use(auth, tenantResolver());

const write = authorize('admin', 'operador');

router.get('/', controller.list);
router.get('/status-counts', controller.statusCounts);
router.get('/:id', controller.getById);
router.get('/:id/summary', controller.summary);
router.post('/', write, controller.create);
router.patch('/:id', write, controller.update);
router.post('/:id/photo', write, controller.uploadPhoto);
router.patch('/:id/status', write, controller.changeStatus);
router.patch('/:id/block', authorize('admin'), controller.block);
router.patch('/:id/unblock', authorize('admin'), controller.unblock);
router.get('/:id/delete-impact', authorize('admin'), controller.deleteImpact);
router.delete('/:id', authorize('admin'), controller.remove);

module.exports = router;
