'use strict';

/**
 * Helpers puros do financeiro (sem I/O) — cálculo de total e avanço de período.
 * DECIMAL do Sequelize chega como string: sempre parseFloat + toFixed(2).
 */

// total = amount − discount + fine + interest → string '0.00'
function computeTotal({ amount, discountAmount = 0, fineAmount = 0, interestAmount = 0 }) {
  const num = (v) => {
    const parsed = parseFloat(v);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const total = num(amount) - num(discountAmount) + num(fineAmount) + num(interestAmount);
  return total.toFixed(2);
}

const PERIODICITY_MONTHS = { mensal: 1, trimestral: 3, semestral: 6, anual: 12 };

/**
 * Próxima data de vencimento somando 1/3/6/12 meses conforme a periodicidade.
 * 'unica' não recorre → retorna null. Dia é ajustado ao fim do mês destino
 * (ex.: 31/jan + 1 mês ⇒ 28/fev). Aceita Date ou 'YYYY-MM-DD'; retorna Date (UTC).
 */
function nextPeriod(referenceDate, periodicity) {
  const months = PERIODICITY_MONTHS[periodicity];
  if (!months) return null; // 'unica' (ou periodicidade desconhecida) não gera próximo período

  const base = referenceDate instanceof Date
    ? referenceDate
    : new Date(`${String(referenceDate).slice(0, 10)}T00:00:00Z`);

  const year = base.getUTCFullYear();
  const month = base.getUTCMonth() + months;
  const lastDayOfTarget = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(base.getUTCDate(), lastDayOfTarget);
  return new Date(Date.UTC(year, month, day));
}

// Date → 'YYYY-MM-DD' (para colunas DATEONLY)
function toDateOnly(date) {
  return date ? date.toISOString().slice(0, 10) : null;
}

module.exports = { computeTotal, nextPeriod, toDateOnly };
