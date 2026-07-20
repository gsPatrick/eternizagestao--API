'use strict';

/**
 * Numeração sequencial transacional de documentos por tenant + tipo + ano.
 * findOrCreate garante a linha; releitura com SELECT ... FOR UPDATE serializa
 * emissões concorrentes dentro da transação do chamador.
 */
const { DocumentSequence } = require('../../models');

async function nextNumber({ tenantId, documentType, year, transaction }) {
  const where = { tenantId, documentType, year };

  await DocumentSequence.findOrCreate({
    where,
    defaults: { ...where, lastNumber: 0 },
    transaction,
  });

  const sequence = await DocumentSequence.findOne({
    where,
    lock: transaction.LOCK.UPDATE,
    transaction,
  });

  const number = sequence.lastNumber + 1;
  await sequence.update({ lastNumber: number }, { transaction });

  return {
    number,
    formattedNumber: `${String(number).padStart(4, '0')}/${year}`,
  };
}

module.exports = { nextNumber };
