'use strict';

// Paths relativos — montar em /v1/documents.
const { Router } = require('express');
const controller = require('./documents.controller');
const auth = require('../../middlewares/auth');
const authorize = require('../../middlewares/authorize');
const tenantResolver = require('../../middlewares/tenant-resolver');

const router = Router();
router.use(auth, tenantResolver());

const write = authorize('admin', 'operador');

router.get('/', controller.list);
// Config do texto legal por cidade (antes de /:id para não colidir com o param).
router.get('/settings', controller.getSettings);
router.patch('/settings', authorize('admin'), controller.updateSettings);
router.get('/:id/pdf', controller.downloadPdf);
router.get('/:id', controller.getById);
router.post('/', write, controller.issue);
router.post('/:id/reissue', write, controller.reissue);
router.patch('/:id/cancel', write, controller.cancel);

module.exports = router;
