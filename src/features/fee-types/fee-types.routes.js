'use strict';

const { Router } = require('express');
const controller = require('./fee-types.controller');
const auth = require('../../middlewares/auth');
const authorize = require('../../middlewares/authorize');
const tenantResolver = require('../../middlewares/tenant-resolver');

const router = Router();
router.use(auth, tenantResolver());

const write = authorize('admin', 'operador');

router.get('/', controller.list);
router.get('/:id', controller.getById);
router.post('/', write, controller.create);
router.patch('/:id', write, controller.update);
router.delete('/:id', authorize('admin'), controller.remove);

module.exports = router;
