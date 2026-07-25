'use strict';

const { Router } = require('express');
const controller = require('./users.controller');
const auth = require('../../middlewares/auth');
const authorize = require('../../middlewares/authorize');
const tenantResolver = require('../../middlewares/tenant-resolver');
// Exemplo do middleware de permissão granular (RBAC customizável). Fica pronto
// e é aplicado abaixo como EXEMPLO — não em todas as rotas — para não arriscar
// a produção. Ele só REFINA quem tem perfil customizado; perfis fixos passam.
const requirePermission = require('../../middlewares/require-permission');

const router = Router();

// ---------------------------------------------------------------------------
// ROTA DE PLATAFORMA (super_admin) — ANTES do tenant-resolver, pois o
// super_admin não tem tenant próprio (o tenantId alvo vem no corpo).
// authorize() sem papéis => somente super_admin passa.
// ---------------------------------------------------------------------------
router.post('/tenant-admin-password', auth, authorize(), controller.setTenantAdminPassword);

// A partir daqui: rotas da CIDADE (isoladas ao tenant do token/header).
router.use(auth, tenantResolver());

router.get('/', authorize('admin', 'operador', 'consulta'), controller.list);
router.get('/:id', authorize('admin', 'operador', 'consulta'), controller.getById);
// EXEMPLO de refino granular (comentado de propósito): com o requirePermission
// ligado, um usuário de perfil customizado só cria/convida se o perfil conceder
// 'usuarios'→'gerenciar'. O authorize('admin') continua sendo o teto externo.
// Para ativar, basta inserir o middleware ANTES do controller, ex.:
//   router.post('/', authorize('admin'), requirePermission('usuarios', 'gerenciar'), controller.create);
router.post('/', authorize('admin'), /* requirePermission('usuarios','gerenciar'), */ controller.create);
router.post('/invite', authorize('admin'), /* requirePermission('usuarios','gerenciar'), */ controller.invite);
router.patch('/:id', authorize('admin'), controller.update);
router.patch('/:id/password', authorize('admin'), controller.changePassword);
router.post('/:id/password-reset', authorize('admin'), controller.passwordReset);
router.post('/:id/resend-invite', authorize('admin'), controller.resendInvite);
router.patch('/:id/activate', authorize('admin'), controller.activate);
router.patch('/:id/deactivate', authorize('admin'), controller.deactivate);
router.delete('/:id', authorize('admin'), controller.remove);

module.exports = router;
