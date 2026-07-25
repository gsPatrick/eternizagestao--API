'use strict';

const { Router } = require('express');
const controller = require('./roles.controller');
const auth = require('../../middlewares/auth');
const authorize = require('../../middlewares/authorize');
const tenantResolver = require('../../middlewares/tenant-resolver');

const router = Router();

// Gestão de perfis é exclusiva do ADMIN da cidade (super_admin também passa,
// via header X-Tenant-Subdomain). Tenant-scoped pelo tenant-resolver.
router.use(auth, tenantResolver());

router.get('/catalog', authorize('admin'), controller.catalog);
router.get('/', authorize('admin'), controller.list);
router.get('/:id', authorize('admin'), controller.getById);
router.post('/', authorize('admin'), controller.create);
router.patch('/:id', authorize('admin'), controller.update);
router.delete('/:id', authorize('admin'), controller.remove);

module.exports = router;
