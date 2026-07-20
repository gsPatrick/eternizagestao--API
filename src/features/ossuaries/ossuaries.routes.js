'use strict';

const { Router } = require('express');
const controller = require('./ossuaries.controller');
const auth = require('../../middlewares/auth');
const authorize = require('../../middlewares/authorize');
const tenantResolver = require('../../middlewares/tenant-resolver');

const router = Router();
router.use(auth, tenantResolver());

const write = authorize('admin', 'operador');

// montado direto em /v1 — paths completos

// ossários
router.post('/cemeteries/:cemeteryId/ossuaries', write, controller.createOssuary);
router.get('/cemeteries/:cemeteryId/ossuaries', controller.listByCemetery);
router.get('/ossuaries/:id', controller.getOssuary);
router.patch('/ossuaries/:id', write, controller.updateOssuary);
router.delete('/ossuaries/:id', authorize('admin'), controller.removeOssuary);

// nichos
router.post('/ossuaries/:ossuaryId/niches', write, controller.createNiches);
router.get('/ossuaries/:ossuaryId/niches', controller.listNiches);
router.patch('/niches/:id', write, controller.updateNiche);

// depósitos
router.get('/niches/:id/deposits', controller.listNicheDeposits);
router.post('/deposits/:id/remove', write, controller.removeDeposit);

module.exports = router;
