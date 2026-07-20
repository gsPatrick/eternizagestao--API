'use strict';

const { Router } = require('express');
const controller = require('./map.controller');
const auth = require('../../middlewares/auth');
const authorize = require('../../middlewares/authorize');
const tenantResolver = require('../../middlewares/tenant-resolver');

const router = Router();
router.use(auth, tenantResolver());

const write = authorize('admin', 'operador');

// contexto do mapa: centro do cemitério + ortofoto ativa + bounds
router.get('/map/context', controller.getMapContext);

// ortofotos — estilo query-param (?cemeteryId=) usado pelo painel do mapa
router.get('/orthophotos', controller.listOrthophotos);
router.post('/orthophotos', write, controller.uploadOrthophoto);
router.patch('/orthophotos/:id', write, controller.updateOrthophoto);
router.delete('/orthophotos/:id', write, controller.removeOrthophoto);

// ortofotos — estilo path-param (compatibilidade)
router.get('/cemeteries/:cemeteryId/orthophotos', controller.listOrthophotos);
router.post('/cemeteries/:cemeteryId/orthophotos', write, controller.uploadOrthophoto);

// malha de caminhos (GPS)
router.get('/cemeteries/:cemeteryId/map-paths', controller.listPaths);
router.post('/cemeteries/:cemeteryId/map-paths', write, controller.createPath);
router.delete('/map-paths/:id', write, controller.removePath);

// demarcação da sepultura sobre a ortofoto
router.patch('/graves/:graveId/geometry', write, controller.setGraveGeometry);

module.exports = router;
