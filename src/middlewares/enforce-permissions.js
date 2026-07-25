'use strict';

const AppError = require('../utils/app-error');
const catchAsync = require('../utils/catch-async');
const { Role } = require('../models');

/**
 * ENFORCEMENT central do RBAC por PERFIL.
 *
 * O acesso de um usuário com perfil customizado (roleId) passa a ser 100%
 * definido pelas permissões do perfil — nem mais, nem menos. O cliente pode
 * apagar todos os perfis e criar quantos quiser; este middleware sempre reflete
 * o que o perfil vigente concede.
 *
 * Como decide, para cada requisição:
 *   1. Descobre o MÓDULO do catálogo pela rota (mapa REQUEST_MODULE abaixo).
 *   2. Descobre se é LEITURA (GET/HEAD) ou ESCRITA (POST/PATCH/PUT/DELETE).
 *   3. ESCRITA (POST/PATCH/PUT/DELETE) exige que o perfil tenha ALGUMA ação de
 *      escrita no módulo; sem isso, 403. A granularidade fina entre ações de
 *      escrita (ex.: criar × excluir) continua garantida pelo authorize das
 *      rotas via o baseRole DERIVADO (roles.service.deriveBaseRole).
 *   LEITURA (GET) sempre passa: bloquear visualização por módulo quebraria a
 *      navegação (o painel/dashboard agrega dados de vários módulos). O controle
 *      que importa — quem pode AGIR — é aplicado na escrita.
 *
 * Compatibilidade (não quebra nada):
 *   - super_admin sempre passa (plataforma).
 *   - Usuário SEM roleId mantém o comportamento por `role` string (o admin/
 *     operador/consulta fixos de antes) — a migração para perfis é opcional.
 *   - Rota que não casa nenhum módulo PASSA (fail-open para o que não mapeamos:
 *     dashboards, anexos, timeline, etc. — leitura de apoio nunca é bloqueada).
 */

// path relativo a /v1 → módulo do catálogo. Ordem: o primeiro match vence.
const REQUEST_MODULE = [
  [/^\/(graves|people|concessions|cemeteries|blocks|streets|lots|grave-statuses|cartorios|funerarias|institutions)(\/|$)/, 'cadastros'],
  [/^\/(deceased|burials|exhumations|schedules|chapels|grave-maintenances)(\/|$)/, 'sepultados'],
  [/^\/(fee-types|maintenance-fees|billings|payments|delinquency)(\/|$)/, 'financeiro'],
  [/^\/(documents|document-templates)(\/|$)/, 'documentos'],
  [/signatures/, 'documentos'],
  [/^\/(orthophotos|map|niches|ossuaries)(\/|$)/, 'mapa'],
  [/geometry|delete-impact|photo/, null], // sub-ações de recursos já cobertos: não re-mapeia
  [/^\/(reports|dashboard|data-exports)(\/|$)/, 'relatorios'],
  [/^\/imports(\/|$)/, 'importacoes'],
  [/^\/audit-logs(\/|$)/, 'auditoria'],
  [/^\/(users|roles)(\/|$)/, 'usuarios'],
  [/^\/tenant(\/|$)|^\/notifications(\/|$)/, 'usuarios'],
];

function moduleForPath(path) {
  for (const [re, mod] of REQUEST_MODULE) {
    if (re.test(path)) return mod; // pode ser null (rota reconhecida como "não enforçar")
  }
  return undefined; // não mapeada → passa
}

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function permite(rolePermissions, moduleKey) {
  const acoes = (rolePermissions && rolePermissions[moduleKey]) || [];
  if (!Array.isArray(acoes) || acoes.length === 0) return false; // módulo sem escrita
  return acoes.some((a) => a !== 'ver'); // tem ao menos uma ação de escrita
}

module.exports = catchAsync(async (req, res, next) => {
  const user = req.user;
  if (!user) return next(); // sem auth resolvido aqui → o auth do router decide

  // Plataforma e usuários sem perfil customizado seguem o comportamento atual.
  if (user.role === 'super_admin') return next();
  if (!user.roleId) return next();

  const mod = moduleForPath(req.path);
  if (mod === undefined || mod === null) return next(); // rota não enforçada

  const role = await Role.findByPk(user.roleId);
  if (!role) return next(); // perfil apagado → cai no teto do authorize (fail-open)

  // Leitura sempre passa (ver comentário no cabeçalho); só a escrita é enforçada.
  if (READ_METHODS.has(req.method)) return next();
  if (permite(role.permissions, mod)) return next();

  return next(
    AppError.forbidden(
      `Seu perfil (${role.name}) não permite alterar "${mod}".`,
      'INSUFFICIENT_PERMISSION'
    )
  );
});
