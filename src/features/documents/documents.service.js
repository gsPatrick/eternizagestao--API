'use strict';

const AppError = require('../../utils/app-error');
const { getPagination, buildPageMeta } = require('../../utils/pagination');
const { render } = require('../../utils/template');
const storage = require('../../providers/storage');
const pdf = require('../../providers/pdf');
const graveEvents = require('../grave-timeline/grave-event.recorder');
const audit = require('../audit-logs/audit.service');
const { nextNumber } = require('./document-number.helper');
const { brandingVars } = require('../../utils/tenant-branding');
const officialTemplates = require('./documents.templates');
const documentSettings = require('./documents.settings');
const {
  sequelize, Document, DocumentTemplate, DocumentSignature,
  Grave, Cemetery, Concession, Person, Burial, Deceased, User, Tenant,
  Lot, Street, Block, GraveStatus,
} = require('../../models');

// TTL longo para imagens/fotos assinadas embutidas no documento (fallback quando
// o arquivo não é local e não pode virar data URI).
const IMAGE_LINK_TTL_SECONDS = Number(process.env.DOCUMENT_LINK_TTL_SECONDS || 7 * 24 * 3600);

// TTL longo para o link do documento enviado por e-mail/whatsapp na emissão —
// a URL assinada precisa continuar válida quando o destinatário abrir.
const NOTIFY_LINK_TTL_SECONDS = Number(process.env.DOCUMENT_LINK_TTL_SECONDS || 7 * 24 * 3600);

// Formato do papel do PDF oficial (ver providers/pdf).
const PDF_FORMAT = process.env.DOCUMENT_PDF_FORMAT || 'A4';

// Includes leves para as listagens/detalhe: dão ao front o vínculo (sepultura/
// pessoa/sepultado), quem emitiu e o documento original (2ª via) sem N+1.
const LIST_INCLUDE = [
  { model: Grave, as: 'grave', attributes: ['id', 'code'] },
  { model: Person, as: 'person', attributes: ['id', 'fullName'] },
  { model: Deceased, as: 'deceased', attributes: ['id', 'fullName'] },
  { model: User, as: 'issuedBy', attributes: ['id', 'name'] },
  { model: Document, as: 'originalDocument', attributes: ['id', 'formattedNumber', 'documentType'] },
  // separate: evita multiplicação de linhas no findAndCountAll (hasMany).
  { model: DocumentSignature, as: 'signatures', separate: true, order: [['createdAt', 'DESC']] },
];

const DOCUMENT_TYPES = Document.rawAttributes.documentType.values;

const TYPE_TITLES = {
  certidao_perpetuidade: 'Certidão de Perpetuidade',
  autorizacao_sepultamento: 'Autorização de Sepultamento',
  autorizacao_exumacao: 'Autorização de Exumação',
  recibo: 'Recibo',
  declaracao: 'Declaração',
  outro: 'Documento',
};

// HTML oficial BRANDED usado quando o tenant não tem template para o tipo.
// Cabeçalho com a marca do órgão gestor: logo (embutida) + nome/CNPJ/contatos +
// faixa/realce na cor da cidade; rodapé com identificação. As mesmas variáveis
// ({{logo_tag}}/{{logo_url}}/{{tenant_name}}/{{orgao_*}}/{{accent*}}) também
// ficam disponíveis para os templates customizados do tenant.
// {{dataRows}} recebe o dump (tabela) dos dados principais da emissão.
const DEFAULT_HTML = [
  '<!doctype html>',
  '<html lang="pt-BR">',
  '<head>',
  '<meta charset="utf-8">',
  '<title>{{documentTitle}} {{formattedNumber}}</title>',
  '<style>',
  'body{font-family:Georgia,"Times New Roman",serif;max-width:760px;margin:0 auto;padding:40px 32px;color:#1f2933}',
  '.orgao{display:flex;align-items:center;gap:16px;border-bottom:3px solid {{accent}};padding-bottom:14px;margin-bottom:6px}',
  '.orgao .logo img{height:64px;width:auto;max-height:64px;display:block}',
  '.orgao .info{flex:1}',
  '.orgao .info .nome{font-size:18px;font-weight:bold;color:{{accent_deep}};letter-spacing:.3px;margin:0 0 2px}',
  '.orgao .info .meta{font-size:11px;color:#52606d;line-height:1.5}',
  '.faixa{height:6px;background:{{accent}};border-radius:3px;margin:0 0 26px}',
  'h1{font-size:22px;text-align:center;letter-spacing:.5px;margin:22px 0 4px;color:{{accent_deep}}}',
  '.number{text-align:center;color:#52606d;margin-bottom:28px}',
  '.number b{color:{{accent}}}',
  'table{width:100%;border-collapse:collapse}',
  'td{padding:9px 10px;border-bottom:1px solid #e4e7eb;vertical-align:top}',
  'td:first-child{font-weight:bold;width:38%;color:{{accent_deep}};background:{{accent_soft}}}',
  'footer{margin-top:52px;padding-top:14px;border-top:1px solid {{accent_border}};font-size:11px;color:#7b8794;text-align:center;line-height:1.6}',
  'footer .org{color:{{accent_deep}};font-weight:bold}',
  '</style>',
  '</head>',
  '<body>',
  '<header class="orgao">',
  '<div class="logo">{{logo_tag}}</div>',
  '<div class="info">',
  '<p class="nome">{{orgao_nome}}</p>',
  '<p class="meta">{{orgao_cabecalho}}</p>',
  '<p class="meta">{{orgao_endereco}}</p>',
  '<p class="meta">CNPJ {{orgao_cnpj}} · {{orgao_telefone}} · {{orgao_email}}</p>',
  '</div>',
  '</header>',
  '<div class="faixa"></div>',
  '<h1>{{documentTitle}}</h1>',
  '<p class="number">Documento nº <b>{{formattedNumber}}</b></p>',
  '<table>{{dataRows}}</table>',
  '<footer><span class="org">{{orgao_nome}}</span><br>Documento nº {{formattedNumber}} · emitido em {{issuedAt}}.</footer>',
  '</body>',
  '</html>',
].join('\n');

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Dump legível dos dados principais da emissão (para o DEFAULT_HTML).
function buildDataRows(data = {}) {
  return Object.entries(data)
    .filter(([, value]) => value !== undefined && value !== null && typeof value !== 'object')
    .map(([key, value]) => `<tr><td>${escapeHtml(key)}</td><td>${escapeHtml(value)}</td></tr>`)
    .join('\n');
}

