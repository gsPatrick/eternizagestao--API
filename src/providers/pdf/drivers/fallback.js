'use strict';

/**
 * Driver de PDF FALLBACK — usado quando o Chromium/puppeteer não está disponível
 * (ou o driver real falha). NÃO renderiza o layout/cores/logo do HTML: extrai o
 * TEXTO do HTML branded (que inclui o NOME DO ÓRGÃO gestor, o título e o número
 * do documento) e o escreve num PDF VÁLIDO e auto-contido (Helvetica, base-14).
 *
 * Objetivo: garantir que o download SEMPRE entregue `application/pdf` com o
 * cabeçalho `%PDF-`, mesmo num ambiente sem browser — sem quebrar o fluxo e sem
 * dependência externa. NUNCA lança.
 *
 * Interface (idêntica ao driver `puppeteer`):
 *   htmlToPdf(html, { format?, margin? }) => Promise<Buffer>
 */

const PAGE_W = 595.28; // A4 em pontos (72dpi)
const PAGE_H = 841.89;
const MARGIN_X = 56;
const TOP_Y = 786;
const BOTTOM_Y = 56;
const FONT_SIZE = 11;
const LINE_HEIGHT = 15;
const MAX_CHARS = 96; // quebra de linha aproximada para Helvetica 11 na largura A4
const MAX_LINES_PER_PAGE = Math.floor((TOP_Y - BOTTOM_Y) / LINE_HEIGHT);

// HTML → lista de linhas de texto legíveis (preserva quebras de bloco/tabela).
function htmlToLines(html) {
  const text = String(html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<head[\s\S]*?<\/head>/gi, ' ')
    .replace(/<\/(p|div|tr|h1|h2|h3|h4|li|footer|header|table|section)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/td>\s*<td[^>]*>/gi, '   ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/[ \t ]+/g, ' ');

  const rawLines = text.split('\n').map((l) => l.trim()).filter(Boolean);

  // Quebra linhas longas em pedaços que caibam na largura útil.
  const wrapped = [];
  for (const line of rawLines) {
    if (line.length <= MAX_CHARS) { wrapped.push(line); continue; }
    let rest = line;
    while (rest.length > MAX_CHARS) {
      let cut = rest.lastIndexOf(' ', MAX_CHARS);
      if (cut <= 0) cut = MAX_CHARS;
      wrapped.push(rest.slice(0, cut).trim());
      rest = rest.slice(cut).trim();
    }
    if (rest) wrapped.push(rest);
  }
  return wrapped.length ? wrapped : ['Documento'];
}

// Escapa uma string para o operador de texto do PDF ( ( ) e \ são especiais ).
function escapePdfText(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

// Content stream de UMA página a partir de suas linhas.
function pageContentStream(lines) {
  const parts = ['BT', `/F1 ${FONT_SIZE} Tf`, `${LINE_HEIGHT} TL`, `${MARGIN_X} ${TOP_Y} Td`];
  lines.forEach((line, i) => {
    if (i > 0) parts.push('T*');
    parts.push(`(${escapePdfText(line)}) Tj`);
  });
  parts.push('ET');
  return parts.join('\n');
}

// Monta um PDF 1.4 válido (multi-página) com xref correto (offsets em bytes).
function buildPdf(allLines) {
  const pages = [];
  for (let i = 0; i < allLines.length; i += MAX_LINES_PER_PAGE) {
    pages.push(allLines.slice(i, i + MAX_LINES_PER_PAGE));
  }
  if (pages.length === 0) pages.push(['Documento']);

  // Numeração de objetos:
  //   1 = Catalog, 2 = Pages, 3 = Font, depois por página: content + page.
  const fontObj = 3;
  const objects = {}; // número -> corpo (string latin1) SEM "n 0 obj"
  const pageObjNums = [];

  let next = 4;
  for (const lines of pages) {
    const contentNum = next++;
    const pageNum = next++;
    const stream = pageContentStream(lines);
    const streamLen = Buffer.byteLength(stream, 'latin1');
    objects[contentNum] = `<< /Length ${streamLen} >>\nstream\n${stream}\nendstream`;
    objects[pageNum] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
      `/Resources << /Font << /F1 ${fontObj} 0 R >> >> /Contents ${contentNum} 0 R >>`;
    pageObjNums.push(pageNum);
  }

  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] =
    `<< /Type /Pages /Count ${pageObjNums.length} ` +
    `/Kids [${pageObjNums.map((n) => `${n} 0 R`).join(' ')}] >>`;
  objects[fontObj] =
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';

  const total = next - 1;
  const chunks = [];
  let offset = 0;
  const offsets = new Array(total + 1).fill(0);

  const push = (str) => {
    const buf = Buffer.from(str, 'latin1');
    chunks.push(buf);
    offset += buf.length;
  };

  push('%PDF-1.4\n%âãÏÓ\n'); // comentário binário: sinaliza PDF binário
  for (let n = 1; n <= total; n += 1) {
    offsets[n] = offset;
    push(`${n} 0 obj\n${objects[n]}\nendobj\n`);
  }

  const xrefStart = offset;
  let xref = `xref\n0 ${total + 1}\n0000000000 65535 f \n`;
  for (let n = 1; n <= total; n += 1) {
    xref += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`;
  }
  push(xref);
  push(`trailer\n<< /Size ${total + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`);

  return Buffer.concat(chunks);
}

// eslint-disable-next-line no-unused-vars
async function htmlToPdf(html, opts = {}) {
  try {
    return buildPdf(htmlToLines(html));
  } catch (err) {
    // Último recurso: um PDF mínimo mas válido (nunca lança).
    console.error('[pdf:fallback] falha ao montar PDF do HTML:', err.message);
    return buildPdf(['Documento oficial', 'PDF gerado em modo de contingência.']);
  }
}

module.exports = { name: 'fallback', htmlToPdf };
