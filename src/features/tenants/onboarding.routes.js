'use strict';

/**
 * Onboarding pelo ADMIN da cidade (modo delegado). Tenant resolvido SEMPRE pelo
 * token (tenantResolver ignora header/subdomínio para usuário comum), então é
 * impossível configurar a cidade de outro tenant por aqui.
 */
const { Router } = require('express');
const controller = require('./onboarding.controller');
const auth = require('../../middlewares/auth');
const authorize = require('../../middlewares/authorize');
const tenantResolver = require('../../middlewares/tenant-resolver');

const router = Router();

router.use(auth, tenantResolver());

// GET: admin (super_admin também passa no RBAC); PATCH: admin.
router.get('/onboarding', authorize('admin'), controller.getOnboarding);
router.patch('/onboarding', authorize('admin'), controller.updateOnboarding);

// Upload da logo do tenant (admin) — arquivo em base64, gravado no storage.
router.post('/logo', authorize('admin'), controller.uploadLogo);

// Imagens da PÁGINA PÚBLICA da cidade: :kind = hero | footer (admin).
router.post('/public-image/:kind', authorize('admin'), controller.uploadPublicImage);

module.exports = router;