// Extensão → mime, para embutir a logo como data URI (documento auto-contido).
const LOGO_MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
};

// Marca do documento a partir do Tenant: variáveis de branding + a logo já
// resolvida. Logo LOCAL (/files) é embutida como data URI (documento permanente,
// imune à expiração de URL assinada e compatível com a CSP img-src 'self' data:);
// logo externa (http) é mantida como URL. Sem logo → logo_tag vazio.
async function buildBrandContext(tenantId, transaction) {
  const tenant = await Tenant.findByPk(tenantId, { transaction });
  const brand = brandingVars(tenant);

  let logoSrc = brand.logo_url; // externa por padrão
  const localLogo = storage.readLocalFile(brand.logo_url);
  if (localLogo) {
    const ext = String(brand.logo_url).split('?')[0].split('.').pop().toLowerCase();
    const mime = LOGO_MIME[ext] || 'image/png';
    logoSrc = `data:${mime};base64,${localLogo.toString('base64')}`;
  }

  const logoTag = logoSrc
    ? `<img src="${logoSrc}" alt="${escapeHtml(brand.orgao_nome)}" />`
    : '';

  // logo_url passa a apontar para a fonte resolvida (data URI quando local), de
  // modo que templates customizados com {{logo_url}} também renderizem a logo.
  return { ...brand, logo_url: logoSrc, logo_tag: logoTag };
}

// Embute uma imagem (foto da sepultura/sepultado) como <img>. Arquivo LOCAL vira
// data URI (documento auto-contido, imune à expiração da URL); imagem externa
// (http) fica como URL; ausente → ''. Usada no bloco "Foto da sepultura".
function embedImage(url, alt = 'Foto da sepultura') {
  if (!url) return '';
  if (/^(https?:)?\/\//i.test(url) || String(url).startsWith('data:')) {
    return `<img src="${url}" alt="${officialTemplates.escapeHtml(alt)}" />`;
  }
  const local = storage.readLocalFile(url);
  if (local) {
    const ext = String(url).split('?')[0].split('.').pop().toLowerCase();
    const mime = LOGO_MIME[ext] || 'image/jpeg';
    return `<img src="data:${mime};base64,${local.toString('base64')}" alt="${officialTemplates.escapeHtml(alt)}" />`;
  }
  // Arquivo protegido não-local: cai na URL assinada (TTL longo).
  const signed = storage.signedUrl(url, { ttlSeconds: IMAGE_LINK_TTL_SECONDS });
  return signed ? `<img src="${signed}" alt="${officialTemplates.escapeHtml(alt)}" />` : '';
}

// Mapeia uma Person → bloco de dados completos do responsável/proprietário.
function personToBlock(person) {
  if (!person) return {};
  const addr = [person.addressStreet, person.addressNumber, person.addressComplement, person.addressDistrict]
    .filter(Boolean).join(', ');
  return {
    name: person.fullName,
    cpf: person.cpf,
    rg: person.rg,
    email: person.email,
    phone: person.phonePrimary || person.whatsapp || person.phoneSecondary,
    address: addr,
    state: person.addressState,
    city: person.addressCity,
  };
}

