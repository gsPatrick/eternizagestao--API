'use strict';

const { Router } = require('express');
const controller = require('./exhumations.controller');
const auth = require('../../middlewares/auth');
const authorize = require('../../middlewares/authorize');
const tenantResolver = require('../../middlewares/tenant-resolver');

const router = Router();
router.use(auth, tenantResolver());

const write = authorize('admin', 'operador');

// montado direto em /v1 — paths completos
router.post('/exhumations', write, controller.create);
router.post('/exhumations/performed', write, controller.registerPerformed);
router.get('/exhumations', controller.list);
router.get('/exhumations/stats', controller.stats);
router.get('/exhumations/:id', controller.getById);
router.patch('/exhumations/:id/authorize', write, controller.authorize);
router.patch('/exhumations/:id/schedule', write, controller.schedule);
router.patch('/exhumations/:id/perform', write, controller.perform);
router.patch('/exhumations/:id/cancel', write, controller.cancel);

module.exports = router;
