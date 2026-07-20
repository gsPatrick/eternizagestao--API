'use strict';

/**
 * Geradores de arquivo dos relatórios — SEM dependências externas.
 * Recebem `rows` (array plano de objetos, o mesmo shape do JSON/CSV) e devolvem
 * um Buffer pronto para download:
 *   - toXlsx(rows, { sheetName }) → .xlsx real (OOXML: ZIP store + SpreadsheetML)
 *   - toPdf(rows, { title })      → .pdf real (tabela em Courier, A4 paisagem)
 * A intenção é servir os formatos que a tela oferece (PDF/XLSX) sem adicionar
 * libs ao projeto (não há exceljs/pdfkit instalados).
 */

/* ============================ util comum ============================ */

function cellText(v) {
  if (v === null || v === undefined) return '';
  return String(v);
}

/* ============================ XLSX (OOXML) ============================ */

function xmlEscape(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Índice 0-based → nome de coluna do Excel (A, B, ... Z, AA, AB, ...).
function colName(idx) {
  let n = idx + 1;
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

// CRC-32 (necessário para o cabeçalho do ZIP).
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let j = 0; j < 8; j += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  return table;
})();

function crc32(buf) {
  let crc = ~0;
  for (let i = 0; i < buf.length; i += 1) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]) & 0xff];
  }
  return (~crc) >>> 0;
}

// ZIP sem compressão (método "store") — suficiente e 100% determinístico.
function zipStore(files) {
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const file of files) {
    const nameBuf = Buffer.from(file.name, 'utf8');
    const data = file.data;
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(0, 8); // compression = store
    local.writeUInt16LE(0, 10); // mod time
    local.writeUInt16LE(0, 12); // mod date
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18); // compressed size
    local.writeUInt32LE(data.length, 22); // uncompressed size
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra length

    chunks.push(local, nameBuf, data);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4); // version made by
    cd.writeUInt16LE(20, 6); // version needed
    cd.writeUInt16LE(0, 8);
    cd.writeUInt16LE(0, 10);
    cd.writeUInt16LE(0, 12);
    cd.writeUInt16LE(0, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(data.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30); // extra
    cd.writeUInt16LE(0, 32); // comment
    cd.writeUInt16LE(0, 34); // disk start
    cd.writeUInt16LE(0, 36); // internal attrs
    cd.writeUInt32LE(0, 38); // external attrs
    cd.writeUInt32LE(offset, 42); // local header offset
    central.push(Buffer.concat([cd, nameBuf]));

    offset += local.length + nameBuf.length + data.length;
  }

  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...chunks, centralBuf, end]);
}