/**
 * CONTEXTO RICO dos modelos oficiais — resolve TUDO que os PDFs do cliente
 * exigem: sepultura + estrutura quadra/lote, sepultados do jazigo, concessão/
 * proprietário (ou responsável pelo sepultado), datas de vigência, croqui SVG,
 * foto e o texto legal por cidade. Rodado DENTRO da transação de emissão.
 */
async function buildOfficialContext(
  { tenantId, documentType, graveId, referenceType, referenceId, brand, issuedAt, formattedNumber },
  transaction
) {
  const tenant = await Tenant.findByPk(tenantId, { transaction });
  const legalText = documentSettings.legalTextFor(tenant, documentType);

  // Sepultura + estrutura física + cemitério + status.
  let grave = null;
  if (graveId) {
    grave = await Grave.findOne({
      where: { id: graveId, tenantId },
      include: [
        { model: Lot, as: 'lot', include: [{ model: Street, as: 'street', include: [{ model: Block, as: 'block' }] }] },
        { model: Cemetery, as: 'cemetery', attributes: ['id', 'name', 'addressCity', 'addressState'] },
        { model: GraveStatus, as: 'status', attributes: ['id', 'name', 'slug'] },
      ],
      transaction,
    });
  }

  const block = grave?.lot?.street?.block || null;
  const street = grave?.lot?.street || null;
  const lot = grave?.lot || null;
  const blockLabel = block ? (block.name || block.code) : null;
  const streetLabel = street ? (street.name || street.code) : null;
  const lotLabel = lot ? (lot.code || lot.name) : null;

  // Concessão ativa (proprietário/responsável) + person.
  let concession = null;
  if (graveId) {
    concession = await Concession.findOne({
      where: { graveId, tenantId, status: 'ativa' },
      include: [{ model: Person, as: 'person' }],
      order: [['startDate', 'DESC']],
      transaction,
    });
  }

  // Sepultamento referenciado (autorização) — para responsável (declarante) e foto.
  let refBurial = null;
  if (referenceType === 'burial' && referenceId) {
    refBurial = await Burial.findOne({
      where: { id: referenceId, tenantId },
      include: [
        { model: Deceased, as: 'deceased' },
        { model: Person, as: 'declarant', attributes: ['id', 'fullName', 'cpf', 'rg', 'email', 'phonePrimary', 'whatsapp', 'addressStreet', 'addressNumber', 'addressComplement', 'addressDistrict', 'addressCity', 'addressState'] },
      ],
      transaction,
    }).catch(() => null); // associação 'declarant' pode não existir — degrada sem quebrar
  }

  // Relação de sepultados do jazigo (unidade + gavetas filhas), sepultamentos ativos.
  let deceasedList = [];
  if (graveId) {
    const children = await Grave.findAll({ where: { parentGraveId: graveId, tenantId }, attributes: ['id'], transaction });
    const graveIds = [graveId, ...children.map((c) => c.id)];
    const burials = await Burial.findAll({
      where: { tenantId, graveId: graveIds, status: 'ativo' },
      include: [{ model: Deceased, as: 'deceased', attributes: ['id', 'fullName', 'cpf', 'deathDate', 'photoUrl'] }],
      order: [['burialDate', 'DESC']],
      transaction,
    });
    deceasedList = burials.map((bu) => ({
      name: bu.deceased?.fullName,
      cpf: bu.deceased?.cpf,
      burialDate: bu.burialDate,
      deathDate: bu.deceased?.deathDate,
    }));
  }

  // Responsável: autorização → declarante do sepultamento (se houver); senão o
  // concessionário titular. Certidão → concessionário titular.
  const responsiblePerson = (documentType === 'autorizacao_sepultamento' && refBurial?.declarant)
    ? refBurial.declarant
    : concession?.person || null;

  // Foto: da sepultura; senão do sepultado referenciado.
  const photoUrl = grave?.photoUrl || refBurial?.deceased?.photoUrl || null;

  return {
    brand,
    documentType,
    formattedNumber,
    issuedAt,
    cemeteryName: grave?.cemetery?.name,
    grave: {
      block: blockLabel,
      street: streetLabel,
      lot: lotLabel,
      gaveta: grave?.unitType === 'gaveta' ? grave.code : null,
      tombType: grave?.tombType,
      utilizacao: grave?.utilizacao,
      carneiraPermission: grave?.carneiraPermission,
      observation: grave?.notes,
    },
    croquiSvg: officialTemplates.croquiSvg({
      blockCode: blockLabel || '01',
      lotCode: lotLabel || '01',
      accent: brand.accent,
    }),
    photoTag: embedImage(photoUrl),
    deceasedList,
    responsible: personToBlock(responsiblePerson),
    legalText,
    concessionStartDate: concession?.startDate,
    concessionEndDate: concession?.endDate,
  };
}

