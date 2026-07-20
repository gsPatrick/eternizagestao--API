'use strict';

const { Op } = require('sequelize');
const AppError = require('../../utils/app-error');
const { getPagination, buildPageMeta } = require('../../utils/pagination');
const graveEvents = require('../grave-timeline/grave-event.recorder');
const graveStatuses = require('../grave-statuses/grave-statuses.service');
const delinquency = require('../delinquency/delinquency.service');
const storage = require('../../providers/storage');
const { assertGraveAcceptsBurial } = require('./burials.helper');
const {
  sequelize, Burial, Grave, GraveStatus, Deceased, Person, Document,
} = require('../../models');

const CREATE_FIELDS = [
  'graveId', 'deceasedId', 'burialDate', 'burialTime', 'declarantPersonId',
  'funeralHome', 'authorizationNumber', 'notes',
];

const canForce = (force, role) => force === true && ['admin', 'super_admin'].includes(role);

// Anexa a Autorização de Sepultamento vigente (documento por referência) a cada
// sepultamento — dá ao front o id p/ emitir 2ª via e a URL do arquivo p/ visualizar,
// sem N+1 (uma consulta para todos os ids). Retorna objetos JSON já enriquecidos.
async function attachAuthorizationDocuments(tenantId, rows) {
  const items = Array.isArray(rows) ? rows : [rows];
  const ids = items.map((r) => r.id).filter(Boolean);
  const byBurial = {};
  if (ids.length) {
    const docs = await Document.findAll({
      where: {
        tenantId,
        referenceType: 'burial',
        referenceId: { [Op.in]: ids },
        documentType: 'autorizacao_sepultamento',
      },
      attributes: ['id', 'referenceId', 'formattedNumber', 'fileUrl', 'status', 'reissueCount'],
      order: [['issuedAt', 'DESC']],
    });
    // mais recente por sepultamento (a 2ª via mais nova é a vigente)
    docs.forEach((d) => { if (!byBurial[d.referenceId]) byBurial[d.referenceId] = d; });
  }
  return items.map((r) => {
    const json = typeof r.toJSON === 'function' ? r.toJSON() : r;
    const doc = byBurial[json.id];
    json.authorizationDocument = doc
      ? {
        id: doc.id,
        formattedNumber: doc.formattedNumber,
        // URL ASSINADA (TTL padrão) — o front abre o PDF sem token cru → sem 403.
        fileUrl: storage.signedUrl(doc.fileUrl),
        status: doc.status,
        reissueCount: doc.reissueCount,
      }
      : null;
    return json;
  });
}

// Falha do módulo de inadimplência não pode travar a operação — trata como adimplente
async function isDelinquent(tenantId, graveId) {
  try {
    return await delinquency.isGraveDelinquent(tenantId, graveId);
  } catch (err) {
    return false;
  }
}

async function create(tenantId, data, userId, { force, role, autoAuthorize = true } = {}) {
  const burial = await sequelize.transaction(async (transaction) => {
    const grave = await Grave.findOne({
      where: { id: data.graveId, tenantId },
      include: [{ model: GraveStatus, as: 'status' }],
      transaction,
    });
    if (!grave) throw AppError.notFound('Sepultura não encontrada.');

    const skipChecks = canForce(force, role);

    // Validações compartilhadas do jazigo (bloqueio, status, lotação, concessão).
    const { activeBurials } = await assertGraveAcceptsBurial({
      grave, tenantId, transaction, skipConcession: skipChecks,
    });

    // Inadimplência é gate financeiro específico do sepultamento (não do translado);
    // também dispensado no modo forçado por admin.
    if (!skipChecks && (await isDelinquent(tenantId, grave.id))) {
      throw new AppError('Sepultura com débitos em atraso — sepultamento bloqueado.', 422, 'GRAVE_DELINQUENT');
    }

    const deceased = await Deceased.findOne({ where: { id: data.deceasedId, tenantId }, transaction });
    if (!deceased) throw AppError.notFound('Sepultado não encontrado.');
    const alreadyBuried = await Burial.count({
      where: { tenantId, deceasedId: deceased.id, status: 'ativo' }, transaction,
    });
    if (alreadyBuried > 0) {
      throw AppError.conflict('Sepultado já possui sepultamento ativo.', 'ALREADY_BURIED');
    }

    const burial = await Burial.create(
      {
        ...data,
        tenantId,
        cemeteryId: grave.cemeteryId,
        status: 'ativo',
        registeredByUserId: userId,
      },
      { transaction }
    );

    await deceased.update({ currentGraveId: grave.id, currentLocationType: 'sepultado' }, { transaction });

    // ao atingir a capacidade, o jazigo passa automaticamente a "ocupada"
    if (activeBurials + 1 >= grave.capacity) {
      const occupied = await graveStatuses.resolve(tenantId, { slug: 'ocupada' });
      await grave.update({ statusId: occupied.id }, { transaction });
    }

    await graveEvents.record(
      {
        tenantId, graveId: grave.id, eventType: 'sepultamento',
        title: `Sepultamento de ${deceased.fullName}`,
        referenceType: 'burial', referenceId: burial.id,
        metadata: { deceasedId: deceased.id, burialDate: burial.burialDate },
        userId,
      },
      { transaction }
    );
    return burial;
  });

  // Auto-emissão da Autorização de Sepultamento via feature de documentos (que já
  // trata número sequencial, arquivo, auditoria semântica, timeline do jazigo e
  // notificação ao responsável). Roda FORA da transação — o serviço de documentos
  // abre a própria. Best-effort: nº já informado ou falha na emissão não desfaz o
  // sepultamento já registrado (o front pode emitir depois pela ação de 2ª via).
  if (autoAuthorize && !burial.authorizationNumber) {
    try {
      const documents = require('../documents/documents.service');
      const doc = await documents.issueFromRequest(
        tenantId,
        {
          documentType: 'autorizacao_sepultamento',
          referenceType: 'burial',
          referenceId: burial.id,
          graveId: burial.graveId,
          deceasedId: burial.deceasedId,
          personId: burial.declarantPersonId || null,
        },
        userId
      );
      await burial.update({ authorizationNumber: doc.formattedNumber });
    } catch (err) {
      console.error('[burials] auto-emissão da autorização falhou:', err.message);
    }
  }

  const [enriched] = await attachAuthorizationDocuments(tenantId, [burial]);
  return enriched;
}

