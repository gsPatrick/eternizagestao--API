'use strict';

const { Router } = require('express');
const controller = require('./people.controller');
const auth = require('../../middlewares/auth');
const authorize = require('../../middlewares/authorize');
const tenantResolver = require('../../middlewares/tenant-resolver');

const router = Router();
router.use(auth, tenantResolver());

const write = authorize('admin', 'operador');

router.get('/', controller.list);
router.get('/summary', controller.summary);
router.get('/:id', controller.getById);
router.post('/', write, controller.create);
router.post('/:id/photo', write, controller.uploadPhoto);
router.patch('/:id', write, controller.update);
router.delete('/:id', authorize('admin'), controller.remove);
router.post('/:id/relationships', write, controller.addRelationship);
router.delete('/:id/relationships/:relationshipId', write, controller.removeRelationship);

// Portal da Família — convite (cria/reativa conta) e revogação de acesso
router.post('/:id/portal-invite', write, controller.invitePortal);
router.delete('/:id/portal', write, controller.revokePortal);

module.exports = router;
