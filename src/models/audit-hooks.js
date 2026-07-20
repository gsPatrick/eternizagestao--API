'use strict';

/**
 * Hooks GLOBAIS de auditoria — capturam AUTOMATICAMENTE todo CRUD de negócio
 * (afterCreate / afterUpdate / afterDestroy) com before/after, sem que cada
 * service precise logar manualmente.
 *
 * Wire (em src/models/index.js, depois das associações):
 *   require('./audit-hooks').attachAuditHooks(sequelize);
 *
 * Regras:
 *  - PULA os models: AuditLog (evita recursão), GraveEvent e PaymentGatewayEvent
 *    (já são históricos/eventos próprios).
 *  - PULA qualquer operação com options.skipAudit === true (quem loga a ação
 *    SEMÂNTICA usa esse flag para o hook não duplicar).
 *  - update só gera log se algum campo relevante mudou.
 *  - Ator vem do ALS (getActor via audit.service.record); em jobs/seed grava
 *    com nulls.
 *
 * Fire-and-forget: os hooks NÃO são async e NÃO retornam a promise da escrita,
 * então nunca atrasam nem derrubam a operação de negócio.
 */

// Models que nunca são auditados por este motor genérico.
const SKIP_MODELS = new Set(['AuditLog', 'GraveEvent', 'PaymentGatewayEvent']);

// Campos-ruído: irrelevantes para o diff de auditoria.
const NOISE_FIELDS = new Set(['createdAt', 'updatedAt', 'deletedAt']);

// Campos sensíveis: nunca copiar valores para o log.
const REDACT = /(password|senha|secret|token|hash)/i;

function isRedacted(key) {
  return REDACT.test(key);
}

// Snapshot dos valores relevantes de uma instância (sem ruído/segredos).
function snapshot(instance) {
  const values = instance && instance.dataValues ? instance.dataValues : {};
  const out = {};
  for (const key of Object.keys(values)) {
    if (NOISE_FIELDS.has(key)) continue;
    if (isRedacted(key)) {
      out[key] = '[REDACTED]';
      continue;
    }
    out[key] = values[key];
  }
  return out;
}

function attachAuditHooks(sequelize) {
  // Lazy-require: audit.service depende de ../../models, que ainda pode estar
  // em carregamento quando este arquivo é avaliado. Resolvemos no 1º disparo.
  let recorder = null;
  const audit = () => {
    if (!recorder) recorder = require('../features/audit-logs/audit.service');
    return recorder;
  };

  const shouldSkip = (instance, options) => {
    if (!instance || !instance.constructor) return true;
    if (options && options.skipAudit === true) return true;
    return SKIP_MODELS.has(instance.constructor.name);
  };

  // ---------- CREATE ----------
  sequelize.addHook('afterCreate', (instance, options) => {
    if (shouldSkip(instance, options)) return;
    const { record, friendlyEntity } = audit();
    const entityType = friendlyEntity(instance.constructor);
    record({
      action: 'criacao',
      entityType,
      entityId: instance.id != null ? instance.id : null,
      description: `${entityType} criado(a)`,
      newData: snapshot(instance),
    });
  });

  // ---------- UPDATE ----------
  sequelize.addHook('afterUpdate', (instance, options) => {
    if (shouldSkip(instance, options)) return;

    const changedKeys = (instance.changed() || []).filter((k) => !NOISE_FIELDS.has(k));
    if (changedKeys.length === 0) return; // nada relevante mudou

    const previousData = {};
    const newData = {};
    for (const key of changedKeys) {
      if (isRedacted(key)) {
        previousData[key] = '[REDACTED]';
        newData[key] = '[REDACTED]';
        continue;
      }
      previousData[key] = instance.previous(key);
      newData[key] = instance.get(key);
    }

    const { record, friendlyEntity, describeEdit } = audit();
    const entityType = friendlyEntity(instance.constructor);
    record({
      action: 'edicao',
      entityType,
      entityId: instance.id != null ? instance.id : null,
      description: describeEdit(entityType, changedKeys),
      previousData,
      newData,
    });
  });

  // ---------- DESTROY ----------
  sequelize.addHook('afterDestroy', (instance, options) => {
    if (shouldSkip(instance, options)) return;
    const { record, friendlyEntity } = audit();
    const entityType = friendlyEntity(instance.constructor);
    record({
      action: 'exclusao',
      entityType,
      entityId: instance.id != null ? instance.id : null,
      description: `${entityType} excluído(a)`,
      previousData: snapshot(instance),
    });
  });
}

module.exports = { attachAuditHooks };