// Template explícito (do tenant) ou o ativo mais recente do tipo — pode não existir.
async function resolveTemplate(tenantId, documentType, templateId, transaction) {
  if (templateId) {
    const template = await DocumentTemplate.findOne({ where: { id: templateId, tenantId }, transaction });
    if (!template) throw AppError.notFound('Modelo de documento não encontrado.');
    return template;
  }
  return DocumentTemplate.findOne({
    where: { tenantId, documentType, active: true },
    order: [['version', 'DESC'], ['createdAt', 'DESC']],
    transaction,
  });
}

// Notificação de emissão (fire-and-forget) — disparada FORA da transação de
// emissão, pelo choke point createIssuedDocument (cobre emissão e 2ª via).
// Contrato do motor de notificações: notifications.notify({...}) enfileira/envia.
// Nunca bloqueia nem derruba a emissão: sem destinatário/contato apenas não
// dispara; qualquer erro é engolido (try/catch).
function notifyDocumentIssued(document) {
  (async () => {
    try {
      if (!document || !document.personId) return; // sem pessoa vinculada — não notifica
      const person = await Person.findOne({
        where: { id: document.personId, tenantId: document.tenantId },
        attributes: ['id', 'fullName', 'email', 'whatsapp', 'phonePrimary'],
      });
      if (!person) return;

      const hasEmail = !!person.email;
      const hasWhatsapp = !!(person.whatsapp || person.phonePrimary);
      if (!hasEmail && !hasWhatsapp) return; // sem contato resolvível — não notifica (sem erro)
      const channel = hasEmail ? 'email' : 'whatsapp'; // e-mail se houver, senão whatsapp

      const notifications = require('../notifications/notifications.service');
      await notifications.notify({
        tenantId: document.tenantId,
        personId: person.id,
        channel,
        notificationType: 'documento_emitido',
        template: 'document-issued',
        vars: {
          nome: person.fullName,
          tipo_documento: TYPE_TITLES[document.documentType] || 'Documento',
          numero: document.formattedNumber,
          // Link assinado (TTL longo) — o destinatário abre sem sessão. Aponta
          // para o PDF oficial; cai no HTML quando o PDF não foi gerado.
          cta_url: storage.signedUrl(document.pdfUrl || document.fileUrl, { ttlSeconds: NOTIFY_LINK_TTL_SECONDS }),
        },
        referenceType: 'documents',
        referenceId: document.id,
      });
    } catch (err) {
      // Contrato: notificação nunca propaga erro ao fluxo de emissão.
      console.error('[documents] notificação de emissão falhou:', err.message);
    }
  })();
}

/* ============================ PDF oficial ============================ */
// O documento sai em PDF fiel ao HTML BRANDED. O provider (providers/pdf) tem
// abstração de driver (puppeteer → fallback) e NUNCA lança: a geração aqui é
// SEMPRE best-effort — se falhar, mantém o HTML e loga, sem derrubar a emissão.
//
// PDF DEGRADADO (endurecimento):
// -----------------------------------------------------------------------------
// Quando o Chromium não está disponível/falha, o provider degrada para o driver
// `fallback`, que produz um PDF VÁLIDO (começa com `%PDF-`) mas SEM layout, SEM
// logotipo e SEM cores — um documento oficial visualmente pobre. A validação
// antiga (só o header `%PDF-`) NÃO distinguia o fiel do degradado, e como
// `ensureDocumentPdf` gerava uma única vez, uma certidão degradada ficava assim
// para sempre. Agora:
//   1) descobrimos qual driver realmente produziu os bytes (assinatura do
//      arquivo, ver `detectPdfDriver`) e REGISTRAMOS em `document.pdfDriver`,
//      permitindo auditar/reemitir depois (ex.: WHERE pdf_driver = 'fallback');
//   2) um PDF de fallback NÃO é definitivo: a próxima chamada tenta gerar o
//      fiel de novo (quando o driver fiel voltar a estar disponível).

// Driver que produz o PDF DEGRADADO (sem layout/logo/cores).
const PDF_DRIVER_DEGRADED = 'fallback';

/**
 * Descobre qual driver gerou os bytes do PDF, pela assinatura do arquivo —
 * o provider não devolve essa informação junto do Buffer (e `resolveDriverName`
 * só diz quem *atenderia agora*, não quem atendeu; uma falha de launch do
 * Chromium cai no fallback sem mudar o nome resolvido).
 *   - Chromium/Puppeteer imprime via Skia → `/Producer (Skia/PDF m###)`.
 *   - Nosso fallback monta o PDF à mão: sem `/Producer`, Helvetica base-14.
 * @returns {'puppeteer'|'fallback'|string}
 */
