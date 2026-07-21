'use strict';

const { Router } = require('express');
const controller = require('./deceased.controller');
const auth = require('../../middlewares/auth');
const authorize = require('../../middlewares/authorize');
const tenantResolver = require('../../middlewares/tenant-resolver');

const router = Router();
router.use(auth, tenantResolver());

const write = authorize('admin', 'operador');

router.get('/', controller.list);
router.get('/location-counts', controller.locationCounts);
router.get('/:id', controller.getById);
router.post('/', write, controller.create);
router.post('/:id/photo', write, controller.uploadPhoto);
router.post('/:id/death-certificate', write, controller.uploadDeathCertificate);
router.patch('/:id', write, controller.update);
router.get('/:id/delete-impact', authorize('admin'), controller.deleteImpact);
router.delete('/:id', authorize('admin'), controller.remove);

module.exports = router;
