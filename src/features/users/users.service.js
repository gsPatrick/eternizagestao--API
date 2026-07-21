'use strict';

const crypto = require('crypto');
const AppError = require('../../utils/app-error');
const { hashPassword, generateTempPassword } = require('../../utils/password');
const { getPagination, buildPageMeta } = require('../../utils/pagination');
const { panelLoginUrl } = require('../../utils/tenant-url');
const { User, Tenant, Notification } = require('../../models');
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
/**
 * Envia o convite e EXIGE que ele tenha saído.
 *
 * `notifications.notify` nunca rejeita — ele persiste a falha na linha e volta.
 * Isso é certo para disparos em lote, mas errado aqui: o convite carrega a
 * SENHA TEMPORÁRIA. Se o e-mail não saiu, o usuário recém-criado não tem como
 * entrar, e responder 201 faria o operador acreditar que convidou alguém.
 * Então lemos o status persistido e transformamos em erro para quem chamou.
 */
async function sendInviteEmail(tenantId, user, actor = {}, tempPassword = null) {
  const ctaUrl = await panelLoginUrlFor(tenantId);
  const notification = await notifications.notify({
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
      email: user.email,
      senha_temporaria: tempPassword || '',
      cta_url: ctaUrl,
    },
    referenceType: 'user',
    referenceId: user.id,
  });

  // O objeto em memória ainda tem o status da CRIAÇÃO ('pendente'); o status
  // definitivo é gravado pelo dispatch. Por isso relemos sempre antes de julgar.
  if (notification) await notification.reload().catch(() => {});
  if (notification && notification.status === 'falha') {
    throw new AppError(
      notification.errorMessage
        || 'Não foi possível enviar o convite: o e-mail não está configurado.',
      503,
      'EMAIL_NOT_CONFIGURED'
    );
  }
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

// O índice UNIQUE de `email` também enxerga linhas SOFT-DELETED: sem liberar,
// remover um usuário impedia PARA SEMPRE reconvidar o mesmo e-mail. Usamos
// sub-endereçamento (+del-<ts>), que continua um e-mail VÁLIDO para o model.
function freedEmail(email) {
  const stamp = Date.now().toString(36);
  const [local, domain] = String(email).split('@');
  return domain ? `${local}+del-${stamp}@${domain}` : `${email}.del-${stamp}`;
}

async function remove(tenantId, id) {
  const user = await getById(tenantId, id);
  // LIBERA o e-mail antes do soft delete (permite reconvidar a mesma pessoa).
  await user.update({ email: freedEmail(user.email) });
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
  if (existing && !existing.deletedAt) {
    throw AppError.conflict('Já existe um usuário com este e-mail.', 'EMAIL_IN_USE');
  }
  // Sobra de um usuário REMOVIDO (antes do release que libera o e-mail) ainda
  // segurava o endereço no índice unique — libera e segue com o convite.
  if (existing && existing.deletedAt) {
    await existing.update({ email: freedEmail(existing.email) }, { paranoid: false, hooks: false });
  }
  const tempPassword = generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);
  const user = await User.create({
    tenantId, name: data.name, email, phone: data.phone ?? null, passwordHash, role,
    mustChangePassword: true, // troca a senha temporária no 1º acesso
  });
  // Se o convite não sai, o usuário criado é lixo: ninguém conhece a senha
  // temporária e o e-mail fica preso no índice unique, impedindo reconvite.
  // Desfazemos a criação para o operador poder tentar de novo depois de
  // configurar o e-mail — sem sobra e sem "usuário fantasma" na listagem.
  try {
    await sendInviteEmail(tenantId, user, actor, tempPassword);
  } catch (err) {
    // A própria notificação de falha aponta para o usuário (FK), então ela
    // precisa soltar a referência antes — senão o rollback falha em silêncio e
    // sobra o cadastro órfão que estávamos tentando evitar. A linha da
    // notificação PERMANECE: é o registro de que a tentativa existiu.
    try {
      await Notification.update(
        { recipientUserId: null },
        { where: { tenantId, recipientUserId: user.id } }
      );
      await user.destroy({ force: true });
    } catch (cleanupErr) {
      console.error('[users] falha ao desfazer o convite:', cleanupErr.message);
    }
    throw err;
  }
  return getById(tenantId, user.id); // recarrega sem passwordHash
}

// Reenvia o e-mail de convite: redefine a senha temporária (o link sempre dá
// acesso) e reexige a troca no 1º acesso.
async function resendInvite(tenantId, id, actor = {}) {
  const user = await getById(tenantId, id);
  const full = await User.findByPk(user.id);
  const tempPassword = generateTempPassword();
  await full.update({ passwordHash: await hashPassword(tempPassword), mustChangePassword: true });
  await sendInviteEmail(tenantId, full, actor, tempPassword);
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