function detectPdfDriver(buffer) {
  const bytes = buffer.toString('latin1');
  if (bytes.includes('Skia/PDF')) return 'puppeteer';
  if (bytes.includes('/BaseFont /Helvetica') && !bytes.includes('/Producer')) {
    return PDF_DRIVER_DEGRADED;
  }
  // Driver novo/desconhecido: registra o que o provider diz estar ativo.
  return typeof pdf.resolveDriverName === 'function' ? pdf.resolveDriverName() : 'desconhecido';
}

// Gera o PDF a partir do HTML branded e o armazena (.pdf por tenant). Devolve o
// fileUrl do PDF + o driver que efetivamente o produziu.
async function generateAndStorePdf(document, html) {
  const buffer = await pdf.htmlToPdf(html, { format: PDF_FORMAT });
  if (!buffer || !buffer.length || buffer.slice(0, 5).toString() !== '%PDF-') {
    throw new Error('geração de PDF não produziu um arquivo válido');
  }
  const pdfDriver = detectPdfDriver(buffer);
  const file = await storage.saveFile({
    tenantId: document.tenantId,
    fileName: `${document.documentType}-${document.number}-${document.year}.pdf`,
    content: buffer,
    mimeType: 'application/pdf',
  });
  return { pdfUrl: file.fileUrl, pdfDriver, buffer };
}

// Garante o pdfUrl do documento (gera+armazena+persiste se ainda não houver).
// Best-effort: qualquer falha é logada e devolve o pdfUrl atual (possivelmente null).
// Um PDF já gerado pelo driver DEGRADADO não é considerado definitivo: tentamos
// gerar o fiel de novo (só quando o driver fiel voltou a estar disponível — senão
// gastaríamos CPU a cada chamada para reproduzir o mesmo fallback).
async function ensureDocumentPdf(document, html) {
  if (document.pdfUrl && !shouldRegeneratePdf(document)) return document.pdfUrl;
  try {
    const { pdfUrl, pdfDriver } = await generateAndStorePdf(document, html);
    if (document.pdfUrl && pdfDriver === PDF_DRIVER_DEGRADED) {
      // Continua degradado: mantém o que já existe e não reescreve o arquivo.
      return document.pdfUrl;
    }
    if (pdfDriver === PDF_DRIVER_DEGRADED) {
      console.warn(
        `[documents] PDF do documento ${document.formattedNumber} gerado em modo DEGRADADO `
        + '(sem layout/logo): Chromium indisponível. Registrado em pdf_driver para reemissão.'
      );
    }
    // skipAudit: gravação técnica do artefato, não é uma ação semântica auditável.
    await document.update({ pdfUrl, pdfDriver }, { skipAudit: true });
    return pdfUrl;
  } catch (err) {
    console.error('[documents] geração de PDF falhou (mantendo HTML):', err.message);
    return document.pdfUrl || null;
  }
}

/**
 * O PDF armazenado é degradado E o driver fiel voltou a estar disponível?
 * Nesse caso vale a pena tentar regerar (documento oficial merece o layout fiel).
 * Documentos antigos (pdfDriver null, anteriores a este campo) NÃO são regerados:
 * não sabemos como foram feitos e reemissão é decisão de operação, não automática.
 */
function shouldRegeneratePdf(document) {
  if (document.pdfDriver !== PDF_DRIVER_DEGRADED) return false;
  const available = typeof pdf.resolveDriverName === 'function' ? pdf.resolveDriverName() : null;
  return Boolean(available) && available !== PDF_DRIVER_DEGRADED;
}

// Recupera o HTML branded persistido de um documento (fonte para (re)gerar o PDF).
function readDocumentHtml(document) {
  const buf = storage.readLocalFile(document.fileUrl);
  return buf ? buf.toString('utf8') : null;
}

