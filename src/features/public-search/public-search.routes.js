'use strict';

const { Router } = require('express');
const controller = require('./public-search.controller');
const tenantResolver = require('../../middlewares/tenant-resolver');
const rateLimit = require('../../middlewares/rate-limit');

const router = Router();

// portal público: sem auth, com rate limit e tenant obrigatório (subdomínio)
router.use(rateLimit({ windowMs: 60_000, max: 30, keyPrefix: 'public-search' }), tenantResolver({ required: true }));

router.get('/search', controller.search);

module.exports = router;
