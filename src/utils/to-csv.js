'use strict';

// Converte array de objetos em CSV (separador ';' — padrão pt-BR/Excel).
function toCsv(rows = [], separator = ';') {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const escape = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.join(separator)];
  for (const row of rows) {
    lines.push(headers.map((h) => escape(row[h])).join(separator));
  }
  return lines.join('\n');
}

module.exports = { toCsv };
