'use strict';

const { Op } = require('sequelize');
const AppError = require('../../utils/app-error');
const { Role, User } = require('../../models');
const { MODULES, VALID_ROLES, DEFAULTS, CATALOG_INDEX } = require('./permissions.catalog');

/* ============================================================================
 * PERFIS DE PERMISSÃO (RBAC customizável) — tenant-scoped.
 *
 * Segurança: o `baseRole` é o TETO. As permissões de um perfil são sempre
 * CLAMPADAS (interseccionadas) ao mapa padrão do baseRole (ver sanitize) — assim
 * um perfil jamais concede algo que o baseRole não permitiria; e como o
 * `user.role` recebe o baseRole, o authorize das rotas continua sendo a barreira
 * externa. Perfis granulares só refinam para dentro.
 * ==========================================================================*/

// Rótulos dos 3 perfis de sistema (semeados on-the-fly por cidade).
const SYSTEM_ROLES = [
  { name: 'Administrador', baseRole: 'admin', description: 'Acesso total à cidade — usuários, auditoria e configurações.' },
  { name: 'Operador', baseRole: 'operador', description: 'Operação do dia a dia, sem gestão de usuários, configurações e auditoria.' },
  { name: 'Consulta', baseRole: 'consulta', description: 'Somente leitura em cadastros, mapa e relatórios.' },
];

// Sanitiza SÓ contra o catálogo: o cliente marca livremente qualquer permissão,
// sem teto herdado. Só descartamos módulos/ações que não existem.
function sanitizePermissions(requested = {}) {
  const out = {};
  if (!requested || typeof requested !== 'object') return out;
  for (const [mod, actions] of Object.entries(requested)) {
    if (!CATALOG_INDEX[mod] || !Array.isArray(actions)) continue;
    const kept = actions.filter((a) => CATALOG_INDEX[mod].has(a));
    if (kept.length) out[mod] = kept;
  }
  return out;
}

// DERIVA o baseRole (string do authorize) a partir das permissões marcadas.
// É o "piso de segurança": o menor papel fixo que comporta o que o perfil
// concede, para o authorize das rotas não barrar o que o cliente permitiu.
//  - admin: mexe em usuários/auditoria/importação em produção, ou exclui/bloqueia
//    cadastro (ações que o authorize já reserva ao admin);
//  - operador: qualquer ação de ESCRITA;
//  - consulta: só leitura.
function deriveBaseRole(perms = {}) {
  const has = (mod, act) => Array.isArray(perms[mod]) && perms[mod].includes(act);
  const anyOf = (mod, acts) => acts.some((a) => has(mod, a));
  const precisaAdmin =
    (perms.usuarios && perms.usuarios.length) ||
    has('auditoria', 'ver') ||
    has('importacoes', 'confirmar') ||
    has('cadastros', 'excluir') ||
    has('cadastros', 'bloquear');
  if (precisaAdmin) return 'admin';
  const escreve =
    anyOf('cadastros', ['criar', 'editar']) ||
    anyOf('sepultados', ['registrar', 'autorizar']) ||
    anyOf('financeiro', ['gerar', 'baixar', 'cancelar']) ||
    anyOf('documentos', ['emitir', 'cancelar']) ||
    anyOf('mapa', ['editar']) ||
    anyOf('relatorios', ['exportar']) ||
    anyOf('importacoes', ['enviar']);
  return escreve ? 'operador' : 'consulta';
}

