'use strict';

const { Router } = require('express');
const controller = require('./burials.controller');
const auth = require('../../middlewares/auth');
const authorize = require('../../middlewares/authorize');
const tenantResolver = require('../../middlewares/tenant-resolver');

const router = Router();
router.use(auth, tenantResolver());

const write = authorize('admin', 'operador');

// montado direto em /v1 — paths completos
router.post('/burials', write, controller.create);
router.get('/burials', controller.list);
router.get('/burials/stats', controller.stats);
router.get('/burials/:id', controller.getById);

module.exports = router;
