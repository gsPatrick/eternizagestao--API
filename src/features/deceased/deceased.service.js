'use strict';

const { Op } = require('sequelize');
const AppError = require('../../utils/app-error');
const storage = require('../../providers/storage');
const { getPagination, buildPageMeta } = require('../../utils/pagination');
const {
  sequelize, Deceased, Burial, Grave, GraveStatus, Lot, Street, Block, Cemetery, Document,
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
    // Cemitério: coluna da listagem do cliente (Cemitério · Quadra · Lote · ...).
    { model: Cemetery, as: 'cemetery', attributes: ['id', 'name'] },
    {
      model: Lot, as: 'lot',
      include: [{ model: Street, as: 'street', include: [{ model: Block, as: 'block' }] }],
    },
  ],
};

const EDITABLE_FIELDS = [
  'fullName', 'registrationNumber', 'cpf', 'rg', 'age', 'birthDate', 'deathDate', 'deathTime', 'gender',
  'maritalStatus', 'skinColor', 'voterId', 'deathPlace',
  'motherName', 'fatherName', 'birthplace', 'causeOfDeath', 'attendingPhysician',
  'deathCertificateNumber', 'deathCertificateRegistry', 'registryNumber', 'funeralHome', 'photoUrl', 'notes',
  'responsiblePersonId',
];

// Campos que NÃO são coluna do sepultado, mas que a edição passa a aceitar por
// serem o que o operador enxerga como "dados dele": a sepultura onde está e a
// data em que foi sepultado vivem no registro de sepultamento.
const BURIAL_FIELDS = ['currentGraveId', 'burialDate', 'burialTime'];

