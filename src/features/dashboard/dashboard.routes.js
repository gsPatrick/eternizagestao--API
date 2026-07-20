'use strict';

const { Router } = require('express');
const controller = require('./dashboard.controller');
const auth = require('../../middlewares/auth');
const tenantResolver = require('../../middlewares/tenant-resolver');

const router = Router();
router.use(auth, tenantResolver());

router.get('/', controller.getDashboard);

module.exports = router;
