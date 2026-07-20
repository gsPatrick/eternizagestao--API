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

module.exports = { record, log, friendlyEntity, FRIENDLY_ENTITY, ACTIONS };
