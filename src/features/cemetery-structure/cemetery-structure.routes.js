'use strict';

const { Router } = require('express');
const c = require('./cemetery-structure.controller');
const auth = require('../../middlewares/auth');
const authorize = require('../../middlewares/authorize');
const tenantResolver = require('../../middlewares/tenant-resolver');

const router = Router();
router.use(auth, tenantResolver());

const write = authorize('admin', 'operador');

// árvore completa do cemitério (navegação/camadas do mapa)
router.get('/cemeteries/:cemeteryId/structure', c.tree);

// quadras
router.get('/cemeteries/:cemeteryId/blocks', c.listByParent('block', 'cemeteryId'));
router.post('/cemeteries/:cemeteryId/blocks', write, c.create('block', 'cemeteryId'));
router.get('/blocks/:id', c.getById('block'));
router.patch('/blocks/:id', write, c.update('block'));
router.delete('/blocks/:id', write, c.remove('block'));

// ruas
router.get('/blocks/:blockId/streets', c.listByParent('street', 'blockId'));
router.post('/blocks/:blockId/streets', write, c.create('street', 'blockId'));
router.get('/streets/:id', c.getById('street'));
router.patch('/streets/:id', write, c.update('street'));
router.delete('/streets/:id', write, c.remove('street'));

// lotes
router.get('/streets/:streetId/lots', c.listByParent('lot', 'streetId'));
router.post('/streets/:streetId/lots', write, c.create('lot', 'streetId'));
router.get('/lots/:id', c.getById('lot'));
router.patch('/lots/:id', write, c.update('lot'));
router.delete('/lots/:id', write, c.remove('lot'));

module.exports = router;
