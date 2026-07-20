'use strict';

const AppError = require('../../utils/app-error');
const { comparePassword } = require('../../utils/password');
const { signAccessToken, signRefreshToken, verifyToken } = require('../../utils/jwt');
const { User, Tenant } = require('../../models');
const audit = require('../audit-logs/audit.service');
const storage = require('../../providers/storage');

// Logo local (/files/...) → URL assinada (branding, TTL longo); http externa passa direto.
function signTenantLogo(tenant) {
  if (!tenant) return tenant;
  const t = typeof tenant.toJSON === 'function' ? tenant.toJSON() : { ...tenant };
  if (t.logoUrl) t.logoUrl = storage.signedUrl(t.logoUrl, { ttlSeconds: 604800 });
  return t;
}

function serializeUser(user) {
  return {
    id: user.id,
    tenantId: user.tenantId,
    name: user.name,
    email: user.email,
    role: user.role,
    lastLoginAt: user.lastLoginAt,
  };
}

function buildTokens(user) {
  const payload = { sub: user.id, tenantId: user.tenantId, role: user.role };
  return {
    accessToken: signAccessToken(payload, 'user'),
    refreshToken: signRefreshToken({ sub: user.id }, 'refresh'),
  };
}

/**
 * Login administrativo. Se o request veio de um subdomínio de tenant, procura
 * usuário do tenant; senão tenta usuário de plataforma (super_admin, tenant NULL).
 */
async function login({ email, password, tenant }) {
  const candidates = await User.scope('withPassword').findAll({
    where: { email, active: true },
  });

  // prioriza usuário do tenant resolvido; sem tenant → super_admin (plataforma)
  // ou, se o e-mail for único, o admin da cidade dono desse e-mail (token
  // carrega o tenantId dele). E-mail ambíguo sem tenant → null (INVALID_CREDENTIALS).
  const user =
    (tenant && candidates.find((u) => u.tenantId === tenant.id)) || // subdomínio/header
    candidates.find((u) => u.tenantId === null) || // super_admin
    (candidates.length === 1 ? candidates[0] : null); // admin de cidade único por e-mail

  if (!user || !(await comparePassword(password, user.passwordHash))) {
    throw AppError.unauthorized('E-mail ou senha inválidos.', 'INVALID_CREDENTIALS');
  }

  // skipAudit: escrita de rotina do login (lastLoginAt) não deve virar
  // 'atualizacao' no hook global — o evento semântico é o 'login' abaixo.
  await user.update({ lastLoginAt: new Date() }, { skipAudit: true });

  audit.record({
    action: 'login',
    entityType: 'Usuário',
    entityId: user.id,
    description: `Login de ${user.name}`,
  });

  return { user: serializeUser(user), ...buildTokens(user) };
}

async function refresh({ refreshToken }) {
  const payload = verifyToken(refreshToken);
  if (payload.kind !== 'refresh') {
    throw AppError.unauthorized('Token de refresh inválido.', 'INVALID_REFRESH_TOKEN');
  }
  const user = await User.findByPk(payload.sub);
  if (!user || !user.active) {
    throw AppError.unauthorized('Usuário inexistente ou inativo.', 'USER_INACTIVE');
  }
  return { user: serializeUser(user), ...buildTokens(user) };
}

async function me(userId) {
  const user = await User.findByPk(userId, {
    include: [{ model: Tenant, as: 'tenant', attributes: ['id', 'name', 'subdomain', 'logoUrl', 'primaryColor', 'secondaryColor'] }],
  });
  if (!user) throw AppError.notFound('Usuário não encontrado.');
  return { ...serializeUser(user), tenant: signTenantLogo(user.tenant) };
}

module.exports = { login, refresh, me };
