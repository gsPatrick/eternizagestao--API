'use strict';

/**
 * MODELOS OFICIAIS de documento — reproduzem os PDFs do cliente (certidão de
 * perpetuidade e autorização de sepultamento). Cada layout é montado a partir de
 * um CONTEXTO rico já resolvido em documents.service (grave + estrutura quadra/
 * lote, sepultados do jazigo, concessão/proprietário, datas, branding do órgão).
 *
 * Estrutura fiel aos PDFs:
 *   Cabeçalho do órgão (brasão/logo + Prefeitura/Secretaria/UF/Governo Municipal)
 *   Faixa título (CERTIDÃO DE PERPETUIDADE / AUTORIZAÇÃO DE SEPULTAMENTO)
 *   Faixa "CEMITÉRIO {nome}" + "Certidão de nº: {número}"
 *   Dados da sepultura (Quadra, Lote, Gaveta, Tipo do túmulo, Utilização,
 *     Permissão de carneira, Observação)
 *   Croqui de localização (SVG) + Foto da sepultura
 *   Relação de sepultados (tabela)
 *   Proprietário/Responsável (dados completos)
 *   Texto legal ({{texto_legal}} — vem da config por cidade)
 *   Vencimento da concessão (Data da permissão / Data do vencimento)
 *   Rodapé (cidade + data por extenso, linhas de assinatura, endereço do órgão)
 */

const MONTHS = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

