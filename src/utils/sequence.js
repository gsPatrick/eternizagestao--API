'use strict';

/**
 * Numeração sequencial transacional e concorrência-safe por tenant + escopo + ano.
 *
 * Generaliza o padrão de features/documents/document-number.helper.js:
 *  - findOrCreate garante a linha da série;
 *  - releitura com SELECT ... FOR UPDATE serializa emissões concorrentes dentro
 *    da transação do chamador (o próximo processo espera o commit/rollback).
 *
 * `nextNumber` reserva 1; `nextBlock` reserva um BLOCO em UMA atualização travada,
 * para geração em massa (ex.: 10k cobranças) sem serializar linha a linha.
 */
const { Sequence } = require('../models');

// Garante a linha da série e devolve a instância travada (FOR UPDATE).
async function lockRow({ tenantId, scope, year }, transaction) {
  const where = { tenantId, scope, year };

  await Sequence.findOrCreate({
    where,
    defaults: { ...where, lastNumber: 0 },
    transaction,
  });

  return Sequence.findOne({
    where,
    lock: transaction.LOCK.UPDATE,
    transaction,
  });
}

// Reserva o PRÓXIMO número (incremento de 1) sob lock. Retorna o inteiro.
async function nextNumber({ tenantId, scope, year }, { transaction }) {
  const sequence = await lockRow({ tenantId, scope, year }, transaction);
  const number = sequence.lastNumber + 1;
  await sequence.update({ lastNumber: number }, { transaction });
  return number;
}

// Reserva um BLOCO contíguo de `count` números em UMA única atualização travada.
// Retorna { start, end } (inclusivos). Para count <= 0 devolve bloco vazio sem
// tocar na sequência. Ideal para bulk: uma linha travada por lote, não por item.
async function nextBlock({ tenantId, scope, year, count }, { transaction }) {
  const size = Number(count) || 0;
  if (size <= 0) return { start: 0, end: -1 };

  const sequence = await lockRow({ tenantId, scope, year }, transaction);
  const start = sequence.lastNumber + 1;
  const end = sequence.lastNumber + size;
  await sequence.update({ lastNumber: end }, { transaction });
  return { start, end };
}

// COB-2026-0001 (4 dígitos, padStart)
function formatBilling(n, year) {
  return `COB-${year}-${String(n).padStart(4, '0')}`;
}

// 0044/2026 (4 dígitos, padStart)
function formatExhumation(n, year) {
  return `${String(n).padStart(4, '0')}/${year}`;
}

module.exports = { nextNumber, nextBlock, formatBilling, formatExhumation };
