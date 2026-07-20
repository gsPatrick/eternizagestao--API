'use strict';

const { Router } = require('express');
const controller = require('./data-exports.controller');
const auth = require('../../middlewares/auth');
const authorize = require('../../middlewares/authorize');
const tenantResolver = require('../../middlewares/tenant-resolver');

const router = Router();
router.use(auth, tenantResolver());

const write = authorize('admin', 'operador');

router.get('/', controller.list);
router.get('/:id', controller.getById);
router.post('/', write, controller.create);

module.exports = router;
