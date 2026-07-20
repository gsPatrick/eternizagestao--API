'use strict';

const { Router } = require('express');
const controller = require('./grave-maintenances.controller');
const auth = require('../../middlewares/auth');
const authorize = require('../../middlewares/authorize');
const tenantResolver = require('../../middlewares/tenant-resolver');

const router = Router();
router.use(auth, tenantResolver());

const write = authorize('admin', 'operador');

router.get('/graves/:graveId/maintenances', controller.listByGrave);
router.post('/graves/:graveId/maintenances', write, controller.create);
router.get('/maintenances', controller.list);
router.get('/maintenances/:id', controller.getById);
router.patch('/maintenances/:id', write, controller.update);
router.patch('/maintenances/:id/status', write, controller.changeStatus);

module.exports = router;
