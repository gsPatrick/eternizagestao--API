'use strict';

const { Router } = require('express');
const controller = require('./users.controller');
const auth = require('../../middlewares/auth');
const authorize = require('../../middlewares/authorize');
const tenantResolver = require('../../middlewares/tenant-resolver');

const router = Router();

router.use(auth, tenantResolver());

router.get('/', authorize('admin', 'operador', 'consulta'), controller.list);
router.get('/:id', authorize('admin', 'operador', 'consulta'), controller.getById);
router.post('/', authorize('admin'), controller.create);
router.post('/invite', authorize('admin'), controller.invite);
router.patch('/:id', authorize('admin'), controller.update);
router.patch('/:id/password', authorize('admin'), controller.changePassword);
router.post('/:id/password-reset', authorize('admin'), controller.passwordReset);
router.post('/:id/resend-invite', authorize('admin'), controller.resendInvite);
router.patch('/:id/activate', authorize('admin'), controller.activate);
router.patch('/:id/deactivate', authorize('admin'), controller.deactivate);
router.delete('/:id', authorize('admin'), controller.remove);

module.exports = router;