function buildListWhere(query) {
  const where = {};
  if (query.search) {
    where[Op.or] = [
      { fullName: { [Op.iLike]: `%${query.search}%` } },
      { cpf: { [Op.iLike]: `%${query.search}%` } },
    ];
  }
  // Filtros dedicados (§ busca avançada do cliente).
  if (query.fullName) where.fullName = { [Op.iLike]: `%${query.fullName}%` };
  if (query.cpf) where.cpf = { [Op.iLike]: `%${query.cpf}%` };
  if (query.motherName) where.motherName = { [Op.iLike]: `%${query.motherName}%` };
  // MATRÍCULA: número interno do sepultado, filtro próprio na tela do cliente.
  if (query.registrationNumber) where.registrationNumber = { [Op.iLike]: `%${query.registrationNumber}%` };
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
    // Preferência: responsável EXPLÍCITO do sepultado → titular da concessão →
    // declarante do último sepultamento.
    const explicit = r.responsiblePerson
      ? { id: r.responsiblePerson.id, name: r.responsiblePerson.fullName }
      : null;
    const responsible =
      explicit || (r.currentGraveId && byGrave.get(r.currentGraveId)) || byDeceased.get(r.id) || null;
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

  // Filtros pelo JAZIGO ATUAL (quadra/rua/lote/código) — belongsTo, não multiplica
  // linhas. `graveCode` cobre "gaveta"/"matrícula" (código da unidade, ex.: M2/12B).
  const graveInc = { ...currentGraveInclude };
  // `block`/`lot` em TEXTO espelham a busca da tela do cliente (são milhares de
  // quadras — não cabem numa lista de ids).
  const hasGraveFilter =
    query.blockId || query.streetId || query.lotId || query.cemeteryId || query.graveCode
    || query.block || query.lot;
  if (hasGraveFilter) {
    const graveWhere = {};
    if (query.cemeteryId) graveWhere.cemeteryId = query.cemeteryId;
    if (query.graveCode) graveWhere.code = { [Op.iLike]: `%${query.graveCode}%` };
    const lotWhere = {};
    if (query.lotId) lotWhere.id = query.lotId;
    if (query.lot) lotWhere.code = { [Op.iLike]: `%${query.lot}%` };
    const streetInc = { model: Street, as: 'street', include: [{ model: Block, as: 'block' }] };
    if (query.streetId) { streetInc.where = { id: query.streetId }; streetInc.required = true; }
    if (query.blockId) {
      streetInc.required = true;
      streetInc.include = [{ model: Block, as: 'block', where: { id: query.blockId }, required: true }];
    } else if (query.block) {
      streetInc.required = true;
      streetInc.include = [{
        model: Block, as: 'block', required: true,
        where: { code: { [Op.iLike]: `%${query.block}%` } },
      }];
    }
    const lotRequired = Boolean(query.blockId || query.streetId || query.lotId || query.block || query.lot);
    graveInc.required = true;
    graveInc.where = Object.keys(graveWhere).length ? graveWhere : undefined;
    // Mantém parentGrave e cemitério: sem eles as colunas "Gaveta" e
    // "Cemitério" ficavam vazias justamente quando havia filtro aplicado.
    graveInc.include = [
      { model: GraveStatus, as: 'status' },
      { model: Grave, as: 'parentGrave' },
      { model: Cemetery, as: 'cemetery', attributes: ['id', 'name'] },
      { model: Lot, as: 'lot', where: Object.keys(lotWhere).length ? lotWhere : undefined, required: lotRequired, include: [streetInc] },
    ];
  }

  const { rows, count } = await Deceased.findAndCountAll({
    where, limit, offset, order: [['fullName', 'ASC']],
    include: [graveInc, { model: Person, as: 'responsiblePerson', attributes: ['id', 'fullName'] }],
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
      { model: Person, as: 'responsiblePerson', attributes: ['id', 'fullName'] },
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

  const campos = {};
  for (const f of EDITABLE_FIELDS) if (data[f] !== undefined) campos[f] = data[f];

  // SEPULTURA e DATA DE SEPULTAMENTO: para o operador são "dados do sepultado",
  // mas moram no registro de sepultamento. Antes só mudavam pelos fluxos de
  // sepultamento/exumação, então um erro de digitação obrigava a exumar e
  // sepultar de novo — inventando eventos que nunca aconteceram, o que é pior
  // para o histórico do que permitir a correção.
  const novaSepultura = data.currentGraveId !== undefined
    && data.currentGraveId !== deceased.currentGraveId;

  await sequelize.transaction(async (transaction) => {
    if (novaSepultura) {
      if (data.currentGraveId) {
        const grave = await Grave.findOne({
          where: { id: data.currentGraveId, tenantId }, transaction,
        });
        if (!grave) throw AppError.notFound('Sepultura informada não encontrada.');
        campos.currentLocationType = 'sepultado';
      } else {
        campos.currentLocationType = deceased.currentLocationType;
      }
      campos.currentGraveId = data.currentGraveId || null;
    }

    await deceased.update(campos, { transaction });

    // O sepultamento ativo acompanha a correção — senão a listagem mostraria
    // uma sepultura e o histórico outra.
    const patchBurial = {};
    if (novaSepultura && data.currentGraveId) patchBurial.graveId = data.currentGraveId;
    if (data.burialDate !== undefined) patchBurial.burialDate = data.burialDate;
    if (data.burialTime !== undefined) patchBurial.burialTime = data.burialTime || null;
    if (Object.keys(patchBurial).length) {
      await Burial.update(patchBurial, {
        where: { tenantId, deceasedId: id, status: 'ativo' },
        transaction,
      });
    }
  });

  return deceased.reload();
}

/**
 * IMPACTO da exclusão: o que está preso ao sepultado. A tela usa isto para
 * mostrar ao operador, ANTES de confirmar, exatamente o que ele vai arrastar
 * junto — em vez de só barrar com uma mensagem seca.
 */
async function deleteImpact(tenantId, id) {
  const deceased = await Deceased.findOne({
    where: { id, tenantId },
    include: [{ model: Grave, as: 'currentGrave', attributes: ['id', 'code'] }],
  });
  if (!deceased) throw AppError.notFound('Sepultado não encontrado.');

  const [activeBurials, exhumations, deposits, documents] = await Promise.all([
    Burial.count({ where: { tenantId, deceasedId: id, status: 'ativo' } }),
    Exhumation.count({ where: { tenantId, deceasedId: id } }),
    RemainsDeposit.count({ where: { tenantId, deceasedId: id, status: 'depositado' } }),
    Document.count({ where: { tenantId, deceasedId: id } }),
  ]);

  return {
    fullName: deceased.fullName,
    blocked: activeBurials > 0,
    activeBurials,
    graveCode: deceased.currentGrave?.code || null,
    exhumations,
    deposits,
    documents,
  };
}

/**
 * Exclusão do sepultado.
 *
 * Sem `force`, sepultado com sepultamento ativo é barrado — o correto é exumar.
 * Com `force` (confirmação explícita na tela, listando o impacto), a exclusão
 * prossegue e ARRASTA o que a bloqueava: o sepultamento ativo é encerrado, a
 * sepultura é desocupada e o depósito no ossário é baixado.
 *
 * O que NUNCA é apagado: os DOCUMENTOS já emitidos (autorização, certidão) e o
 * histórico de exumações. São registro civil e continuam consultáveis.
 */
async function remove(tenantId, id, { force = false } = {}) {
  const deceased = await Deceased.findOne({ where: { id, tenantId } });
  if (!deceased) throw AppError.notFound('Sepultado não encontrado.');
  const activeBurials = await Burial.count({ where: { tenantId, deceasedId: id, status: 'ativo' } });

  if (activeBurials > 0 && !force) {
    throw AppError.conflict('Sepultado possui sepultamento ativo — exume antes de excluir.', 'DECEASED_HAS_ACTIVE_BURIAL');
  }

  await sequelize.transaction(async (transaction) => {
    if (force) {
      await Burial.update(
        { status: 'transladado' },
        { where: { tenantId, deceasedId: id, status: 'ativo' }, transaction }
      );
      await RemainsDeposit.update(
        { status: 'retirado', removedAt: new Date(), removalReason: 'Sepultado excluído do cadastro.' },
        { where: { tenantId, deceasedId: id, status: 'depositado' }, transaction }
      );
      await deceased.update({ currentGraveId: null }, { transaction });
    }
    await deceased.destroy({ transaction }); // soft delete
  });
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
  deleteImpact, uploadPhoto, uploadDeathCertificate, EDITABLE_FIELDS, BURIAL_FIELDS,
};