// Núcleo da emissão — compartilhado por issueDocument e reissue.
async function createIssuedDocument(
  {
    tenantId, documentType, templateId = null, data = {},
    referenceType = null, referenceId = null,
    graveId = null, deceasedId = null, personId = null, userId = null,
    notes = null,
  },
  { originalDocumentId = null, reissueCount = 0 } = {}
) {
  if (!DOCUMENT_TYPES.includes(documentType)) {
    throw AppError.badRequest(
      `documentType inválido. Permitidos: ${DOCUMENT_TYPES.join(', ')}`,
      'INVALID_ENUM_VALUE'
    );
  }

  let brandedHtml = null; // HTML branded desta emissão — reaproveitado para o PDF
  const issuedDocument = await sequelize.transaction(async (transaction) => {
    const year = new Date().getFullYear();
    const { number, formattedNumber } = await nextNumber({ tenantId, documentType, year, transaction });
    const template = await resolveTemplate(tenantId, documentType, templateId, transaction);
    // Marca do órgão gestor (logo/cores/nome/CNPJ/contatos) — vale para o
    // DEFAULT_HTML e para os templates customizados do tenant.
    const brand = await buildBrandContext(tenantId, transaction);

    const issuedAt = new Date();
    const issuedAtLabel = issuedAt.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

    let html;
    // MODELO OFICIAL fiel ao PDF: usado por padrão nos tipos oficiais. Só é
    // preterido quando o emissor ESCOLHE explicitamente um template (templateId)
    // — os placeholders auto-resolvidos do tenant não sobrescrevem o layout.
    const usedOfficial = !templateId && officialTemplates.OFFICIAL_TYPES.includes(documentType);
    if (usedOfficial) {
      const ctx = await buildOfficialContext(
        { tenantId, documentType, graveId, referenceType, referenceId, brand, issuedAt, formattedNumber },
        transaction
      );
      html = officialTemplates.renderOfficial(documentType, ctx);
    } else {
      // Template customizado do tenant OU DEFAULT_HTML — placeholders {{...}}.
      // Expõe {{texto_legal}} (fundamentação legal por cidade) também aqui.
      const tenant = await Tenant.findByPk(tenantId, { transaction });
      html = render(template?.bodyHtml || DEFAULT_HTML, {
        ...brand,
        ...data,
        documentTitle: TYPE_TITLES[documentType] || 'Documento',
        formattedNumber,
        issuedAt: issuedAtLabel,
        texto_legal: documentSettings.legalTextFor(tenant, documentType),
        dataRows: buildDataRows(data),
      });
    }
    brandedHtml = html;

    const file = await storage.saveFile({
      tenantId,
      fileName: `${documentType}-${number}-${year}.html`,
      content: Buffer.from(html),
      mimeType: 'text/html',
    });

    const document = await Document.create(
      {
        tenantId,
        // Não vincula o placeholder auto-resolvido quando o layout OFICIAL foi
        // usado — senão a 2ª via reenviaria templateId e pularia o oficial.
        templateId: usedOfficial ? null : (template?.id || null),
        documentType,
        number,
        year,
        formattedNumber,
        referenceType,
        referenceId,
        graveId,
        deceasedId,
        personId,
        fileUrl: file.fileUrl,
        status: 'emitido',
        issuedByUserId: userId,
        issuedAt,
        originalDocumentId,
        reissueCount,
        notes,
      },
      // skipAudit: o hook genérico logaria 'criacao'; registramos o semântico
      // 'emissao_documento' explicitamente abaixo (vale p/ emissão e 2ª via).
      { transaction, skipAudit: true }
    );

    if (graveId) {
      await graveEvents.record(
        {
          tenantId,
          graveId,
          eventType: 'documento_emitido',
          title: `${TYPE_TITLES[documentType] || 'Documento'} nº ${formattedNumber} emitido`,
          referenceType: 'document',
          referenceId: document.id,
          metadata: { documentType, formattedNumber, reissue: reissueCount > 0 },
          occurredAt: issuedAt,
          userId,
        },
        { transaction }
      );
    }

    // Auditoria semântica — emissão (inclui reemissão de 2ª via).
    audit.record({
      action: 'emissao_documento',
      entityType: 'Documento',
      entityId: document.id,
      description: `${TYPE_TITLES[documentType] || 'Documento'} ${formattedNumber} emitido`,
      newData: {
        numero: document.formattedNumber,
        tipo: document.documentType,
        ref: referenceType && referenceId ? `${referenceType}:${referenceId}` : null,
      },
    });

    return document;
  });

  // PDF oficial — fora da transação (render pesado/externo). Best-effort: se
  // falhar, o documento segue válido só com o HTML. Preenche document.pdfUrl.
  await ensureDocumentPdf(issuedDocument, brandedHtml);

  // Notificação 'documento_emitido' — fora da transação; fire-and-forget: falha
  // nunca bloqueia/derruba a emissão. Cobre emissão e reemissão (2ª via).
  // O link entregue à família aponta para o PDF (cai no HTML se o PDF faltar).
  notifyDocumentIssued(issuedDocument);

  return issuedDocument;
}

/**
 * CONTRATO PÚBLICO — usado também por outras features (ex.: payments/recibos).
 * Cria a própria transação e devolve o Document emitido.
 */
async function issueDocument({
  tenantId, documentType, templateId = null, data = {},
  referenceType = null, referenceId = null,
  graveId = null, deceasedId = null, personId = null, userId = null,
  notes = null,
} = {}) {
  return createIssuedDocument({
    tenantId, documentType, templateId, data,
    referenceType, referenceId, graveId, deceasedId, personId, userId, notes,
  });
}

