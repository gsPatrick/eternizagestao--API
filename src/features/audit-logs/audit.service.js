'use strict';

/**
 * RECORDER de auditoria — fire and forget: NUNCA lança nem bloqueia o fluxo
 * chamador. É o único ponto de escrita em audit_logs.
 *
 * Três produtores alimentam este recorder:
 *   1. Hooks globais do Sequelize (src/models/audit-hooks.js) — CRUD automático
 *      com before/after.
 *   2. Services de feature que registram uma ação SEMÂNTICA (login, pagamento
 *      manual, emissão de documento, bloqueio…) e passam `{ skipAudit: true }`
 *      no create/update para o hook não duplicar.
 *   3. Middleware `audit` (rede de segurança) — grava um registro grosso caso
 *      nada mais tenha auditado a request.
 *
 * O ATOR (userId/portalAccountId/tenantId/ipAddress/userAgent) é lido do
 * AsyncLocalStorage via getActor(); overrides explícitos sempre vencem.
 */

const { AuditLog } = require('../../models');
const { getActor } = require('../../middlewares/request-context');

/* =========================================================================
 * VOCABULÁRIO DE AÇÕES (use exatamente estes valores no campo `action`)
 * ========================================================================= */
const ACTIONS = Object.freeze({
  CRIACAO: 'criacao',
  EDICAO: 'edicao',
  EXCLUSAO: 'exclusao',
  LOGIN: 'login',
  LOGOUT: 'logout',
  EXPORTACAO: 'exportacao',
  EMISSAO_DOCUMENTO: 'emissao_documento',
  PAGAMENTO_MANUAL: 'pagamento_manual',
  BLOQUEIO: 'bloqueio',
  DESBLOQUEIO: 'desbloqueio',
});

/* =========================================================================
 * NOMES AMIGÁVEIS por tabela (entityType legível para o log/UI)
 * ========================================================================= */
const FRIENDLY_ENTITY = Object.freeze({
  graves: 'Sepultura',
  people: 'Pessoa',
  billings: 'Cobrança',
  payments: 'Cobrança',
  documents: 'Documento',
  users: 'Usuário',
  concessions: 'Concessão',
  concession_transfers: 'Transferência de Concessão',
  deceased: 'Sepultado',
  burials: 'Sepultamento',
  exhumations: 'Exumação',
  schedules: 'Agendamento',
  remains_deposits: 'Depósito de Restos',
  ossuaries: 'Ossário',
  ossuary_niches: 'Nicho de Ossário',
  grave_maintenances: 'Manutenção de Sepultura',
  fee_types: 'Tipo de Taxa',
  maintenance_fees: 'Taxa de Manutenção',
  chapels: 'Capela',
  cemeteries: 'Cemitério',
  blocks: 'Quadra',
  streets: 'Rua',
  lots: 'Lote',
  grave_statuses: 'Situação de Sepultura',
  document_templates: 'Modelo de Documento',
  document_sequences: 'Sequência de Documento',
  document_signatures: 'Assinatura de Documento',
  person_relationships: 'Vínculo de Pessoa',
  family_portal_accounts: 'Conta do Portal',
  tenants: 'Cliente',
  attachments: 'Anexo',
  notifications: 'Notificação',
  orthophotos: 'Ortofoto',
  map_paths: 'Traçado do Mapa',
  import_batches: 'Importação',
  import_records: 'Registro de Importação',
  data_exports: 'Exportação de Dados',
});

/* =========================================================================
 * NOMES AMIGÁVEIS por CAMPO (chave camelCase/snake_case -> rótulo legível PT).
 * Usado para montar a descrição do evento (ex.: "Cliente editado(a): Razão
 * social, Cor primária, ..."). Campos não mapeados caem no humanizador genérico.
 * ========================================================================= */
const FIELD_LABELS = Object.freeze({
  // genéricos
  name: 'Nome',
  legalName: 'Razão social',
  tradeName: 'Nome fantasia',
  email: 'E-mail',
  phone: 'Telefone',
  document: 'Documento',
  cpf: 'CPF',
  cnpj: 'CNPJ',
  rg: 'RG',
  status: 'Situação',
  notes: 'Observações',
  description: 'Descrição',
  active: 'Ativo',
  isActive: 'Ativo',
  // marca / identidade do cliente (tenant)
  primaryColor: 'Cor primária',
  secondaryColor: 'Cor secundária',
  logoUrl: 'Logo',
  documentHeader: 'Cabeçalho de documentos',
  onboardingStatus: 'Status de ativação',
  subdomain: 'Subdomínio',
  domain: 'Domínio',
  plan: 'Plano',
  // endereço
  addressStreet: 'Endereço — rua',
  addressNumber: 'Endereço — número',
  addressComplement: 'Endereço — complemento',
  addressDistrict: 'Endereço — bairro',
  addressCity: 'Endereço — cidade',
  addressState: 'Endereço — estado',
  addressZipcode: 'Endereço — CEP',
  zipcode: 'CEP',
  // usuário / acesso
  role: 'Perfil',
  passwordHash: 'Senha',
  password: 'Senha',
  mustChangePassword: 'Troca de senha obrigatória',
  lastLoginAt: 'Último acesso',
  // pessoa
  motherName: 'Nome da mãe',
  fatherName: 'Nome do pai',
  birthDate: 'Data de nascimento',
  photoUrl: 'Foto',
  gender: 'Sexo',
  maritalStatus: 'Estado civil',
  // sepultado / óbito
  deathDate: 'Data do óbito',
  deathCause: 'Causa do óbito',
  attendingPhysician: 'Médico responsável',
  deathCertificateFileUrl: 'Certidão de óbito',
  // concessão / sepultura
  code: 'Código',
  graveCode: 'Código da sepultura',
  responsiblePersonId: 'Responsável',
  ownerPersonId: 'Proprietário',
  concessionType: 'Tipo de concessão',
  startDate: 'Início',
  endDate: 'Término',
  // financeiro
  amount: 'Valor',
  dueDate: 'Vencimento',
  paidAt: 'Pago em',
  paymentMethod: 'Forma de pagamento',
});

