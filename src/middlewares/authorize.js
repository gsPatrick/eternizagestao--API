'use strict';

const AppError = require('../utils/app-error');

/**
 * RBAC por perfil. Uso: router.post('/', auth, authorize('admin'), handler)
 * super_admin sempre passa (perfil de plataforma).
 */
module.exports = (...allowedRoles) => (req, res, next) => {
  if (!req.user) {
    return next(AppError.unauthorized());
  }
  if (req.user.role === 'super_admin' || allowedRoles.includes(req.user.role)) {
    return next();
  }
  return next(
    AppError.forbidden(
      `Perfil '${req.user.role}' não tem permissão para esta ação.`,
      'INSUFFICIENT_ROLE'
    )
  );
};
