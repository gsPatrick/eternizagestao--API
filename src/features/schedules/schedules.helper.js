'use strict';

/**
 * Detecção de conflito de agenda por sobreposição de intervalos:
 * (startsAt < :endsAt AND endsAt > :startsAt) na MESMA capela OU MESMA sepultura.
 * Agendamentos cancelados/concluídos não geram conflito.
 */
const { Op } = require('sequelize');
const { Schedule } = require('../../models');

async function findConflicts({
  tenantId,
  chapelId = null,
  graveId = null,
  startsAt,
  endsAt,
  excludeId = null,
  transaction = null,
} = {}) {
  const resourceCriteria = [];
  if (chapelId) resourceCriteria.push({ chapelId });
  if (graveId) resourceCriteria.push({ graveId });
  if (!resourceCriteria.length) return []; // sem capela nem sepultura ⇒ nada a conflitar

  const where = {
    tenantId,
    status: { [Op.notIn]: ['cancelado', 'concluido'] },
    startsAt: { [Op.lt]: endsAt },
    endsAt: { [Op.gt]: startsAt },
    [Op.or]: resourceCriteria,
  };
  if (excludeId) where.id = { [Op.ne]: excludeId };

  return Schedule.findAll({ where, order: [['startsAt', 'ASC']], transaction });
}

/**
 * Detecta violação da constraint de exclusão (agenda sobreposta) garantida pelo
 * Postgres (EXCLUDE ... WITH). Cobre o nome do erro do Sequelize e o SQLSTATE
 * 23P01 (exclusion_violation) exposto em err.original/err.parent. Serve para
 * traduzir a corrida "duas requisições simultâneas" num 409 limpo, mesmo quando
 * o findConflicts em memória não pegou o conflito.
 */
function isExclusionConstraintError(err) {
  return !!err && (
    err.name === 'SequelizeExclusionConstraintError'
    || err.original?.code === '23P01'
    || err.parent?.code === '23P01'
  );
}

module.exports = { findConflicts, isExclusionConstraintError };