// Rótulo legível de um campo: usa o mapa; senão humaniza (camelCase/snake -> texto).
function fieldLabel(key) {
  if (FIELD_LABELS[key]) return FIELD_LABELS[key];
  const spaced = String(key)
    .replace(/_/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Monta a descrição amigável de uma EDIÇÃO a partir das chaves alteradas.
 * Ex.: "Cliente editado(a): Razão social, Cor primária, Endereço — cidade e mais 3 campos".
 * Lista até MAX rótulos e resume o excedente (o detalhe campo-a-campo fica na tela).
 * Remove duplicatas de rótulo (ex.: senha) para não repetir "Senha, Senha".
 */
function describeEdit(entityType, keys = []) {
  const labels = [];
  const seen = new Set();
  for (const key of keys) {
    const label = fieldLabel(key);
    if (seen.has(label)) continue;
    seen.add(label);
    labels.push(label);
  }
  if (labels.length === 0) return `${entityType} editado(a)`;
  const MAX = 6;
  let list;
  if (labels.length <= MAX) {
    list = labels.join(', ');
  } else {
    const extra = labels.length - MAX;
    list = `${labels.slice(0, MAX).join(', ')} e mais ${extra} ${extra === 1 ? 'campo' : 'campos'}`;
  }
  return `${entityType} editado(a): ${list}`;
}

/**
 * Resolve o nome amigável a partir de um model, instância ou nome de tabela.
 * Fallback: retorna a própria tabela quando não mapeada.
 */
function friendlyEntity(modelOrTable) {
  if (!modelOrTable) return null;

  let table = null;
  if (typeof modelOrTable === 'string') {
    table = modelOrTable;
  } else if (typeof modelOrTable.getTableName === 'function') {
    // Model class
    table = modelOrTable.getTableName();
  } else if (modelOrTable.constructor && typeof modelOrTable.constructor.getTableName === 'function') {
    // Instância de model
    table = modelOrTable.constructor.getTableName();
  }

  // getTableName pode retornar { tableName, schema } em casos com schema
  if (table && typeof table === 'object') table = table.tableName;
  if (!table) return null;

  return FRIENDLY_ENTITY[table] || table;
}

/* =========================================================================
 * ESCRITA
 * ========================================================================= */

/**
 * record — grava UM registro de auditoria. Fire-and-forget: nunca lança.
 * Lê o ator do ALS; overrides no argumento têm precedência.
 * Marca o store como já auditado (getActor().__audited = true) para a rede de
 * segurança do middleware não duplicar.
 */
function record({
  action,
  entityType = null,
  entityId = null,
  description = null,
  previousData = null,
  newData = null,
  ...overrides
} = {}) {
  try {
    const actor = getActor();

    // Marca a request como auditada (só se houver store — jobs/seed não têm).
    if (actor && typeof actor === 'object') actor.__audited = true;

    const payload = {
      tenantId: overrides.tenantId !== undefined ? overrides.tenantId : actor.tenantId || null,
      userId: overrides.userId !== undefined ? overrides.userId : actor.userId || null,
      portalAccountId:
        overrides.portalAccountId !== undefined
          ? overrides.portalAccountId
          : actor.portalAccountId || null,
      action,
      entityType,
      entityId,
      description,
      previousData,
      newData,
      ipAddress: overrides.ipAddress !== undefined ? overrides.ipAddress : actor.ipAddress || null,
      userAgent: overrides.userAgent !== undefined ? overrides.userAgent : actor.userAgent || null,
    };

    return AuditLog.create(payload).catch((err) =>
      console.error('[AUDIT] falha ao gravar log:', err.message)
    );
  } catch (err) {
    console.error('[AUDIT] falha ao gravar log:', err.message);
    return Promise.resolve(null);
  }
}

/**
 * log — API legada (backward-compat). Recebe todos os campos explicitamente,
 * sem consultar o ALS. Mantida para chamadores existentes.
 */
function log({
  tenantId = null,
  userId = null,
  portalAccountId = null,
  action,
  entityType = null,
  entityId = null,
  description = null,
  previousData = null,
  newData = null,
  ipAddress = null,
  userAgent = null,
} = {}) {
  try {
    return AuditLog.create({
      tenantId,
      userId,
      portalAccountId,
      action,
      entityType,
      entityId,
      description,
      previousData,
      newData,
      ipAddress,
      userAgent,
    }).catch((err) => console.error('[AUDIT] falha ao gravar log:', err.message));
  } catch (err) {
    console.error('[AUDIT] falha ao gravar log:', err.message);
    return Promise.resolve(null);
  }
}

module.exports = { record, log, friendlyEntity, describeEdit, fieldLabel, FRIENDLY_ENTITY, FIELD_LABELS, ACTIONS };
