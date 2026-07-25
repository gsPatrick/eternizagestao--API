'use strict';

/**
 * CATÁLOGO DE PERMISSÕES GRANULARES (RBAC customizável) — fonte única da verdade
 * dos RECURSOS × AÇÕES que um perfil pode conceder, e dos MAPAS PADRÃO por
 * baseRole (admin / operador / consulta).
 *
 * ESPELHA a matriz "Permissões por perfil" que o cliente já usa na tela de
 * usuários (front: constante PERMISSION_MODULES em lib/permissions-catalog.js —
 * mesmas chaves de recurso/ação). Assim, criar um perfil (nome + checkboxes)
 * gera uma COLUNA na mesma matriz bonita, com os mesmos rótulos.
 *
 * PORQUÊ deste desenho (segurança em produção):
 *  - O middleware `authorize(...)` das dezenas de rotas continua intocado: ele
 *    compara `req.user.role` (a STRING admin|operador|consulta). Um perfil
 *    customizado SEMPRE herda um `baseRole` gravado em `user.role` — então o TETO
 *    de acesso de qualquer perfil novo é o do seu baseRole, e nenhuma rota fica
 *    mais permissiva do que já era.
 *  - As permissões granulares só REFINAM (restringem) dentro desse teto, via o
 *    middleware opcional `requirePermission(recurso, acao)`. Por isso o mapa de
 *    um perfil é "clampado" (interseccionado) ao teto do baseRole.
 */

// Recursos e ações — IDÊNTICOS (chaves e ordem) à matriz PERMISSIONS original.
// Os `label` são apresentação (espelhados no front); as `key` são o contrato.
const MODULES = [
  {
    key: 'cadastros',
    label: 'Cadastros',
    desc: 'Sepulturas, pessoas, concessões e sepultados',
    actions: [
      { key: 'ver', label: 'Visualizar' },
      { key: 'criar', label: 'Criar' },
      { key: 'editar', label: 'Editar' },
      { key: 'excluir', label: 'Excluir' },
      { key: 'bloquear', label: 'Bloquear jazigo' },
    ],
  },
  {
    key: 'sepultados',
    label: 'Sepultados & exumações',
    desc: 'Registros, agendamentos e autorizações',
    actions: [
      { key: 'ver', label: 'Visualizar' },
      { key: 'registrar', label: 'Registrar / agendar' },
      { key: 'autorizar', label: 'Autorizar exumação' },
    ],
  },
  {
    key: 'financeiro',
    label: 'Financeiro',
    desc: 'Cobranças, baixas e 2ª via',
    actions: [
      { key: 'ver', label: 'Visualizar' },
      { key: 'gerar', label: 'Gerar cobrança' },
      { key: 'baixar', label: 'Registrar pagamento' },
      { key: 'cancelar', label: 'Cancelar / estornar' },
    ],
  },
  {
    key: 'documentos',
    label: 'Documentos',
    desc: 'Certidões, autorizações e recibos',
    actions: [
      { key: 'ver', label: 'Visualizar' },
      { key: 'emitir', label: 'Emitir / 2ª via' },
      { key: 'cancelar', label: 'Cancelar' },
    ],
  },
  {
    key: 'mapa',
    label: 'Mapa',
    desc: 'Ortofoto, camadas e demarcação',
    actions: [
      { key: 'ver', label: 'Visualizar' },
      { key: 'editar', label: 'Demarcar / importar ortofoto' },
    ],
  },
  {
    key: 'relatorios',
    label: 'Relatórios & exportações',
    desc: 'Indicadores e exportação de dados',
    actions: [
      { key: 'ver', label: 'Visualizar relatórios' },
      { key: 'exportar', label: 'Exportar dados' },
    ],
  },
  {
    key: 'importacoes',
    label: 'Importação de legado',
    desc: 'Planilhas e migração histórica',
    actions: [
      { key: 'enviar', label: 'Enviar / validar lote' },
      { key: 'confirmar', label: 'Confirmar em produção' },
    ],
  },
  {
    key: 'auditoria',
    label: 'Auditoria',
    desc: 'Trilha imutável de ações',
    actions: [{ key: 'ver', label: 'Consultar trilha' }],
  },
  {
    key: 'usuarios',
    label: 'Usuários & configurações',
    desc: 'Perfis, convites e parâmetros',
    actions: [{ key: 'gerenciar', label: 'Gerenciar tudo' }],
  },
];

const VALID_ROLES = ['admin', 'operador', 'consulta'];

// Constrói um mapa { recurso: [acoes...] } aplicando um filtro por ação.
function buildMap(filter) {
  const map = {};
  for (const mod of MODULES) {
    const actions = mod.actions.filter((a) => filter(mod.key, a.key)).map((a) => a.key);
    if (actions.length) map[mod.key] = actions;
  }
  return map;
}

// admin: teto TOTAL — todas as ações (coluna "a" da matriz original).
const ADMIN_MAP = buildMap(() => true);

// operador: coluna "o" — opera o dia a dia; SEM excluir/bloquear cadastro, SEM
// confirmar importação em produção, SEM auditoria e SEM gestão de usuários/config.
const OPERADOR_MAP = buildMap((mod, action) => {
  if (mod === 'cadastros' && (action === 'excluir' || action === 'bloquear')) return false;
  if (mod === 'importacoes' && action === 'confirmar') return false;
  if (mod === 'auditoria') return false;
  if (mod === 'usuarios') return false;
  return true;
});

// consulta: coluna "c" — SOMENTE leitura ("ver") dos recursos consultáveis.
const CONSULTA_MAP = buildMap((mod, action) =>
  action === 'ver'
  && ['cadastros', 'sepultados', 'financeiro', 'documentos', 'mapa', 'relatorios'].includes(mod));

// Mapa padrão / TETO de cada baseRole. Também é o teto ao qual as permissões de
// um perfil customizado são clampadas (interseccionadas) — ver roles.service.
const DEFAULTS = {
  admin: ADMIN_MAP,
  operador: OPERADOR_MAP,
  consulta: CONSULTA_MAP,
};

// Conjunto {recurso: Set(acoes)} do catálogo — para validar entradas do cliente.
const CATALOG_INDEX = MODULES.reduce((acc, mod) => {
  acc[mod.key] = new Set(mod.actions.map((a) => a.key));
  return acc;
}, {});

module.exports = { MODULES, VALID_ROLES, DEFAULTS, CATALOG_INDEX };
