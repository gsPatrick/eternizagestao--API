'use strict';

/**
 * Datas de NEGÓCIO no fuso de operação (cemitérios no Brasil).
 *
 * Por que existe: `new Date().toISOString().slice(0,10)` devolve a data em UTC.
 * Às 22h de 20/07 em UTC-3 isso vira "2026-07-21" — e o sistema gravava o DIA
 * SEGUINTE em sepultamento, concessão, exumação, taxas e inadimplência.
 *
 * Também NÃO dá para confiar no fuso do processo: o container de produção roda
 * em UTC, então "hora local do servidor" seria UTC do mesmo jeito. Por isso o
 * fuso é EXPLÍCITO (trocável por APP_TIMEZONE).
 */
const TZ = process.env.APP_TIMEZONE || 'America/Sao_Paulo';

// 'en-CA' formata como YYYY-MM-DD — exatamente o DATEONLY do banco.
const dateFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Data de HOJE (ou de `date`) no fuso de operação, em YYYY-MM-DD. */
function todayISO(date = new Date()) {
  return dateFmt.format(date);
}

module.exports = { todayISO, TZ };
