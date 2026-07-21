'use strict';

const express = require('express');
const { Router } = require('express');
const controller = require('./map.controller');
const auth = require('../../middlewares/auth');
const authorize = require('../../middlewares/authorize');
const tenantResolver = require('../../middlewares/tenant-resolver');

const router = Router();
router.use(auth, tenantResolver());

// Upload BINÁRIO da ortofoto: recebe o arquivo cru (image/*, octet-stream) até
// um limite generoso (drone → dezenas de MB), sem o inchaço do base64-em-JSON.
// Só parseia corpos NÃO-JSON (o express.json global cuida do resto das rotas).
const orthoBinary = express.raw({
  type: (req) => {
    const ct = req.headers['content-type'] || '';
    return ct && !ct.includes('application/json');
  },
  limit: process.env.ORTHO_UPLOAD_LIMIT || '150mb',
});

const write = authorize('admin', 'operador');
// ORTOFOTO — enviar e POSICIONAR é do ADMIN da cidade: sem posicionar (definir
// os 4 cantos) a imagem nunca aparece no mapa, então travar isso no super_admin
// deixava a cidade com a ortofoto invisível e sem saída.
const orthoWrite = authorize('admin');
// EXCLUIR continua exclusivo da plataforma (super_admin): protege contra apagar
// por imperícia/má-fé, que era a preocupação original.
const orthoDelete = authorize('super_admin');

// contexto do mapa: centro do cemitério + ortofoto ativa + bounds
router.get('/map/context', controller.getMapContext);

// ortofotos — estilo query-param (?cemeteryId=) usado pelo painel do mapa
router.get('/orthophotos', controller.listOrthophotos);
router.post('/orthophotos', orthoWrite, orthoBinary, controller.uploadOrthophoto);
router.patch('/orthophotos/:id', orthoWrite, controller.updateOrthophoto);
router.delete('/orthophotos/:id', orthoDelete, controller.removeOrthophoto);

// ortofotos — estilo path-param (compatibilidade)
router.get('/cemeteries/:cemeteryId/orthophotos', controller.listOrthophotos);
router.post('/cemeteries/:cemeteryId/orthophotos', orthoWrite, orthoBinary, controller.uploadOrthophoto);

// malha de caminhos (GPS)
router.get('/cemeteries/:cemeteryId/map-paths', controller.listPaths);
router.post('/cemeteries/:cemeteryId/map-paths', write, controller.createPath);
router.delete('/map-paths/:id', write, controller.removePath);

// demarcação da sepultura sobre a ortofoto
router.patch('/graves/:graveId/geometry', write, controller.setGraveGeometry);

module.exports = router;
