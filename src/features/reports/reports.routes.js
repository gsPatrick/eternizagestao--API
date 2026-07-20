'use strict';

const { Router } = require('express');
const controller = require('./reports.controller');
const auth = require('../../middlewares/auth');
const tenantResolver = require('../../middlewares/tenant-resolver');

const router = Router();
router.use(auth, tenantResolver());

router.get('/occupancy', controller.occupancy);
router.get('/burials', controller.burials);
router.get('/exhumations', controller.exhumations);
router.get('/revenue', controller.revenue);
router.get('/delinquency', controller.delinquency);
router.get('/concessions', controller.concessions);
router.get('/schedules', controller.schedules);
router.get('/billings-summary', controller.billingsSummary);
router.get('/expiring-concessions', controller.expiringConcessions);
router.get('/deceased-by-location', controller.deceasedByLocation);
router.get('/transfers', controller.transfers);

module.exports = router;
