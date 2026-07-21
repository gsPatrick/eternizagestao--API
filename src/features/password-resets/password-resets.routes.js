'use strict';

// Recuperação de senha — rotas PÚBLICAS (quem esqueceu a senha não tem sessão).
// Montar em /v1/password-resets, ANTES dos routers autenticados.
const { Router } = require('express');
const controller = require('./password-resets.controller');
const tenantResolver = require('../../middlewares/tenant-resolver');
const rateLimit = require('../../middlewares/rate-limit');

const router = Router();

// Tenant OPCIONAL: pelo subdomínio da cidade o alvo é filtrado por tenant;
// no domínio raiz (super_admin) não há tenant e a busca é global.
router.use(tenantResolver({ required: false }));

// Pedir código é caro (gera e envia e-mail) — limite curto por IP.
const requestLimiter = rateLimit({ windowMs: 60_000, max: 5, keyPrefix: 'pwd-reset-request' });
// Verificar/confirmar é a superfície de adivinhação do código: o limite por IP
// complementa o teto de 5 tentativas POR CÓDIGO (que é por conta, não por IP).
const checkLimiter = rateLimit({ windowMs: 60_000, max: 10, keyPrefix: 'pwd-reset-check' });

router.post('/', requestLimiter, controller.request);
router.post('/verify', checkLimiter, controller.verify);
router.post('/confirm', checkLimiter, controller.confirm);

module.exports = router;
