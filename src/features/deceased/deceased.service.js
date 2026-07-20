'use strict';

const { Op } = require('sequelize');
const AppError = require('../../utils/app-error');
const storage = require('../../providers/storage');
const { getPagination, buildPageMeta } = require('../../utils/pagination');
const {
  sequelize, Deceased, Burial, Grave, GraveStatus, Lot, Street, Block,
  Exhumation, RemainsDeposit, OssuaryNiche, Ossuary, Concession, Person,
} = require('../../models');

// Foto do sepultado: aceita PNG/JPEG/WEBP; teto de 5 MB (foto de perfil).
const PHOTO_MIME_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
const PHOTO_MAX_BYTES = 5 * 1024 * 1024; // 5 MB

// TTL longo (7 dias) da URL assinada da foto devolvida ao painel via <img>.
const PHOTO_URL_TTL_SECONDS = Number(process.env.PHOTO_URL_TTL_SECONDS || 7 * 24 * 3600);

// Assina o photoUrl LOCAL (/files/...) p/ exibição via <img>; externo/vazio passa intacto.
function signPhoto(photoUrl) {
  return photoUrl ? storage.signedUrl(photoUrl, { ttlSeconds: PHOTO_URL_TTL_SECONDS }) : photoUrl;
}

// hierarquia física completa do jazigo atual (para exibir a "localização exata").
// parentGrave (belongsTo) permite montar "JAZIGO · GAVETA" sem multiplicar linhas.
const currentGraveInclude = {
  model: Grave, as: 'currentGrave',
  include: [
    { model: GraveStatus, as: 'status' },
    { model: Grave, as: 'parentGrave' },
    {
      model: Lot, as: 'lot',
      include: [{ model: Street, as: 'street', include: [{ model: Block, as: 'block' }] }],
    },
  ],
};

const EDITABLE_FIELDS = [
  'fullName', 'cpf', 'rg', 'birthDate', 'deathDate', 'deathTime', 'gender',
  'motherName', 'fatherName', 'birthplace', 'causeOfDeath', 'attendingPhysician',
  'deathCertificateNumber', 'deathCertificateRegistry', 'photoUrl', 'notes',
];

function buildListWhere(query) {
  const where = {};
  if (query.search) {
    where[Op.or] = [
      { fullName: { [Op.iLike]: `%${query.search}%` } },
      { cpf: { [Op.iLike]: `%${query.search}%` } },
    ];
  }
  if (query.deathFrom || query.deathTo) {
    where.deathDate = {};
    if (query.deathFrom) where.deathDate[Op.gte] = query.deathFrom;
    if (query.deathTo) where.deathDate[Op.lte] = query.deathTo;
  }
  if (query.currentLocationType) where.currentLocationType = query.currentLocationType;
  return where;
}

// Materializa o "Responsável" de cada sepultado da página SEM N+1:
//  1) concessionário titular (concessão ATIVA) do jazigo atual; na falta,
//  2) declarante do sepultamento (burial) mais recente do sepultado.
// Duas queries agrupadas, independentemente do tamanho da página.
async function attachResponsible(tenantId, rows) {
  if (!rows.length) return rows;

  const graveIds = [...new Set(rows.map((r) => r.currentGraveId).filter(Boolean))];
  const deceasedIds = rows.map((r) => r.id);

  // (1) titular por jazigo — concessão ativa mais recente vence (order DESC).
  const byGrave = new Map();
  if (graveIds.length) {
    const concessions = await Concession.findAll({
      where: { tenantId, graveId: { [Op.in]: graveIds }, status: 'ativa' },
      attributes: ['graveId', 'startDate'],
      include: [{ model: Person, as: 'person', attributes: ['id', 'fullName'] }],
      order: [['startDate', 'DESC']],
    });
    for (const c of concessions) {
      if (!byGrave.has(c.graveId) && c.person) {
        byGrave.set(c.graveId, { id: c.person.id, name: c.person.fullName });
      }
    }
  }

  // (2) fallback: declarante do sepultamento mais recente.
  const byDeceased = new Map();
  const burials = await Burial.findAll({
    where: { tenantId, deceasedId: { [Op.in]: deceasedIds }, declarantPersonId: { [Op.ne]: null } },
    attributes: ['deceasedId', 'burialDate'],
    include: [{ model: Person, as: 'declarant', attributes: ['id', 'fullName'] }],
    order: [['burialDate', 'DESC']],
  });
  for (const b of burials) {
    if (!byDeceased.has(b.deceasedId) && b.declarant) {
      byDeceased.set(b.deceasedId, { id: b.declarant.id, name: b.declarant.fullName });
    }
  }

  // (3) data do sepultamento mais recente (coluna "Sepultamento" da lista) —
  // uma agregação agrupada, sem N+1 e independente de declarante.
  const lastBurialByDeceased = new Map();
  const burialDates = await Burial.findAll({
    where: { tenantId, deceasedId: { [Op.in]: deceasedIds } },
    attributes: ['deceasedId', [sequelize.fn('MAX', sequelize.col('burial_date')), 'lastBurialDate']],
    group: ['deceased_id'],
    raw: true,
  });
  for (const b of burialDates) lastBurialByDeceased.set(b.deceasedId, b.lastBurialDate);

  return rows.map((r) => {
    const responsible = (r.currentGraveId && byGrave.get(r.currentGraveId)) || byDeceased.get(r.id) || null;
    const json = r.toJSON();
    // photoUrl / certidão de óbito assinados (só se locais /files/...).
    json.photoUrl = signPhoto(json.photoUrl);
    json.deathCertificateFileUrl = signPhoto(json.deathCertificateFileUrl);
    return { ...json, responsible, lastBurialDate: lastBurialByDeceased.get(r.id) || null };
  });
}

