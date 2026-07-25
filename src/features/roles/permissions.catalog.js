'use strict';

/**
 * CATÁLOGO DE PERMISSÕES GRANULARES (RBAC customizável) — fonte única da verdade
 * dos MÓDULOS × AÇÕES que um perfil pode conceder, e dos MAPAS PADRÃO por
 * baseRole (admin / operador / consulta).
 *
 * PORQUÊ deste desenho (segurança em produção):
 *  - O middleware `authorize(...)` das dezenas de rotas continua intocado: ele
 *    compara `req.user.role` (a STRING admin|operador|consulta) com os papéis
 *    permitidos. Um perfil customizado SEMPRE herda um `baseRole` que é gravado
 *    em `user.role` — então o TETO de acesso de qualquer perfil novo é o do seu
 *    baseRole, e nenhuma rota fica mais permissiva do que já era.
 *  - As permissões granulares abaixo só REFINAM (restringem) dentro desse teto,
 *    via o middleware opcional `requirePermission(modulo, acao)`. Por isso o
 *    mapa de um perfil é "clampado" (interseccionado) ao teto do baseRole: não
 *    faz sentido (nem teria efeito) conceder "criar" a um perfil de base
 *    "consulta", já que o authorize das rotas de escrita barra consulta antes.
 */

// Módulos e ações exibidos na tela de perfis. As chaves são estáveis (contrato
// com o front e com requirePermission); os rótulos são só apresentação.
const MODULES = [
  {
    key: 'sepulturas',
    label: 'Sepulturas & lotes',
    desc: 'Cadastro de sepulturas, quadras e lotes',
    actions: [
      { key: 'ver', label: 'Visualizar' },
      { key: 'criar', label: 'Criar' },
      { key: 'editar', label: 'Editar' },
      { key: 'excluir', label: 'Excluir' },
    ],
  },
  {
    key: 'pessoas',
    label: 'Pessoas, proprietários & responsáveis',
    desc: 'Cadastro de pessoas e vínculos',
    actions: [
      { key: 'ver', label: 'Visualizar' },
      { key: 'criar', label: 'Criar' },
      { key: 'editar', label: 'Editar' },
      { key: 'excluir', label: 'Excluir' },
    ],
  },
  {
    key: 'concessoes',
    label: 'Concessões',
    desc: 'Concessões e transferências',
    actions: [
      { key: 'ver', label: 'Visualizar' },
      { key: 'criar', label: 'Criar' },
      { key: 'editar', label: 'Editar' },
    ],
  },
  {
    key: 'sepultados',
    label: 'Sepultados & sepultamentos',
    desc: 'Registros de óbito, sepultamentos e agendamentos',
    actions: [
      { key: 'ver', label: 'Visualizar' },
      { key: 'registrar', label: 'Registrar / agendar' },
    ],
  },
  {
    key: 'exumacoes',
    label: 'Exumações',
    desc: 'Exumações e depósito de restos',
    actions: [
      { key: 'ver', label: 'Visualizar' },
      { key: 'registrar', label: 'Registrar' },
      { key: 'autorizar', label: 'Autorizar' },
    ],
  },
  {
    key: 'cobrancas',
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
      { key: 'ver', label: 'Visualizar' },
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
    label: 'Usuários & perfis',
    desc: 'Convites, perfis e permissões',
    actions: [
      { key: 'ver', label: 'Visualizar' },
      { key: 'gerenciar', label: 'Gerenciar' },
    ],
  },
  {
    key: 'configuracoes',
    label: 'Configurações da cidade',
    desc: 'Identidade, órgão gestor e integrações',
    actions: [
      { key: 'ver', label: 'Visualizar' },
      { key: 'gerenciar', label: 'Gerenciar' },
    ],
  },
];

const VALID_ROLES = ['admin', 'operador', 'consulta'];

// Constrói um mapa { modulo: [acoes...] } aplicando um filtro por ação.
function buildMap(filter) {
  const map = {};
  for (const mod of MODULES) {
    const actions = mod.actions.filter((a) => filter(mod.key, a.key)).map((a) => a.key);
    if (actions.length) map[mod.key] = actions;
  }
  return map;
}

// admin: teto TOTAL — todas as ações de todos os módulos.
const ADMIN_MAP = buildMap(() => true);

// operador: opera o dia a dia; SEM gestão de usuários/configurações, SEM
// auditoria, SEM excluir cadastros e SEM confirmar importação em produção.
const OPERADOR_MAP = buildMap((mod, action) => {
  if (['usuarios', 'configuracoes', 'auditoria'].includes(mod)) return false;
  if (action === 'excluir') return false;
  if (mod === 'importacoes' && action === 'confirmar') return false;
  return true;
});

// consulta: SOMENTE leitura — apenas a ação "ver" dos módulos consultáveis.
const CONSULTA_MAP = buildMap((mod, action) =>
  action === 'ver' && !['importacoes', 'auditoria', 'usuarios', 'configuracoes'].includes(mod));

// Mapa padrão / TETO de cada baseRole. Também é o teto ao qual as permissões de
// um perfil customizado são clampadas (interseccionadas) — ver roles.service.
const DEFAULTS = {
  admin: ADMIN_MAP,
  operador: OPERADOR_MAP,
  consulta: CONSULTA_MAP,
};

// Conjunto {modulo: Set(acoes)} do catálogo — para validar entradas do cliente.
const CATALOG_INDEX = MODULES.reduce((acc, mod) => {
  acc[mod.key] = new Set(mod.actions.map((a) => a.key));
  return acc;
}, {});

module.exports = { MODULES, VALID_ROLES, DEFAULTS, CATALOG_INDEX };
