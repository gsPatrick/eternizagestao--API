'use strict';

const { Router } = require('express');
const controller = require('./sessions.controller');
const auth = require('../../middlewares/auth');
const tenantResolver = require('../../middlewares/tenant-resolver');
const rateLimit = require('../../middlewares/rate-limit');

const router = Router();

// login: tenant é opcional (super_admin loga sem tenant); rate limit anti brute-force
router.post('/', rateLimit({ windowMs: 60_000, max: 10, keyPrefix: 'login' }), tenantResolver({ required: false }), controller.login);
router.post('/refresh', controller.refresh);
router.get('/me', auth, controller.me);
router.patch('/me', auth, controller.updateMe);
router.patch('/me/password', auth, controller.changeMyPassword);

module.exports = router;