function sheetXml(rows) {
  const headers = rows.length ? Object.keys(rows[0]) : ['—'];
  const data = rows.length ? rows : [{ '—': 'Sem dados para o período selecionado' }];

  const buildRow = (values, rowIndex) => {
    const cells = values
      .map((value, colIdx) => {
        const ref = `${colName(colIdx)}${rowIndex}`;
        if (typeof value === 'number' && Number.isFinite(value)) {
          return `<c r="${ref}"><v>${value}</v></c>`;
        }
        const text = cellText(value);
        if (text === '') return `<c r="${ref}"/>`;
        return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(text)}</t></is></c>`;
      })
      .join('');
    return `<row r="${rowIndex}">${cells}</row>`;
  };

  const rowsXml = [buildRow(headers, 1)];
  data.forEach((obj, i) => {
    rowsXml.push(buildRow(headers.map((h) => obj[h]), i + 2));
  });

  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `<sheetData>${rowsXml.join('')}</sheetData>` +
    '</worksheet>'
  );
}

function toXlsx(rows = [], { sheetName = 'Relatório' } = {}) {
  const safeSheet = xmlEscape(String(sheetName).slice(0, 31)) || 'Relatório';
  const files = [
    {
      name: '[Content_Types].xml',
      data: Buffer.from(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="xml" ContentType="application/xml"/>' +
          '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
          '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
          '</Types>',
        'utf8'
      ),
    },
    {
      name: '_rels/.rels',
      data: Buffer.from(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
          '</Relationships>',
        'utf8'
      ),
    },
    {
      name: 'xl/workbook.xml',
      data: Buffer.from(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
          `<sheets><sheet name="${safeSheet}" sheetId="1" r:id="rId1"/></sheets>` +
          '</workbook>',
        'utf8'
      ),
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: Buffer.from(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
          '</Relationships>',
        'utf8'
      ),
    },
    { name: 'xl/worksheets/sheet1.xml', data: Buffer.from(sheetXml(rows), 'utf8') },
  ];
  return zipStore(files);
}

/* ============================ PDF ============================ */

// PDF usa WinAnsiEncoding → escrevemos o conteúdo em latin1 (acentos pt-BR ok).
function pdfEscape(s) {
  return String(s).replace(/[\\()]/g, (m) => `\\${m}`);
}

// Larguras fixas (em caracteres) por coluna, limitadas para caber na página.
function layoutColumns(headers, data, maxCharsPerRow) {
  const widths = headers.map((h, i) => {
    let w = cellText(h).length;
    for (const obj of data) w = Math.max(w, cellText(obj[headers[i]]).length);
    return Math.min(Math.max(w, 3), 28);
  });
  // Se estourar a largura, reduz proporcionalmente.
  const total = widths.reduce((a, b) => a + b + 1, 0);
  if (total > maxCharsPerRow && total > 0) {
    const factor = maxCharsPerRow / total;
    for (let i = 0; i < widths.length; i += 1) {
      widths[i] = Math.max(3, Math.floor(widths[i] * factor));
    }
  }
  return widths;
}

function padTrunc(value, width) {
  const s = cellText(value);
  if (s.length > width) return s.slice(0, Math.max(1, width - 1)) + '…';
  return s.padEnd(width, ' ');
}

function toPdf(rows = [], { title = 'Relatório', subtitle = '', org = '' } = {}) {
  const headers = rows.length ? Object.keys(rows[0]) : [];
  const data = rows;

  // A4 paisagem (842 x 595 pt), Courier 8pt (largura ≈ 4.8pt/char).
  const pageW = 842;
  const pageH = 595;
  const margin = 32;
  const fontSize = 8;
  const lineHeight = 11;
  const charW = fontSize * 0.6;
  const maxCharsPerRow = Math.floor((pageW - margin * 2) / charW);

  const headerLine = headers.length
    ? layoutColumns(headers, data, maxCharsPerRow)
    : [];
  const colWidths = headerLine;

  const rowToLine = (obj) =>
    headers.map((h, i) => padTrunc(obj[h], colWidths[i])).join(' ');
  const headerText = headers.map((h, i) => padTrunc(h, colWidths[i])).join(' ');

  const bodyLines = data.length
    ? data.map(rowToLine)
    : ['Sem dados para o período selecionado.'];

  // Paginação.
  const topY = pageH - margin;
  // Cabeçalho branded (nome do órgão gestor/cidade) ocupa uma linha extra no topo.
  const headerBlock = org ? 4 : 3; // [órgão] + título + subtítulo + cabeçalho de colunas
  const tableTopY = org ? topY - 52 : topY - 38;
  const linesPerPage = Math.floor((pageH - margin * 2 - headerBlock * lineHeight) / lineHeight);
  const pages = [];
  for (let i = 0; i < bodyLines.length; i += Math.max(1, linesPerPage)) {
    pages.push(bodyLines.slice(i, i + Math.max(1, linesPerPage)));
  }
  if (!pages.length) pages.push([]);

  const objects = [];
  const addObject = (body) => {
    objects.push(body);
    return objects.length; // número do objeto (1-based)
  };

  const fontObj = null; // preenchido depois
  // Reservamos ids: 1=catalog, 2=pages, depois páginas+conteúdos, por fim fonte.
  // Para simplificar, montamos tudo e calculamos offsets no final.

  // Content streams por página.
  const contentIds = [];
  const pageIds = [];

  // Placeholder: vamos construir na ordem catalog, pages, [page, content]..., font
  // Primeiro criamos os content streams e páginas com ids sequenciais.
  // ids: catalog=1, pagesNode=2, fonte=3, depois pares página/conteúdo a partir de 4.
  const catalogId = 1;
  const pagesId = 2;
  const fontId = 3;
  let nextId = 4;

  const pageObjs = [];
  const contentObjs = [];

  pages.forEach((pageLines, idx) => {
    const contentId = nextId++;
    const pageId = nextId++;
    contentIds.push(contentId);
    pageIds.push(pageId);

    let stream = '';
    // Cabeçalho branded: nome do órgão gestor / cidade no topo.
    if (org) {
      stream += 'BT\n';
      stream += `/F1 11 Tf\n${margin} ${topY - 2} Td\n(${pdfEscape(org)}) Tj\n`;
      stream += 'ET\n';
    }
    const titleY = org ? topY - 18 : topY - 4;
    const subY = org ? topY - 32 : topY - 20;
    stream += 'BT\n';
    stream += `/F1 13 Tf\n${margin} ${titleY} Td\n(${pdfEscape(title)}) Tj\n`;
    stream += 'ET\n';
    stream += 'BT\n';
    stream += `/F1 8 Tf\n`;
    const sub = subtitle
      ? `${subtitle}  ·  página ${idx + 1}/${pages.length}`
      : `página ${idx + 1}/${pages.length}`;
    stream += `${margin} ${subY} Td\n(${pdfEscape(sub)}) Tj\n`;
    stream += 'ET\n';
    stream += 'BT\n';
    stream += `/F1 ${fontSize} Tf\n${lineHeight} TL\n${margin} ${tableTopY} Td\n`;
    if (headers.length) {
      stream += `(${pdfEscape(headerText)}) Tj\nT*\n`;
    }
    for (const line of pageLines) {
      stream += `(${pdfEscape(line)}) Tj\nT*\n`;
    }
    stream += 'ET\n';

    const streamBuf = Buffer.from(stream, 'latin1');
    contentObjs.push({
      id: contentId,
      body: Buffer.concat([
        Buffer.from(`<< /Length ${streamBuf.length} >>\nstream\n`, 'latin1'),
        streamBuf,
        Buffer.from('\nendstream', 'latin1'),
      ]),
    });
    pageObjs.push({
      id: pageId,
      body: Buffer.from(
        `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${pageW} ${pageH}] ` +
          `/Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`,
        'latin1'
      ),
    });
  });

  const catalog = { id: catalogId, body: Buffer.from(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`, 'latin1') };
  const pagesNode = {
    id: pagesId,
    body: Buffer.from(
      `<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map((i) => `${i} 0 R`).join(' ')}] >>`,
      'latin1'
    ),
  };
  const font = {
    id: fontId,
    body: Buffer.from(
      '<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>',
      'latin1'
    ),
  };

  const allObjs = [catalog, pagesNode, font, ...contentObjs, ...pageObjs].sort((a, b) => a.id - b.id);

  // Monta o arquivo com tabela xref.
  let pdf = Buffer.from('%PDF-1.4\n%\xff\xff\xff\xff\n', 'latin1');
  const offsets = [];
  for (const obj of allObjs) {
    offsets[obj.id] = pdf.length;
    pdf = Buffer.concat([
      pdf,
      Buffer.from(`${obj.id} 0 obj\n`, 'latin1'),
      obj.body,
      Buffer.from('\nendobj\n', 'latin1'),
    ]);
  }

  const xrefStart = pdf.length;
  const count = allObjs.length + 1; // + objeto 0 (livre)
  let xref = `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let id = 1; id <= allObjs.length; id += 1) {
    xref += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  }
  xref += `trailer\n<< /Size ${count} /Root ${catalogId} 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

  return Buffer.concat([pdf, Buffer.from(xref, 'latin1')]);
}

module.exports = { toXlsx, toPdf };
