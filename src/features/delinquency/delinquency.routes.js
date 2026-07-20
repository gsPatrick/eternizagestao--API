'use strict';

const { Router } = require('express');
const controller = require('./delinquency.controller');
const auth = require('../../middlewares/auth');
const authorize = require('../../middlewares/authorize');
const tenantResolver = require('../../middlewares/tenant-resolver');

const router = Router();
router.use(auth, tenantResolver());

const write = authorize('admin', 'operador');

router.get('/', controller.panel);
router.get('/summary', controller.summary);
router.post('/sync-blocks', authorize('admin'), controller.syncBlocks);
router.post('/notify-all', write, controller.notifyAll);
router.post('/payers/:personId/notify', write, controller.notifyPayer);
router.post('/payers/:personId/block', authorize('admin'), controller.blockPayer);
router.post('/payers/:personId/unblock', authorize('admin'), controller.unblockPayer);

module.exports = router;
