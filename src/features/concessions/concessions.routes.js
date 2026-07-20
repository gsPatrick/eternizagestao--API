'use strict';

const { Router } = require('express');
const controller = require('./concessions.controller');
const auth = require('../../middlewares/auth');
const authorize = require('../../middlewares/authorize');
const tenantResolver = require('../../middlewares/tenant-resolver');

const router = Router();
router.use(auth, tenantResolver());

const write = authorize('admin', 'operador');

// montado direto em /v1 — paths completos
router.post('/graves/:graveId/concessions', write, controller.issue);
router.get('/graves/:graveId/concessions', controller.listByGrave);
router.get('/concessions', controller.list);
router.get('/concessions/summary', controller.summary);
router.get('/concessions/:id', controller.getById);
router.post('/concessions/:id/transfer', write, controller.transfer);
router.patch('/concessions/:id/renew', write, controller.renew);
router.patch('/concessions/:id/terminate', write, controller.terminate);

module.exports = router;
