'use strict';

const { Router } = require('express');
const controller = require('./public-map.controller');
const tenantResolver = require('../../middlewares/tenant-resolver');
const rateLimit = require('../../middlewares/rate-limit');

const router = Router();

// app do visitante: sem auth, com rate limit e tenant obrigatório
router.use(rateLimit({ windowMs: 60_000, max: 60, keyPrefix: 'public-map' }), tenantResolver({ required: true }));

router.get('/cemeteries/:id/map', controller.cemeteryMap);
router.get('/graves/:id/route', controller.graveRoute);

module.exports = router;
