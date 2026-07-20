'use strict';

// Paths absolutos — montar em /v1 (rotas aninhadas em cemitério + acesso direto).
const { Router } = require('express');
const controller = require('./chapels.controller');
const auth = require('../../middlewares/auth');
const authorize = require('../../middlewares/authorize');
const tenantResolver = require('../../middlewares/tenant-resolver');

const router = Router();
router.use(auth, tenantResolver());

const write = authorize('admin', 'operador');

router.get('/cemeteries/:cemeteryId/chapels', controller.list);
router.post('/cemeteries/:cemeteryId/chapels', write, controller.create);
router.get('/chapels/:id', controller.getById);
router.patch('/chapels/:id', write, controller.update);
router.delete('/chapels/:id', authorize('admin'), controller.remove);

module.exports = router;
