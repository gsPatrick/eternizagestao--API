'use strict';

// Paths absolutos — montar em /v1.
const { Router } = require('express');
const controller = require('./schedules.controller');
const auth = require('../../middlewares/auth');
const authorize = require('../../middlewares/authorize');
const tenantResolver = require('../../middlewares/tenant-resolver');

const router = Router();
router.use(auth, tenantResolver());

const write = authorize('admin', 'operador');

router.get('/schedules', controller.list);
// Leitura (StatCard "Agendados hoje") — antes de /:id para não colidir com o param.
router.get('/schedules/today-count', controller.todayCount);
router.get('/schedules/:id', controller.getById);
router.post('/schedules', write, controller.create);
router.patch('/schedules/:id', write, controller.update);
router.patch('/schedules/:id/status', write, controller.changeStatus);

module.exports = router;
