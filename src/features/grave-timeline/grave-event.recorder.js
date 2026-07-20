'use strict';

/**
 * Recorder da linha do tempo do jazigo — ÚNICO ponto de escrita em grave_events.
 * Usado por todas as features (burials, exhumations, concessions, billings...)
 * SEMPRE dentro da transação da operação de origem.
 *
 * grave_events é imutável: nunca update/delete; correções geram novo evento.
 */
const { GraveEvent } = require('../../models');

async function record(
  {
    tenantId,
    graveId,
    eventType,
    title,
    description = null,
    referenceType = null,
    referenceId = null,
    metadata = null,
    occurredAt = new Date(),
    userId = null,
  },
  { transaction } = {}
) {
  return GraveEvent.create(
    {
      tenantId,
      graveId,
      eventType,
      title,
      description,
      referenceType,
      referenceId,
      metadata,
      occurredAt,
      registeredByUserId: userId,
    },
    { transaction }
  );
}

module.exports = { record };
