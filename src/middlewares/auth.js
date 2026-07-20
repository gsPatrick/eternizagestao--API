'use strict';

const AppError = require('../utils/app-error');
const catchAsync = require('../utils/catch-async');
const { verifyToken } = require('../utils/jwt');
const { setActor } = require('./request-context');
const { User } = require('../models');

// Autentica usuário administrativo via Bearer token. Popula req.user e req.auth.
module.exports = catchAsync(async (req, res, next) => {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    throw AppError.unauthorized('Token de acesso não informado.', 'MISSING_TOKEN');
  }

  const payload = verifyToken(token);
  if (payload.kind !== 'user') {
    throw AppError.unauthorized('Token não é de usuário administrativo.', 'WRONG_TOKEN_KIND');
  }

  const user = await User.findByPk(payload.sub);
  if (!user || !user.active) {
    throw AppError.unauthorized('Usuário inexistente ou inativo.', 'USER_INACTIVE');
  }

  req.user = user;
  req.auth = payload;

  // Registra o ATOR administrativo no contexto ALS para o motor de auditoria.
  setActor({
    userId: user.id,
    tenantId: user.tenantId || null,
    ipAddress: req.ip,
    userAgent: (req.headers['user-agent'] || '').slice(0, 255),
  });

  return next();
});
