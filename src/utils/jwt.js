'use strict';

const jwt = require('jsonwebtoken');
const AppError = require('./app-error');

const SECRET = process.env.JWT_SECRET || 'dev-secret-trocar-em-producao';
if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  // decisão de segurança: nunca subir produção com secret default
  throw new Error('JWT_SECRET é obrigatório em produção.');
}

/**
 * kind diferencia o público do token:
 *  - 'user'    => usuário administrativo (middleware auth)
 *  - 'portal'  => conta do Portal da Família (middleware portal-auth)
 *  - 'refresh' => token de renovação
 */

function signAccessToken(payload, kind = 'user') {
  return jwt.sign({ ...payload, kind }, SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '1d',
  });
}

function signRefreshToken(payload, kind = 'refresh') {
  return jwt.sign({ ...payload, kind }, SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, SECRET);
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      throw AppError.unauthorized('Token expirado.', 'TOKEN_EXPIRED');
    }
    throw AppError.unauthorized('Token inválido.', 'INVALID_TOKEN');
  }
}

module.exports = { signAccessToken, signRefreshToken, verifyToken };