async function list(tenantId, query) {
  const { page, perPage, limit, offset } = getPagination(query, { defaultPerPage: 30 });
  const where = { tenantId, ...buildListWhere(query) };

  // Filtro por quadra: restringe pelo jazigo atual (belongsTo — não multiplica linhas).
  const graveInc = { ...currentGraveInclude };
  if (query.blockId || query.cemeteryId) {
    const lotWhere = {};
    const streetInc = { model: Street, as: 'street', include: [{ model: Block, as: 'block' }] };
    if (query.blockId) {
      streetInc.required = true;
      streetInc.include = [{ model: Block, as: 'block', where: { id: query.blockId }, required: true }];
    }
    graveInc.required = true;
    graveInc.where = query.cemeteryId ? { cemeteryId: query.cemeteryId } : undefined;
    graveInc.include = [{ model: GraveStatus, as: 'status' }, { model: Lot, as: 'lot', where: lotWhere, required: Boolean(query.blockId), include: [streetInc] }];
  }

  const { rows, count } = await Deceased.findAndCountAll({
    where, limit, offset, order: [['fullName', 'ASC']],
    include: [graveInc],
    distinct: true,
  });
  return { rows: await attachResponsible(tenantId, rows), meta: buildPageMeta(count, page, perPage) };
}

// Contadores por situação (chips: sepultado / ossario / transladado / cremado).
async function locationCounts(tenantId, query) {
  const where = { tenantId, ...buildListWhere({ ...query, currentLocationType: undefined }) };
  const grouped = await Deceased.findAll({
    where,
    attributes: ['currentLocationType', [sequelize.fn('COUNT', sequelize.col('id')), 'total']],
    group: ['currentLocationType'],
    raw: true,
  });
  const byLocation = {};
  let total = 0;
  grouped.forEach((r) => { byLocation[r.currentLocationType] = Number(r.total); total += Number(r.total); });
  return { total, byLocation };
}

async function getById(tenantId, id) {
  const deceased = await Deceased.findOne({
    where: { id, tenantId },
    include: [
      currentGraveInclude,
      { model: Burial, as: 'burials', include: [{ model: Grave, as: 'grave' }] },
      // rastreabilidade: exumações e depósitos no ossário (de onde veio, onde está)
      {
        model: Exhumation, as: 'exhumations',
        include: [
          { model: Grave, as: 'grave' },
          { model: Grave, as: 'destinationGrave' },
          { model: OssuaryNiche, as: 'destinationNiche', include: [{ model: Ossuary, as: 'ossuary' }] },
        ],
      },
      {
        model: RemainsDeposit, as: 'remainsDeposits',
        include: [
          { model: OssuaryNiche, as: 'niche', include: [{ model: Ossuary, as: 'ossuary' }] },
          { model: Grave, as: 'originGrave' },
        ],
      },
    ],
    order: [[{ model: Burial, as: 'burials' }, 'burialDate', 'DESC']],
  });
  if (!deceased) throw AppError.notFound('Sepultado não encontrado.');
  // Materializa o "Responsável" (titular da concessão ou declarante) também no
  // detalhe, reusando exatamente a mesma regra da lista.
  const [full] = await attachResponsible(tenantId, [deceased]);
  return full;
}

