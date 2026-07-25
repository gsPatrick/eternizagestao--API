'use strict';

const AppError = require('../utils/app-error');
const catchAsync = require('../utils/catch-async');
const { Role } = require('../models');

/**
 * PERMISSÃO GRANULAR (opcional) — REFINA o acesso DENTRO do teto já garantido
 * pelo `authorize(...)`. Uso: router.post('/', auth, authorize('admin','operador'),
 *                                    requirePermission('sepulturas','criar'), handler)
 *
 * Contrato de compatibilidade (NÃO quebra produção):
 *  - super_admin sempre passa (perfil de plataforma).
 *  - Usuário SEM `roleId` (perfil fixo pela string `role`) passa — comportamento
 *    atual preservado. O refinamento só existe para quem tem perfil customizado.
 *  - Usuário COM `roleId`: só passa se o perfil conceder a ação no módulo.
 *
 * SEMPRE usar DEPOIS do authorize da rota: o authorize é a barreira externa
 * (teto por baseRole); este middleware apenas restringe para dentro. Assim,
 * mesmo que um perfil customizado tivesse um mapa mais amplo por engano, a rota
 * nunca fica mais permissiva do que o authorize já permitia.
 */
module.exports = (moduleKey, action) =>
  catchAsync(async (req, res, next) => {
    const user = req.user;
    if (!user) return next(AppError.unauthorized());

    // Plataforma e perfis fixos (sem roleId) mantêm o comportamento de hoje.
    if (user.role === 'super_admin') return next();
    if (!user.roleId) return next();

    const role = await Role.findByPk(user.roleId);
    // Perfil sumiu (apagado) → cai no comportamento base (fail-open para o teto
    // já garantido pelo authorize; o refinamento simplesmente deixa de valer).
    if (!role) return next();

    const perms = (role.permissions && role.permissions[moduleKey]) || [];
    if (Array.isArray(perms) && perms.includes(action)) return next();

    return next(
      AppError.forbidden(
        `Seu perfil não permite '${action}' em '${moduleKey}'.`,
        'INSUFFICIENT_PERMISSION'
      )
    );
  });
