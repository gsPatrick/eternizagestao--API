'use strict';

const { Router } = require('express');
const controller = require('./grave-timeline.controller');
const auth = require('../../middlewares/auth');
const tenantResolver = require('../../middlewares/tenant-resolver');

const router = Router();
router.use(auth, tenantResolver());

// linha do tempo do jazigo — sem endpoint de escrita (imutável, escrita interna)
router.get('/graves/:graveId/timeline', controller.listByGrave);

module.exports = router;