async function list(tenantId, query) {
  const { page, perPage, limit, offset } = getPagination(query, { defaultPerPage: 30 });
  const where = { tenantId };
  if (query.graveId) where.graveId = query.graveId;
  if (query.deceasedId) where.deceasedId = query.deceasedId;
  if (query.cemeteryId) where.cemeteryId = query.cemeteryId;
  if (query.status) where.status = query.status;
  if (query.burialFrom || query.burialTo) {
    where.burialDate = {};
    if (query.burialFrom) where.burialDate[Op.gte] = query.burialFrom;
    if (query.burialTo) where.burialDate[Op.lte] = query.burialTo;
  }
  // Busca livre da tela (sepultado, código do jazigo ou nº da autorização).
  // Os includes abaixo são belongsTo (1:1 — não multiplicam linhas); subQuery:false
  // faz o WHERE alcançar as colunas associadas junto do LIMIT/OFFSET.
  const search = (query.search || '').trim();
  if (search) {
    const like = `%${search}%`;
    // sequelize.where + col explícita: com subQuery:false o atalho `$assoc.attr$`
    // não mapeia camelCase→snake_case; referenciamos a coluna real do JOIN.
    where[Op.or] = [
      { authorizationNumber: { [Op.iLike]: like } },
      sequelize.where(sequelize.col('deceased.full_name'), Op.iLike, like),
      sequelize.where(sequelize.col('grave.code'), Op.iLike, like),
    ];
  }

  const { rows, count } = await Burial.findAndCountAll({
    where, limit, offset,
    order: [['burialDate', 'DESC']],
    subQuery: false,
    include: [
      { model: Deceased, as: 'deceased' },
      { model: Grave, as: 'grave', include: [{ model: GraveStatus, as: 'status' }] },
      { model: Person, as: 'declarant' },
    ],
  });
  const enriched = await attachAuthorizationDocuments(tenantId, rows);
  return { rows: enriched, meta: buildPageMeta(count, page, perPage) };
}

// Indicadores da tela de sepultamentos: totais do mês/ano, exumados e por situação.
async function stats(tenantId, query) {
  const where = { tenantId };
  if (query.cemeteryId) where.cemeteryId = query.cemeteryId;

  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const monthStart = `${y}-${m}-01`;
  const yearStart = `${y}-01-01`;

  const [monthCount, yearCount, grouped] = await Promise.all([
    Burial.count({ where: { ...where, burialDate: { [Op.gte]: monthStart } } }),
    Burial.count({ where: { ...where, burialDate: { [Op.gte]: yearStart } } }),
    Burial.findAll({
      where,
      attributes: ['status', [sequelize.fn('COUNT', sequelize.col('id')), 'total']],
      group: ['status'],
      raw: true,
    }),
  ]);

  const byStatus = {};
  let total = 0;
  grouped.forEach((r) => { byStatus[r.status] = Number(r.total); total += Number(r.total); });
  return {
    total,
    monthCount,
    yearCount,
    exhumedCount: byStatus.exumado || 0,
    transferredCount: byStatus.transladado || 0,
    byStatus,
  };
}

async function getById(tenantId, id) {
  const burial = await Burial.findOne({
    where: { id, tenantId },
    include: [
      { model: Deceased, as: 'deceased' },
      { model: Grave, as: 'grave', include: [{ model: GraveStatus, as: 'status' }] },
      { model: Person, as: 'declarant' },
    ],
  });
  if (!burial) throw AppError.notFound('Sepultamento não encontrado.');
  const [enriched] = await attachAuthorizationDocuments(tenantId, [burial]);
  return enriched;
}

module.exports = { create, list, stats, getById, CREATE_FIELDS };
