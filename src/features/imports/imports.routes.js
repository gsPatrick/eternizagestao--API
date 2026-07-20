'use strict';

const { Router } = require('express');
const controller = require('./imports.controller');
const auth = require('../../middlewares/auth');
const authorize = require('../../middlewares/authorize');
const tenantResolver = require('../../middlewares/tenant-resolver');

const router = Router();
router.use(auth, tenantResolver());

const write = authorize('admin', 'operador');

router.get('/', controller.list);
router.get('/:id', controller.getById);
router.get('/:id/records', controller.listRecords);
router.post('/', write, controller.create);
router.post('/:id/validate', write, controller.validate);
// Efetivação escreve em massa nas tabelas de produção — somente admin.
router.post('/:id/commit', authorize('admin'), controller.commit);
router.patch('/:id/cancel', write, controller.cancel);

module.exports = router;
