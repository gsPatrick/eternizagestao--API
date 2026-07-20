'use strict';

const { Router } = require('express');
const controller = require('./audit-logs.controller');
const auth = require('../../middlewares/auth');
const authorize = require('../../middlewares/authorize');
const tenantResolver = require('../../middlewares/tenant-resolver');

const router = Router();
router.use(auth, tenantResolver());

// Auditoria é sensível — somente admin consulta.
// GET / — filtros (todos opcionais e combináveis) via query params:
//   action        uma ação exata (ex.: edicao)
//   actionGroup   grupo semântico: criacoes|edicoes|exclusoes|acessos|financeiro|documentos|todas
//   userId        UUID do autor
//   entityType    tipo da entidade (ex.: Grave)
//   dateFrom      ISO — created_at >= dateFrom
//   dateTo        ISO — created_at <= dateTo
//   q             busca livre (description/entityType/ipAddress, iLike)
//   page/perPage  paginação (perPage padrão 30)
router.get('/', authorize('admin'), controller.list);
router.get('/:id', authorize('admin'), controller.getById);

module.exports = router;
