'use strict';

const { Router } = require('express');
const controller = require('./tenants.controller');
const auth = require('../../middlewares/auth');
const authorize = require('../../middlewares/authorize');
const tenantResolver = require('../../middlewares/tenant-resolver');

const router = Router();

// público: branding do tenant do subdomínio (telas de login/portal)
router.get('/current', tenantResolver({ required: true }), controller.current);

// gestão de tenants: exclusiva da plataforma (super_admin)
router.use(auth, authorize()); // authorize() sem roles => só super_admin passa
router.get('/', controller.list);
router.post('/', controller.create);
router.get('/:id', controller.getById);
router.patch('/:id', controller.update);
router.delete('/:id', controller.remove);

// Gestão da cidade (ativar/desativar + reconvite ao primeiro admin)
router.post('/:id/activate', controller.activate);
router.post('/:id/deactivate', controller.deactivate);
router.post('/:id/resend-invite', controller.resendInvite);
router.post('/:id/logo', controller.uploadLogo);

module.exports = router;