// Enriquecimento automático de `data` para as emissões específicas do briefing.
async function buildIssuePayload(tenantId, body) {
  // O front coleta a sepultura como CÓDIGO livre (o design não usa picker de id).
  // Resolvemos o código → graveId quando existir, habilitando o enriquecimento
  // (certidão) e o evento na linha do tempo da sepultura. Código sem match é
  // simplesmente ignorado (texto livre) — nunca derruba a emissão.
  let graveId = body.graveId || null;
  if (!graveId && body.graveCode) {
    const g = await Grave.findOne({
      where: { code: body.graveCode, tenantId },
      attributes: ['id'],
    });
    if (g) graveId = g.id;
  }

  const payload = {
    documentType: body.documentType,
    templateId: body.templateId || null,
    data: { ...(body.data || {}) },
    referenceType: body.referenceType || null,
    referenceId: body.referenceId || null,
    graveId,
    deceasedId: body.deceasedId || null,
    personId: body.personId || null,
    // Vínculo legível (ex.: "Jazigo A-12 · João Silva") para exibição/auditoria
    // quando não há associação formal (pessoa/sepultado em texto livre).
    notes: body.notes || null,
  };

  if (body.documentType === 'certidao_perpetuidade' && graveId) {
    const grave = await Grave.findOne({
      where: { id: graveId, tenantId },
      include: [
        { model: Cemetery, as: 'cemetery', attributes: ['id', 'name', 'addressCity', 'addressState'] },
        {
          model: Concession, as: 'concessions', where: { status: 'ativa' }, required: false,
          include: [{ model: Person, as: 'person', attributes: ['id', 'fullName', 'cpf'] }],
        },
      ],
    });
    if (!grave) throw AppError.notFound('Sepultura não encontrada.');
    const concession = grave.concessions?.[0] || null;

    payload.data = {
      graveCode: grave.code,
      cemeteryName: grave.cemetery?.name,
      cemeteryCity: grave.cemetery ? `${grave.cemetery.addressCity || ''}${grave.cemetery.addressState ? ` - ${grave.cemetery.addressState}` : ''}` : undefined,
      concessionHolderName: concession?.person?.fullName,
      concessionHolderCpf: concession?.person?.cpf,
      concessionContractNumber: concession?.contractNumber,
      concessionType: concession?.concessionType,
      concessionStartDate: concession?.startDate,
      ...payload.data, // dados explícitos do cliente têm prioridade
    };
    if (!payload.personId && concession) payload.personId = concession.personId;
  }

  if (
    body.documentType === 'autorizacao_sepultamento'
    && body.referenceType === 'burial'
    && body.referenceId
  ) {
    const burial = await Burial.findOne({
      where: { id: body.referenceId, tenantId },
      include: [
        { model: Deceased, as: 'deceased', attributes: ['id', 'fullName', 'cpf', 'deathDate'] },
        { model: Grave, as: 'grave', attributes: ['id', 'code'] },
        { model: Cemetery, as: 'cemetery', attributes: ['id', 'name'] },
      ],
    });
    if (!burial) throw AppError.notFound('Sepultamento não encontrado.');

    payload.data = {
      deceasedName: burial.deceased?.fullName,
      deceasedCpf: burial.deceased?.cpf,
      deathDate: burial.deceased?.deathDate,
      burialDate: burial.burialDate,
      burialTime: burial.burialTime,
      graveCode: burial.grave?.code,
      cemeteryName: burial.cemetery?.name,
      funeralHome: burial.funeralHome,
      ...payload.data,
    };
    if (!payload.graveId) payload.graveId = burial.graveId;
    if (!payload.deceasedId) payload.deceasedId = burial.deceasedId;
  }

  return payload;
}

// Emissão via POST /documents (com enriquecimento automático).
async function issueFromRequest(tenantId, body, userId) {
  const payload = await buildIssuePayload(tenantId, body);
  return issueDocument({ tenantId, ...payload, userId });
}

async function getById(tenantId, id) {
  const document = await Document.findOne({
    where: { id, tenantId },
    include: [
      ...LIST_INCLUDE,
      { model: DocumentTemplate, as: 'template', attributes: ['id', 'name', 'documentType', 'version'] },
    ],
  });
  if (!document) throw AppError.notFound('Documento não encontrado.');
  return document;
}

async function list(tenantId, query) {
  const { page, perPage, limit, offset } = getPagination(query, { defaultPerPage: 30 });
  const where = { tenantId };
  if (query.documentType) where.documentType = query.documentType;
  if (query.year) where.year = parseInt(query.year, 10);
  if (query.graveId) where.graveId = query.graveId;
  if (query.deceasedId) where.deceasedId = query.deceasedId;
  if (query.personId) where.personId = query.personId;
  if (query.status) where.status = query.status;

  const { rows, count } = await Document.findAndCountAll({
    where, limit, offset, order: [['issuedAt', 'DESC']],
    include: LIST_INCLUDE,
  });
  return { rows, meta: buildPageMeta(count, page, perPage) };
}