function serialize(role) {
  if (!role) return null;
  const r = typeof role.toJSON === 'function' ? role.toJSON() : role;
  return {
    id: r.id,
    name: r.name,
    baseRole: r.baseRole,
    permissions: r.permissions || {},
    isSystem: Boolean(r.isSystem),
    description: r.description || null,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

// Semeia (idempotente) os 3 perfis de sistema da cidade se ainda não existirem.
// Resolução ON-THE-FLY: chamada no list — nenhuma cidade precisa de seed prévio.
async function ensureSystemRoles(tenantId) {
  for (const def of SYSTEM_ROLES) {
    const [role, created] = await Role.findOrCreate({
      where: { tenantId, baseRole: def.baseRole, isSystem: true },
      defaults: {
        tenantId,
        name: def.name,
        baseRole: def.baseRole,
        permissions: DEFAULTS[def.baseRole],
        isSystem: true,
        description: def.description,
      },
    });
    // Mantém o mapa padrão do perfil de sistema sempre atualizado com o catálogo
    // (sem depender de nova migração quando ampliamos módulos/ações).
    if (!created) {
      await role.update({ permissions: DEFAULTS[def.baseRole] }, { hooks: false });
    }
  }
}

async function list(tenantId) {
  await ensureSystemRoles(tenantId);
  const rows = await Role.findAll({
    where: { tenantId },
    // Sistema primeiro (admin→operador→consulta), depois customizados por nome.
    order: [['isSystem', 'DESC'], ['name', 'ASC']],
  });
  return rows.map(serialize);
}

async function getById(tenantId, id) {
  const role = await Role.findOne({ where: { id, tenantId } });
  if (!role) throw AppError.notFound('Perfil não encontrado.');
  return role;
}

async function create(tenantId, data = {}) {
  const name = String(data.name || '').trim();
  if (!name) throw AppError.badRequest('Informe o nome do perfil.', 'MISSING_NAME');
  // Nome único por cidade (case-insensitive) — evita perfis duplicados.
  const clash = await Role.findOne({
    where: { tenantId, name: { [Op.iLike]: name } },
  });
  if (clash) throw AppError.conflict('Já existe um perfil com este nome.', 'ROLE_NAME_IN_USE');

  const permissions = sanitizePermissions(data.permissions);
  const role = await Role.create({
    tenantId,
    name,
    baseRole: deriveBaseRole(permissions), // derivado das permissões marcadas
    permissions,
    isSystem: false, // criado pelo cliente nunca é de sistema
    description: data.description ? String(data.description).trim().slice(0, 255) : null,
  });
  return serialize(role);
}

async function update(tenantId, id, data = {}) {
  const role = await getById(tenantId, id);
  // Perfis de SISTEMA são canônicos (refletem os 3 papéis fixos) — não editáveis.
  // Assim a base do authorize nunca é adulterada por engano.
  if (role.isSystem) {
    throw AppError.forbidden('Perfis padrão do sistema não podem ser editados.', 'SYSTEM_ROLE_READONLY');
  }

  const patch = {};
  if (data.name !== undefined) {
    const name = String(data.name || '').trim();
    if (!name) throw AppError.badRequest('Informe o nome do perfil.', 'MISSING_NAME');
    if (name.toLowerCase() !== role.name.toLowerCase()) {
      const clash = await Role.findOne({
        where: { tenantId, name: { [Op.iLike]: name }, id: { [Op.ne]: role.id } },
      });
      if (clash) throw AppError.conflict('Já existe um perfil com este nome.', 'ROLE_NAME_IN_USE');
    }
    patch.name = name;
  }
  // As permissões são livres; o baseRole é sempre DERIVADO delas (não escolhido).
  if (data.permissions !== undefined) {
    patch.permissions = sanitizePermissions(data.permissions);
    patch.baseRole = deriveBaseRole(patch.permissions);
  }
  if (data.description !== undefined) {
    patch.description = data.description ? String(data.description).trim().slice(0, 255) : null;
  }

  await role.update(patch);
  return serialize(role);
}

async function remove(tenantId, id) {
  const role = await getById(tenantId, id);
  if (role.isSystem) {
    throw AppError.forbidden('Perfis padrão do sistema não podem ser excluídos.', 'SYSTEM_ROLE_READONLY');
  }
  // Não deixa apagar um perfil EM USO — usuários ficariam sem refinamento e a
  // exclusão poderia surpreender o admin. Ele deve migrar os usuários antes.
  const inUse = await User.count({ where: { tenantId, roleId: role.id } });
  if (inUse > 0) {
    throw AppError.conflict(
      `Este perfil está atribuído a ${inUse} usuário(s). Altere o perfil deles antes de excluir.`,
      'ROLE_IN_USE'
    );
  }
  await role.destroy();
}

// Resolve um perfil do tenant garantindo escopo — usado pelo users.service ao
// vincular um usuário a um perfil. Retorna o Role (com baseRole) ou lança.
async function resolveForUser(tenantId, roleId) {
  const role = await Role.findOne({ where: { id: roleId, tenantId } });
  if (!role) throw AppError.badRequest('Perfil inválido para esta cidade.', 'INVALID_ROLE_ID');
  return role;
}

module.exports = {
  MODULES,
  list,
  getById,
  create,
  update,
  remove,
  ensureSystemRoles,
  resolveForUser,
  serialize,
  sanitizePermissions,
};
