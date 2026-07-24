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

// Partes de data/hora do instante lido NO FUSO DE OPERAÇÃO.
const partsFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ,
  hour12: false,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
});
function tzParts(date) {
  const out = {};
  for (const p of partsFmt.formatToParts(date)) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return out;
}

/** Offset do fuso de operação em MINUTOS (calculado, não fixo — à prova de DST). */
function tzOffsetMinutes(date = new Date()) {
  const p = tzParts(date);
  const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second);
  return (asUTC - Math.floor(date.getTime() / 1000) * 1000) / 60000;
}

/** HORA do dia (0..23) no fuso de operação — o servidor roda em UTC. */
function hourInTZ(date = new Date()) {
  return tzParts(date).hour % 24;
}

/** Instante da MEIA-NOITE do dia corrente no fuso de operação. */
function startOfTodayInTZ(date = new Date()) {
  const [y, m, d] = todayISO(date).split('-').map(Number);
  const offset = tzOffsetMinutes(date);
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0) - offset * 60000);
}

/**
 * Combina uma DATA ("YYYY-MM-DD") e uma HORA ("HH:MM") do FUSO DE OPERAÇÃO num
 * instante UTC (Date). Usado para transformar a data+hora do sepultamento — que
 * o operador digita no horário local do cemitério — no `startsAt` da agenda.
 *
 * O container roda em UTC, então "16:10" precisa saber que é 16:10 em
 * America/Sao_Paulo (hoje -03, DST-safe via tzOffsetMinutes) antes de virar
 * 19:10Z. Sem isso, o mesmo horário apareceria deslocado no portal.
 */
function combineLocalDateTime(dateISO, timeHHMM = '00:00') {
  if (!dateISO) return null;
  const [y, m, d] = String(dateISO).slice(0, 10).split('-').map(Number);
  const [hh, mm] = String(timeHHMM || '00:00').slice(0, 5).split(':').map(Number);
  if (!y || !m || !d) return null;
  // Estimativa UTC ingênua e o offset AVALIADO NAQUELE INSTANTE (cobre a rara
  // virada de DST entre a data e "agora").
  const naive = Date.UTC(y, m - 1, d, hh || 0, mm || 0, 0);
  const offset = tzOffsetMinutes(new Date(naive));
  return new Date(naive - offset * 60000);
}

module.exports = { todayISO, hourInTZ, startOfTodayInTZ, tzOffsetMinutes, combineLocalDateTime, TZ };