function escapeHtml(value) {
  if (value === undefined || value === null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// '2026-07-19' | Date → 'dd/mm/aaaa' (sem quebrar em valor inválido).
function fmtDate(value) {
  if (!value) return '—';
  const s = String(value);
  const iso = s.length <= 10 ? `${s}T00:00:00` : s;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return escapeHtml(s);
  return d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

// 'Itaberaba, 19 de julho de 2026' — rodapé por extenso.
function cityDateExtenso(city, date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const label = `${d.getDate()} de ${MONTHS[d.getMonth()]} de ${d.getFullYear()}`;
  return city ? `${city}, ${label}.` : `${label}.`;
}

const dash = (v) => {
  const s = v === undefined || v === null ? '' : String(v).trim();
  return s ? escapeHtml(s) : '—';
};

/**
 * Croqui SIMPLES do lote (SVG) — quadra com alguns lotes e o alvo destacado na
 * cor de acento, rotulado "quadra/lote" (ex.: "01/01"). Não é o mapa
 * georreferenciado — é um esquema de localização.
 */
function croquiSvg({ blockCode = '01', lotCode = '01', accent = '#032e59' }) {
  const label = `${escapeHtml(blockCode)}/${escapeHtml(lotCode)}`;
  // grade 4x3 de lotes; destaca uma célula central como o lote alvo.
  const cells = [];
  const cols = 4;
  const rows = 3;
  const cw = 44;
  const ch = 30;
  const ox = 16;
  const oy = 16;
  const targetIndex = 5; // célula destacada (linha 1, col 1)
  let i = 0;
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const x = ox + c * cw;
      const y = oy + r * ch;
      const on = i === targetIndex;
      cells.push(
        `<rect x="${x}" y="${y}" width="${cw - 4}" height="${ch - 4}" rx="2" `
        + `fill="${on ? accent : '#f4f6f8'}" stroke="${on ? accent : '#c7d0d9'}" stroke-width="${on ? 2 : 1}"/>`
      );
      if (on) {
        cells.push(
          `<text x="${x + (cw - 4) / 2}" y="${y + (ch - 4) / 2 + 4}" text-anchor="middle" `
          + `font-size="11" font-family="Arial, sans-serif" fill="#ffffff" font-weight="bold">${label}</text>`
        );
      }
      i += 1;
    }
  }
  return [
    `<svg viewBox="0 0 ${ox * 2 + cols * cw} ${oy * 2 + rows * ch + 18}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Croqui de localização quadra ${label}">`,
    `<rect x="6" y="6" width="${ox * 2 + cols * cw - 12}" height="${oy * 2 + rows * ch - 12}" rx="4" fill="none" stroke="#c7d0d9" stroke-width="1"/>`,
    cells.join(''),
    `<text x="${(ox * 2 + cols * cw) / 2}" y="${oy * 2 + rows * ch + 8}" text-anchor="middle" font-size="10" font-family="Arial, sans-serif" fill="#52606d">Quadra ${escapeHtml(blockCode)} · Lote ${escapeHtml(lotCode)}</text>`,
    '</svg>',
  ].join('');
}

// Linhas da tabela "Relação de sepultados".
function deceasedRows(list = []) {
  if (!list.length) {
    return '<tr><td colspan="4" class="empty">Nenhum sepultado registrado neste jazigo.</td></tr>';
  }
  return list
    .map(
      (d) =>
        `<tr><td>${dash(d.name)}</td><td>${dash(d.cpf)}</td>`
        + `<td>${fmtDate(d.burialDate)}</td><td>${fmtDate(d.deathDate)}</td></tr>`
    )
    .join('');
}

// Bloco "Dados da sepultura" (linhas rótulo/valor em 2 colunas).
function graveDataGrid(g = {}) {
  const rows = [
    ['Quadra', g.block],
    ['Lote', g.lot],
    ['Gaveta', g.gaveta],
    ['Tipo do túmulo', g.tombType],
    ['Utilização', g.utilizacao],
    ['Permissão de carneira', g.carneiraPermission],
  ];
  const cells = rows
    .map(([k, v]) => `<div class="cell"><span class="k">${k}</span><span class="v">${dash(v)}</span></div>`)
    .join('');
  const obs = `<div class="cell obs"><span class="k">Observação</span><span class="v">${dash(g.observation)}</span></div>`;
  return `<div class="grid">${cells}${obs}</div>`;
}

// Bloco "Proprietário/Responsável" (dados completos).
function personBlock(p = {}) {
  const rows = [
    ['Nome', p.name],
    ['CPF', p.cpf],
    ['RG', p.rg],
    ['E-mail', p.email],
    ['Telefone', p.phone],
    ['Endereço', p.address],
    ['Estado', p.state],
    ['Cidade', p.city],
  ];
  const cells = rows
    .map(([k, v]) => `<div class="cell"><span class="k">${k}</span><span class="v">${dash(v)}</span></div>`)
    .join('');
  return `<div class="grid">${cells}</div>`;
}

const BASE_STYLE = (accent, accentDeep, accentSoft, accentBorder) => `
  *{box-sizing:border-box}
  body{font-family:"Times New Roman",Georgia,serif;max-width:820px;margin:0 auto;padding:34px 40px;color:#1f2933;font-size:13px;line-height:1.5}
  .orgao{display:flex;align-items:center;gap:16px;border-bottom:2px solid ${accent};padding-bottom:12px;margin-bottom:14px}
  .orgao .logo img{height:70px;width:auto;max-height:70px;display:block}
  .orgao .info{flex:1;text-align:center}
  .orgao .info .l1{font-size:15px;font-weight:bold;color:${accentDeep};text-transform:uppercase;letter-spacing:.4px;margin:0}
  .orgao .info .l2{font-size:12px;color:#3e4c59;margin:2px 0 0}
  .orgao .info .l3{font-size:11px;color:#52606d;margin:1px 0 0}
  .title-band{background:${accent};color:#fff;text-align:center;font-size:17px;font-weight:bold;letter-spacing:1px;padding:8px 10px;border-radius:3px;text-transform:uppercase;margin:10px 0 6px}
  .cem-band{text-align:center;font-size:13px;font-weight:bold;color:${accentDeep};text-transform:uppercase;margin:4px 0 2px}
  .num-band{text-align:center;font-size:12px;color:#52606d;margin:0 0 16px}
  .num-band b{color:${accent}}
  section{margin:16px 0}
  h2{font-size:12px;text-transform:uppercase;letter-spacing:.6px;color:${accentDeep};border-bottom:1px solid ${accentBorder};padding-bottom:4px;margin:0 0 8px}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:6px 18px}
  .cell{display:flex;flex-direction:column;padding:5px 8px;background:${accentSoft};border-radius:3px}
  .cell.obs{grid-column:1 / -1}
  .cell .k{font-size:9.5px;text-transform:uppercase;letter-spacing:.4px;color:#7b8794;font-weight:bold}
  .cell .v{font-size:13px;color:#1f2933}
  .loc{display:flex;gap:16px;align-items:stretch}
  .loc .box{flex:1;border:1px solid ${accentBorder};border-radius:4px;padding:8px;display:flex;flex-direction:column}
  .loc .box .cap{font-size:9.5px;text-transform:uppercase;letter-spacing:.4px;color:#7b8794;font-weight:bold;margin-bottom:6px}
  .loc .croqui svg{width:100%;height:auto}
  .loc .photo{align-items:center;justify-content:center}
  .loc .photo img{max-width:100%;max-height:160px;border-radius:3px}
  .loc .photo .frame{width:100%;min-height:150px;border:1px dashed ${accentBorder};border-radius:3px;display:flex;align-items:center;justify-content:center;color:#9aa5b1;font-size:11px}
  table{width:100%;border-collapse:collapse;font-size:12px}
  th{background:${accent};color:#fff;text-align:left;padding:6px 8px;font-size:10.5px;text-transform:uppercase;letter-spacing:.3px}
  td{padding:6px 8px;border-bottom:1px solid #e4e7eb}
  td.empty{text-align:center;color:#9aa5b1;font-style:italic}
  .legal{font-size:12px;line-height:1.7;text-align:justify;color:#3e4c59;white-space:pre-line}
  .venc{display:grid;grid-template-columns:1fr 1fr;gap:6px 18px}
  footer{margin-top:34px}
  footer .city-date{text-align:right;font-size:12px;margin-bottom:36px}
  .signs{display:flex;gap:40px;justify-content:space-around;margin-top:20px}
  .signs .sign{flex:1;text-align:center}
  .signs .sign .line{border-top:1px solid #52606d;margin:0 10px 4px}
  .signs .sign .role{font-size:11px;color:#52606d}
  .org-addr{margin-top:30px;padding-top:10px;border-top:1px solid ${accentBorder};text-align:center;font-size:10px;color:#7b8794;line-height:1.5}
`;

/**
 * Monta o HTML oficial de um documento a partir do contexto resolvido.
 * @param {'certidao_perpetuidade'|'autorizacao_sepultamento'} documentType
 * @param {object} ctx  contexto rico (ver documents.service.buildOfficialContext)
 */
function renderOfficial(documentType, ctx) {
  const b = ctx.brand || {};
  const accent = b.accent || '#032e59';
  const accentDeep = b.accent_deep || '#021d38';
  const accentSoft = b.accent_soft || 'rgba(3,46,89,.08)';
  const accentBorder = b.accent_border || 'rgba(3,46,89,.32)';

  const isCertidao = documentType === 'certidao_perpetuidade';
  const title = isCertidao ? 'CERTIDÃO DE PERPETUIDADE' : 'AUTORIZAÇÃO DE SEPULTAMENTO';
  const numberLabel = isCertidao ? 'Certidão de nº' : 'Autorização de nº';
  const personTitle = isCertidao ? 'Proprietário / Responsável' : 'Responsável pelo Sepultado';

  const cabecalhoLinhas = [b.orgao_cabecalho, b.orgao_endereco]
    .filter(Boolean)
    .map((l) => `<p class="l3">${escapeHtml(l)}</p>`)
    .join('');

  const photoBlock = ctx.photoTag
    ? ctx.photoTag
    : '<div class="frame">Sem foto da sepultura</div>';

  return [
    '<!doctype html>',
    '<html lang="pt-BR">',
    '<head>',
    '<meta charset="utf-8">',
    `<title>${escapeHtml(title)} ${escapeHtml(ctx.formattedNumber || '')}</title>`,
    `<style>${BASE_STYLE(accent, accentDeep, accentSoft, accentBorder)}</style>`,
    '</head>',
    '<body>',
    // Cabeçalho do órgão
    '<header class="orgao">',
    `<div class="logo">${b.logo_tag || ''}</div>`,
    '<div class="info">',
    `<p class="l1">${escapeHtml(b.orgao_nome || 'Prefeitura Municipal')}</p>`,
    cabecalhoLinhas,
    '</div>',
    '</header>',
    // Faixas título
    `<div class="title-band">${escapeHtml(title)}</div>`,
    `<div class="cem-band">Cemitério ${escapeHtml(ctx.cemeteryName || '—')}</div>`,
    `<div class="num-band">${numberLabel}: <b>${escapeHtml(ctx.formattedNumber || '—')}</b></div>`,
    // Dados da sepultura
    '<section>',
    '<h2>Dados da sepultura</h2>',
    graveDataGrid(ctx.grave || {}),
    '</section>',
    // Croqui + Foto
    '<section>',
    '<h2>Localização</h2>',
    '<div class="loc">',
    `<div class="box croqui"><span class="cap">Croqui de localização</span>${ctx.croquiSvg || ''}</div>`,
    `<div class="box photo"><span class="cap">Foto da sepultura</span>${photoBlock}</div>`,
    '</div>',
    '</section>',
    // Relação de sepultados
    '<section>',
    '<h2>Relação de sepultados</h2>',
    '<table><thead><tr><th>Nome</th><th>CPF</th><th>Data de sepultamento</th><th>Data de falecimento</th></tr></thead>',
    `<tbody>${deceasedRows(ctx.deceasedList || [])}</tbody></table>`,
    '</section>',
    // Proprietário / Responsável
    '<section>',
    `<h2>${escapeHtml(personTitle)}</h2>`,
    personBlock(ctx.responsible || {}),
    '</section>',
    // Texto legal (título fiel ao documento oficial)
    '<section>',
    `<h2>${isCertidao ? 'Responsabilidade do proprietário(a)' : 'Obrigações do responsável pelo falecido(a)'}</h2>`,
    `<div class="legal">${escapeHtml(ctx.legalText || '')}</div>`,
    '</section>',
    // Vencimento da concessão
    '<section>',
    `<h2>${isCertidao ? 'Vencimento da concessão perpétuo' : 'Vencimento da concessão'}</h2>`,
    '<div class="venc">',
    `<div class="cell"><span class="k">Data da permissão</span><span class="v">${fmtDate(ctx.concessionStartDate)}</span></div>`,
    `<div class="cell"><span class="k">Data do vencimento</span><span class="v">${ctx.concessionEndDate ? fmtDate(ctx.concessionEndDate) : 'Perpétua / não se aplica'}</span></div>`,
    '</div>',
    '</section>',
    // Rodapé
    '<footer>',
    `<p class="city-date">${escapeHtml(cityDateExtenso(b.orgao_cidade, ctx.issuedAt))}</p>`,
    '<div class="signs">',
    '<div class="sign"><div class="line">&nbsp;</div><div class="role">Responsável pela Sepultura</div></div>',
    `<div class="sign"><div class="line">&nbsp;</div><div class="role">${escapeHtml(b.orgao_nome || 'Secretaria Municipal')}</div></div>`,
    '</div>',
    `<div class="org-addr">${escapeHtml(b.orgao_nome || '')}${b.orgao_endereco ? ` · ${escapeHtml(b.orgao_endereco)}` : ''}`
      + `${b.orgao_cnpj ? `<br>CNPJ ${escapeHtml(b.orgao_cnpj)}` : ''}`
      + `${b.orgao_telefone ? ` · ${escapeHtml(b.orgao_telefone)}` : ''}${b.orgao_email ? ` · ${escapeHtml(b.orgao_email)}` : ''}</div>`,
    '</footer>',
    '</body>',
    '</html>',
  ].join('\n');
}

// Tipos que possuem layout oficial próprio.
const OFFICIAL_TYPES = ['certidao_perpetuidade', 'autorizacao_sepultamento'];

module.exports = {
  renderOfficial,
  croquiSvg,
  escapeHtml,
  fmtDate,
  OFFICIAL_TYPES,
};
