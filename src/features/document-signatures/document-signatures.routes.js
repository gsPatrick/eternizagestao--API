'use strict';

// Paths absolutos — montar em /v1.
const { Router } = require('express');
const controller = require('./document-signatures.controller');
const auth = require('../../middlewares/auth');
const authorize = require('../../middlewares/authorize');
const tenantResolver = require('../../middlewares/tenant-resolver');

const router = Router();
router.use(auth, tenantResolver());

const write = authorize('admin', 'operador');

router.get('/documents/:documentId/signatures', controller.list);
router.post('/documents/:documentId/signatures', write, controller.create);
router.post('/documents/:documentId/signatures/simulate', write, controller.simulate);

module.exports = router;