async function create(tenantId, data) {
  return Deceased.create({ ...data, tenantId });
}

async function update(tenantId, id, data) {
  const deceased = await Deceased.findOne({ where: { id, tenantId } });
  if (!deceased) throw AppError.notFound('Sepultado não encontrado.');
  return deceased.update(data);
}

async function remove(tenantId, id) {
  const deceased = await Deceased.findOne({ where: { id, tenantId } });
  if (!deceased) throw AppError.notFound('Sepultado não encontrado.');
  const activeBurials = await Burial.count({ where: { tenantId, deceasedId: id, status: 'ativo' } });
  if (activeBurials > 0) {
    throw AppError.conflict('Sepultado possui sepultamento ativo — exume antes de excluir.', 'DECEASED_HAS_ACTIVE_BURIAL');
  }
  await deceased.destroy(); // soft delete
}

/**
 * Upload da FOTO do sepultado (base64). Valida tipo/tamanho, persiste via storage
 * (servido em /files/...), grava deceased.photoUrl (fileUrl estável) e devolve
 * { photoUrl } ASSINADO p/ exibição imediata via <img>. Espelha tenants.uploadLogo.
 */
async function uploadPhoto(tenantId, id, { contentBase64, fileName, mimeType } = {}) {
  const deceased = await Deceased.findOne({ where: { id, tenantId } });
  if (!deceased) throw AppError.notFound('Sepultado não encontrado.');

  if (!contentBase64) {
    throw AppError.badRequest('Envie o arquivo da foto (contentBase64).', 'MISSING_FILE');
  }
  const mime = String(mimeType || '').toLowerCase();
  if (!PHOTO_MIME_TYPES.includes(mime)) {
    throw AppError.badRequest('Formato inválido. Envie uma imagem PNG, JPEG ou WEBP.', 'INVALID_IMAGE_TYPE');
  }
  const buffer = Buffer.from(contentBase64, 'base64');
  if (!buffer.length) {
    throw AppError.badRequest('Arquivo de foto vazio ou inválido.', 'INVALID_FILE');
  }
  if (buffer.length > PHOTO_MAX_BYTES) {
    throw AppError.badRequest('Imagem muito grande. O limite é 5 MB.', 'FILE_TOO_LARGE');
  }

  const saved = await storage.saveFile({
    tenantId,
    fileName: fileName || 'foto.png',
    content: buffer,
    mimeType: mime,
  });

  await deceased.update({ photoUrl: saved.fileUrl });
  return { photoUrl: signPhoto(saved.fileUrl) };
}

// Tipos e limite da declaração/certidão de óbito (PDF ou imagem escaneada).
const CERT_MIME_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
const CERT_MAX_BYTES = 15 * 1024 * 1024;

/**
 * Upload da DECLARAÇÃO/CERTIDÃO DE ÓBITO (PDF) anexada ao sepultado. Guarda em
 * deceased.deathCertificateFileUrl e devolve a URL assinada p/ download.
 */
async function uploadDeathCertificate(tenantId, id, { contentBase64, fileName, mimeType } = {}) {
  const deceased = await Deceased.findOne({ where: { id, tenantId } });
  if (!deceased) throw AppError.notFound('Sepultado não encontrado.');
  if (!contentBase64) throw AppError.badRequest('Envie o arquivo (contentBase64).', 'MISSING_FILE');
  const mime = String(mimeType || '').toLowerCase();
  if (!CERT_MIME_TYPES.includes(mime)) {
    throw AppError.badRequest('Formato inválido. Envie um PDF ou imagem (PNG/JPEG).', 'INVALID_FILE_TYPE');
  }
  const buffer = Buffer.from(contentBase64, 'base64');
  if (!buffer.length) throw AppError.badRequest('Arquivo vazio ou inválido.', 'INVALID_FILE');
  if (buffer.length > CERT_MAX_BYTES) {
    throw AppError.badRequest('Arquivo muito grande. O limite é 15 MB.', 'FILE_TOO_LARGE');
  }
  const saved = await storage.saveFile({
    tenantId,
    fileName: fileName || 'certidao-obito.pdf',
    content: buffer,
    mimeType: mime,
  });
  await deceased.update({ deathCertificateFileUrl: saved.fileUrl });
  return { deathCertificateFileUrl: signPhoto(saved.fileUrl) };
}

module.exports = {
  list, locationCounts, getById, create, update, remove,
  uploadPhoto, uploadDeathCertificate, EDITABLE_FIELDS,
};