// 2ª via: nova emissão (novo número) copiando tipo/refs; o original permanece válido.
async function reissue(tenantId, id, userId) {
  const original = await Document.findOne({ where: { id, tenantId } });
  if (!original) throw AppError.notFound('Documento não encontrado.');

  return createIssuedDocument(
    {
      tenantId,
      documentType: original.documentType,
      templateId: original.templateId,
      data: {
        originalFormattedNumber: original.formattedNumber,
        segundaVia: 'Sim',
      },
      referenceType: original.referenceType,
      referenceId: original.referenceId,
      graveId: original.graveId,
      deceasedId: original.deceasedId,
      personId: original.personId,
      notes: original.notes,
      userId,
    },
    { originalDocumentId: original.id, reissueCount: original.reissueCount + 1 }
  );
}

async function cancel(tenantId, id, reason) {
  const document = await Document.findOne({ where: { id, tenantId } });
  if (!document) throw AppError.notFound('Documento não encontrado.');
  if (document.status === 'cancelado') {
    throw AppError.conflict('Documento já está cancelado.', 'DOCUMENT_ALREADY_CANCELED');
  }
  return document.update({
    status: 'cancelado',
    canceledAt: new Date(),
    notes: reason
      ? `${document.notes ? `${document.notes}\n` : ''}Cancelamento: ${reason}`
      : document.notes,
  });
}

// Serializa um Document para a resposta HTTP trocando o fileUrl cru pela URL
// ASSINADA (o painel/visualizador recebe a URL pronta para abrir). Preserva os
// includes (toJSON). Não altera o contrato interno de issueDocument (que segue
// devolvendo a instância Sequelize para consumidores como payments/recibos).
function toResponse(doc) {
  if (!doc) return doc;
  const json = typeof doc.toJSON === 'function' ? doc.toJSON() : { ...doc };
  if (json.fileUrl) json.fileUrl = storage.signedUrl(json.fileUrl);
  // pdfUrl assinado (o painel oferece "Baixar PDF"). Ausente até o PDF existir.
  if (json.pdfUrl) json.pdfUrl = storage.signedUrl(json.pdfUrl);
  return json;
}

/**
 * Devolve os bytes do PDF oficial de um documento — GERA E CACHEIA sob demanda
 * (a partir do HTML branded persistido) quando ainda não existe. Nunca 500 por
 * falta de Chromium: o provider degrada para o fallback (PDF simples válido).
 * @returns {Promise<{ buffer: Buffer, document: Document }>}
 */
async function getOrCreatePdf(tenantId, id) {
  const document = await Document.findOne({ where: { id, tenantId } });
  if (!document) throw AppError.notFound('Documento não encontrado.');

  // Já existe o PDF armazenado (local) → serve direto. EXCETO se o armazenado
  // for o DEGRADADO (fallback) e o driver fiel já estiver disponível: aí vale
  // regerar, para o download entregar o documento oficial com layout/logo.
  if (document.pdfUrl && !shouldRegeneratePdf(document)) {
    const cached = storage.readLocalFile(document.pdfUrl);
    if (cached && cached.length) return { buffer: cached, document };
  }

  // (Re)gera do HTML branded persistido e cacheia (preenche pdfUrl/pdfDriver).
  const html = readDocumentHtml(document);
  if (!html) throw AppError.badRequest('HTML de origem do documento indisponível para gerar o PDF.');
  const buffer = await pdf.htmlToPdf(html, { format: PDF_FORMAT });
  const pdfDriver = detectPdfDriver(buffer);
  try {
    const file = await storage.saveFile({
      tenantId,
      fileName: `${document.documentType}-${document.number}-${document.year}.pdf`,
      content: buffer,
      mimeType: 'application/pdf',
    });
    await document.update({ pdfUrl: file.fileUrl, pdfDriver }, { skipAudit: true });
  } catch (err) {
    // Falha ao persistir não impede a entrega do PDF já gerado.
    console.error('[documents] cache do PDF falhou:', err.message);
  }
  return { buffer, document };
}

// Texto legal por cidade (tenant.settings.documents) — GET/PATCH da tela de Documentos.
async function getSettings(tenantId) {
  return documentSettings.getSettings(tenantId);
}
async function updateSettings(tenantId, body) {
  return documentSettings.updateSettings(tenantId, body);
}

module.exports = {
  issueDocument, issueFromRequest, reissue, cancel, list, getById,
  toResponse, getOrCreatePdf, DOCUMENT_TYPES,
  getSettings, updateSettings,
};
