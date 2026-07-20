'use strict';

const AppError = require('../utils/app-error');
const catchAsync = require('../utils/catch-async');
const { verifyToken } = require('../utils/jwt');
const { setActor } = require('./request-context');
const { FamilyPortalAccount, Person } = require('../models');

// Autenticação do Portal da Família (público-alvo: proprietários/familiares).
// Popula req.portalAccount e req.portalPerson. NÃO dá acesso às rotas administrativas.
module.exports = catchAsync(async (req, res, next) => {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    throw AppError.unauthorized('Token de acesso não informado.', 'MISSING_TOKEN');
  }

  const payload = verifyToken(token);
  if (payload.kind !== 'portal') {
    throw AppError.unauthorized('Token não é do Portal da Família.', 'WRONG_TOKEN_KIND');
  }

  const account = await FamilyPortalAccount.findByPk(payload.sub, {
    include: [{ model: Person, as: 'person' }],
  });
  if (!account || account.status !== 'ativo') {
    throw AppError.unauthorized('Conta do portal inexistente ou bloqueada.', 'PORTAL_ACCOUNT_INACTIVE');
  }

  req.portalAccount = account;
  req.portalPerson = account.person;

  // Registra o ATOR do Portal da Família no contexto ALS para a auditoria.
  setActor({
    portalAccountId: account.id,
    tenantId: account.tenantId || null,
    ipAddress: req.ip,
    userAgent: (req.headers['user-agent'] || '').slice(0, 255),
  });

  return next();
});
