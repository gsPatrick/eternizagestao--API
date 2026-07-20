'use strict';

const crypto = require('crypto');
const AppError = require('../../utils/app-error');
const { hashPassword } = require('../../utils/password');
const { getPagination, buildPageMeta } = require('../../utils/pagination');
const { panelLoginUrl } = require('../../utils/tenant-url');
const { User, Tenant } = require('../../models');
const notifications = require('../notifications/notifications.service');

const TENANT_ROLES = ['admin', 'operador', 'consulta'];
const ROLE_LABELS = { admin: 'Administrador', operador: 'Operador', consulta: 'Consulta' };

// Link do PAINEL da cidade para convite/redefinição — deriva do SUBDOMÍNIO do
// tenant (branded); sem tenant/subdomínio cai no env global (fallback). Carrega
// só o subdomínio (query enxuta); nunca derruba o envio se o tenant sumir.
async function panelLoginUrlFor(tenantId) {
  let tenant = null;
  try {
    tenant = await Tenant.findByPk(tenantId, { attributes: ['id', 'subdomain'] });
  } catch (_err) {
    tenant = null;
  }
  return panelLoginUrl(tenant); // tenant null → fallback env global
}

// Enfileira (via camada de filas) o e-mail transacional de convite ao usuário.
async function sendInviteEmail(tenantId, user, actor = {}) {
  const ctaUrl = await panelLoginUrlFor(tenantId);
  await notifications.notify({
    tenantId,
    recipientUserId: user.id,
    contact: user.email,
    channel: 'email',
    notificationType: 'avulsa',
    subject: 'Convite de acesso ao Eterniza Gestão',
    message: `Convite enviado para ${user.email}.`,
    template: 'user-invite',
    vars: {
      nome: user.name,
      perfil: ROLE_LABELS[user.role] || user.role,
      convidado_por: actor.name || 'a administração',
      cta_url: ctaUrl,
    },
    referenceType: 'user',
    referenceId: user.id,
  });
}

async function list(tenantId, query) {
  const { page, perPage, limit, offset } = getPagination(query);
  const where = { tenantId };
  if (query.role) where.role = query.role;
  const { rows, count } = await User.findAndCountAll({
    where,
    limit,
    offset,
    order: [['name', 'ASC']],
  });
  return { rows, meta: buildPageMeta(count, page, perPage) };
}

async function getById(tenantId, id) {
  const user = await User.findOne({ where: { id, tenantId } });
  if (!user) throw AppError.notFound('Usuário não encontrado.');
  return user;
}

async function create(tenantId, data) {
  if (!TENANT_ROLES.includes(data.role || 'operador')) {
    throw AppError.badRequest(`Perfil inválido. Permitidos: ${TENANT_ROLES.join(', ')}`, 'INVALID_ROLE');
  }
  const passwordHash = await hashPassword(data.password);
  const user = await User.create({
    tenantId,
    name: data.name,
    email: String(data.email).toLowerCase().trim(),
    phone: data.phone ?? null,
    passwordHash,
    role: data.role || 'operador',
  });
  return getById(tenantId, user.id); // recarrega sem passwordHash (defaultScope)
}

async function update(tenantId, id, data) {
  const user = await getById(tenantId, id);
  if (data.role && !TENANT_ROLES.includes(data.role)) {
    throw AppError.badRequest(`Perfil inválido. Permitidos: ${TENANT_ROLES.join(', ')}`, 'INVALID_ROLE');
  }
  return user.update(data);
}

async function changePassword(tenantId, id, newPassword) {
  if (!newPassword || String(newPassword).length < 8) {
    throw AppError.badRequest('Senha deve ter no mínimo 8 caracteres.', 'WEAK_PASSWORD');
  }
  const user = await getById(tenantId, id);
  await user.update({ passwordHash: await hashPassword(newPassword) });
}

async function setActive(tenantId, id, active) {
  const user = await getById(tenantId, id);
  return user.update({ active: Boolean(active) });
}

async function remove(tenantId, id) {
  const user = await getById(tenantId, id);
  await user.destroy(); // soft delete
}

/**
 * Convida um usuário: cria a conta com senha temporária aleatória (o convidado
 * define a própria senha pelo link do e-mail) e ENFILEIRA o e-mail de convite.
 * O usuário nasce ativo mas sem lastLoginAt → o front o exibe como "pendente"
 * até o primeiro acesso.
 */
async function invite(tenantId, data, actor = {}) {
  const role = data.role || 'operador';
  if (!TENANT_ROLES.includes(role)) {
    throw AppError.badRequest(`Perfil inválido. Permitidos: ${TENANT_ROLES.join(', ')}`, 'INVALID_ROLE');
  }
  const email = String(data.email).toLowerCase().trim();
  const existing = await User.findOne({ where: { email, tenantId }, paranoid: false });
  if (existing) {
    throw AppError.conflict('Já existe um usuário com este e-mail.', 'EMAIL_IN_USE');
  }
  const tempPassword = crypto.randomBytes(24).toString('hex');
  const passwordHash = await hashPassword(tempPassword);
  const user = await User.create({ tenantId, name: data.name, email, phone: data.phone ?? null, passwordHash, role });
  await sendInviteEmail(tenantId, user, actor);
  return getById(tenantId, user.id); // recarrega sem passwordHash
}

// Reenvia o e-mail de convite a um usuário já existente.
async function resendInvite(tenantId, id, actor = {}) {
  const user = await getById(tenantId, id);
  await sendInviteEmail(tenantId, user, actor);
  return user;
}

// Enfileira o e-mail de redefinição de senha (link enviado ao usuário).
async function sendPasswordReset(tenantId, id) {
  const user = await getById(tenantId, id);
  const ctaUrl = await panelLoginUrlFor(tenantId);
  await notifications.notify({
    tenantId,
    recipientUserId: user.id,
    contact: user.email,
    channel: 'email',
    notificationType: 'avulsa',
    subject: 'Redefinição de senha · Eterniza Gestão',
    message: `Link de redefinição de senha enviado para ${user.email}.`,
    template: 'password-reset',
    vars: { nome: user.name, cta_url: ctaUrl },
    referenceType: 'user',
    referenceId: user.id,
  });
  return user;
}

module.exports = {
  list,
  getById,
  create,
  update,
  changePassword,
  setActive,
  remove,
  invite,
  resendInvite,
  sendPasswordReset,
};
