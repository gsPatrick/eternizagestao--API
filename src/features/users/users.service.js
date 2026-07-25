'use strict';

const crypto = require('crypto');
const AppError = require('../../utils/app-error');
const { hashPassword, generateTempPassword } = require('../../utils/password');
const { getPagination, buildPageMeta } = require('../../utils/pagination');
const { panelLoginUrl } = require('../../utils/tenant-url');
const { User, Tenant, Notification, Role } = require('../../models');
const notifications = require('../notifications/notifications.service');
const roles = require('../roles/roles.service');

const TENANT_ROLES = ['admin', 'operador', 'consulta'];

// Perfil customizado (opcional) incluído na listagem/detalhe para o front exibir
// o nome do perfil e as permissões efetivas. NUNCA vaza passwordHash (defaultScope).
const ROLE_INCLUDE = [
  { model: Role, as: 'customRole', attributes: ['id', 'name', 'baseRole', 'permissions', 'isSystem'] },
];

/**
 * Resolve o vínculo de PERFIL de um usuário a partir do input.
 *
 * PORQUÊ (segurança): quando um `roleId` é informado, gravamos em `user.role` o
 * `baseRole` do perfil — nunca um valor arbitrário. Assim o teto de acesso do
 * usuário é sempre um dos 3 papéis fixos que o authorize das rotas conhece, e o
 * perfil customizado só refina para dentro. `roleId: null` desvincula (volta ao
 * papel fixo puro). Ausente = não mexe.
 *
 * @returns {object} patch parcial { role?, roleId? } a aplicar no create/update
 */
async function resolveRoleAssignment(tenantId, data = {}, { isCreate = false } = {}) {
  if (data.roleId === undefined) {
    // Sem roleId no payload → usa/valida a string `role` (comportamento atual).
    if (isCreate) {
      const role = data.role || 'operador';
      if (!TENANT_ROLES.includes(role)) {
        throw AppError.badRequest(`Perfil inválido. Permitidos: ${TENANT_ROLES.join(', ')}`, 'INVALID_ROLE');
      }
      return { role, roleId: null };
    }
    if (data.role !== undefined) {
      if (!TENANT_ROLES.includes(data.role)) {
        throw AppError.badRequest(`Perfil inválido. Permitidos: ${TENANT_ROLES.join(', ')}`, 'INVALID_ROLE');
      }
      return { role: data.role };
    }
    return {};
  }
  if (data.roleId === null) {
    // Desvincula do perfil customizado; mantém/valida a string `role` se veio.
    const role = data.role || (isCreate ? 'operador' : undefined);
    if (role !== undefined && !TENANT_ROLES.includes(role)) {
      throw AppError.badRequest(`Perfil inválido. Permitidos: ${TENANT_ROLES.join(', ')}`, 'INVALID_ROLE');
    }
    return role !== undefined ? { role, roleId: null } : { roleId: null };
  }
  // roleId informado → o baseRole do perfil vira o teto (user.role).
  const role = await roles.resolveForUser(tenantId, data.roleId);
  return { role: role.baseRole, roleId: role.id };
}
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
    include: ROLE_INCLUDE,
    distinct: true, // count correto com include (evita inflar pelo join)
  });
  return { rows, meta: buildPageMeta(count, page, perPage) };
}

async function getById(tenantId, id) {
  const user = await User.findOne({ where: { id, tenantId }, include: ROLE_INCLUDE });
  if (!user) throw AppError.notFound('Usuário não encontrado.');
  return user;
}

async function create(tenantId, data) {
  // Resolve o perfil (fixo ou customizado) — grava sempre um baseRole em `role`.
  const rolePatch = await resolveRoleAssignment(tenantId, data, { isCreate: true });
  const passwordHash = await hashPassword(data.password);
  const user = await User.create({
    tenantId,
    name: data.name,
    email: String(data.email).toLowerCase().trim(),
    phone: data.phone ?? null,
    passwordHash,
    ...rolePatch,
  });
  return getById(tenantId, user.id); // recarrega sem passwordHash (defaultScope)
}

async function update(tenantId, id, data) {
  const user = await getById(tenantId, id);
  const rolePatch = await resolveRoleAssignment(tenantId, data);
  // Aplica só os campos de perfil resolvidos + os demais campos editáveis.
  const { role, roleId, ...rest } = data;
  await user.update({ ...rest, ...rolePatch });
  return getById(tenantId, id); // recarrega com o customRole atualizado
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
  // Resolve o perfil (fixo ou customizado) — grava sempre um baseRole em `role`.
  const { role, roleId } = await resolveRoleAssignment(tenantId, data, { isCreate: true });
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
    tenantId, name: data.name, email, phone: data.phone ?? null, passwordHash, role, roleId,
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

/**
 * (super_admin) DEFINE a senha do ADMINISTRADOR de uma cidade — pelo painel da
 * plataforma, digitando a senha (sem depender de e-mail, que pode não estar
 * configurado na cidade).
 *
 * PORQUÊ desta rota separada: o admin da cidade é um User comum (role 'admin',
 * tenantId = cidade). Reusamos toda a mecânica de senha, mas o super_admin NÃO
 * tem tenant próprio — então este fluxo recebe o `tenantId` alvo EXPLÍCITO (a
 * rota é super_admin-only e NÃO passa pelo tenant-resolver). O escopo por
 * tenantId garante que só mexemos em usuário DAQUELA cidade.
 *
 * Sem `userId`, alveja o admin MAIS ANTIGO da cidade (o 1º admin criado no
 * provisionamento — o "administrador da cidade").
 */
async function setTenantAdminPassword(tenantId, newPassword, { userId } = {}) {
  if (!tenantId) throw AppError.badRequest('Informe a cidade (tenantId).', 'MISSING_TENANT');
  if (!newPassword || String(newPassword).length < 8) {
    throw AppError.badRequest('Senha deve ter no mínimo 8 caracteres.', 'WEAK_PASSWORD');
  }
  let user;
  if (userId) {
    user = await User.findOne({ where: { id: userId, tenantId } });
  } else {
    user = await User.findOne({
      where: { tenantId, role: 'admin' },
      order: [['createdAt', 'ASC']],
    });
  }
  if (!user) {
    throw AppError.notFound('Esta cidade não tem um administrador.', 'ADMIN_NOT_FOUND');
  }
  // Define a senha diretamente e LIMPA mustChangePassword: o super_admin escolheu
  // a senha de propósito (não é temporária de convite) e a entrega ao admin.
  await user.update({ passwordHash: await hashPassword(newPassword), mustChangePassword: false });
  return { id: user.id, name: user.name, email: user.email, tenantId: user.tenantId };
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
  setTenantAdminPassword,
};
