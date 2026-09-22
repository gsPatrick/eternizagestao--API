'use strict';

const { Op } = require('sequelize');
const AppError = require('../../utils/app-error');
const { getPagination, buildPageMeta } = require('../../utils/pagination');
const graveEvents = require('../grave-timeline/grave-event.recorder');
const graveStatuses = require('../grave-statuses/grave-statuses.service');
const audit = require('../audit-logs/audit.service');
const storage = require('../../providers/storage');
const {
  sequelize, Grave, GraveStatus, Lot, Street, Block, Cemetery,
  Concession, Person, Burial, Deceased, Document,
} = require('../../models');

// FOTOGRAFIA da sepultura (campo do formulário do cliente). Mesmos limites da
// foto de pessoa/sepultado — 5 MB, imagem comum.
const PHOTO_MIME_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
const PHOTO_URL_TTL_SECONDS = Number(process.env.PHOTO_URL_TTL_SECONDS || 7 * 24 * 3600);
const signPhoto = (url) => (url ? storage.signedUrl(url, { ttlSeconds: PHOTO_URL_TTL_SECONDS }) : url);

/**
 * "Perpétuo" tem ACENTO: /perpet/ NÃO casa com "perp-é-tuo" (quebra no `é`).
 * Normalizamos os diacríticos antes de testar — senão a sepultura perpétua era
 * tratada como temporária (concessão errada e certidão nunca emitida).
 */
function isPerpetualUse(value) {
  return /perpet/i.test(
    String(value == null ? '' : value).normalize('NFD').replace(/[̀-ͯ]/g, '')
  );
}

/**
 * Emite a CERTIDÃO DE PERPETUIDADE quando a sepultura é PERPÉTUA — inclusive
 * SEM proprietário/concessão (o cliente marca a utilização como "Perpétuo" e
 * espera a certidão disponível para download).
 * IDEMPOTENTE: não reemite se o jazigo já tiver uma certidão.
 */
async function ensurePerpetuityCertificate(tenantId, grave, userId) {
  if (!grave || !isPerpetualUse(grave.utilizacao)) return;

  const existing = await Document.findOne({
    where: { tenantId, graveId: grave.id, documentType: 'certidao_perpetuidade' },
  });
  if (existing) return; // já emitida (ex.: pela emissão da concessão)

  // Concessão ativa (se houver) enriquece a certidão com o titular.
  const concession = await Concession.findOne({
    where: { tenantId, graveId: grave.id, status: 'ativa' },
  });

  const documents = require('../documents/documents.service');
  await documents.issueFromRequest(
    tenantId,
    {
      documentType: 'certidao_perpetuidade',
      referenceType: concession ? 'concession' : 'grave',
      referenceId: concession ? concession.id : grave.id,
      graveId: grave.id,
      personId: concession ? concession.personId : null,
    },
    userId
  );
}

// Wrapper best-effort: nunca derruba o cadastro/edição da sepultura e deixa a
// falha VISÍVEL na auditoria (o admin não tem acesso ao log do servidor).
async function tryPerpetuityCertificate(tenantId, grave, userId) {
  try {
    await ensurePerpetuityCertificate(tenantId, grave, userId);
  } catch (err) {
    console.error('[graves] emissão da certidão de perpetuidade falhou:', err.message, err.stack);
    audit.record({
      action: 'emissao_documento',
      entityType: 'Documento',
      entityId: grave.id,
      description: `FALHA ao emitir a Certidão de Perpetuidade: ${err.message}`,
      newData: { erro: err.message, sepulturaId: grave.id },
    });
  }
}

const EDITABLE_FIELDS = [
  'code', 'unitType', 'capacity', 'geoPolygon', 'latitude', 'longitude',
  'photoUrl', 'areaM2', 'notes',
  // Campos oficiais dos modelos de documento (certidão/autorização).
  'utilizacao', 'tombType', 'carneiraPermission', 'carneiraPermissionDate',
  // Referência de migração do SICART (quadra/lote anteriores).
  'previousBlock', 'previousLot',
];

const baseIncludes = [
  { model: GraveStatus, as: 'status' },
  {
    model: Lot,
    as: 'lot',
    include: [{ model: Street, as: 'street', include: [{ model: Block, as: 'block' }] }],
  },
];

// Monta o WHERE de listagem a partir da query (reutilizado por list e statusCounts).
async function buildListWhere(tenantId, query) {
  const where = { tenantId };
  if (query.cemeteryId) where.cemeteryId = query.cemeteryId;
  if (query.lotId) where.lotId = query.lotId;
  if (query.statusId) where.statusId = query.statusId;
  // filtro por slug do status (chips da listagem no front). Resolve slug → id;
  // slug inexistente ⇒ WHERE impossível (nenhum resultado, sem quebrar).
  if (query.statusSlug && !query.statusId) {
    const st = await GraveStatus.findOne({
      where: { slug: query.statusSlug, [Op.or]: [{ tenantId: null }, { tenantId }] },
      attributes: ['id'],
    });
    where.statusId = st ? st.id : '00000000-0000-0000-0000-000000000000';
  }
  if (query.unitType) where.unitType = query.unitType;
  // UTILIZAÇÃO (Rotativo/Perpétuo) — filtro da listagem do cliente. iLike para
  // casar independente de caixa e de digitação parcial.
  if (query.utilizacao) where.utilizacao = { [Op.iLike]: `%${query.utilizacao}%` };
  if (query.blocked !== undefined) where.isBlocked = query.blocked === 'true';
  if (query.onlyRoot === 'true' || query.onlyRoot === true) where.parentGraveId = null;
  // GAVETAS de um jazigo: o seletor de sepultura precisa listar as filhas para
  // o operador escolher O NÚMERO DA GAVETA (a gaveta É uma Grave, com `code`).
  if (query.parentGraveId) where.parentGraveId = query.parentGraveId;

  // busca livre: código OU nome do concessionário titular OU nome do SEPULTADO
  const term = query.search || query.code;
  if (term) {
    const like = `%${term}%`;
    const clauses = [{ code: { [Op.iLike]: like } }];
    if (query.search) {
      const ownerConcessions = await Concession.findAll({
        where: { tenantId, status: 'ativa' },
        attributes: ['graveId'],
        include: [{ model: Person, as: 'person', where: { fullName: { [Op.iLike]: like } }, required: true, attributes: [] }],
      });
      const ownerGraveIds = ownerConcessions.map((c) => c.graveId).filter(Boolean);
      if (ownerGraveIds.length) clauses.push({ id: { [Op.in]: ownerGraveIds } });

      // + sepultado(s) atualmente na sepultura (Deceased.currentGraveId).
      const occupants = await Deceased.findAll({
        where: { tenantId, fullName: { [Op.iLike]: like } },
        attributes: ['currentGraveId'],
      });
      const occGraveIds = occupants.map((d) => d.currentGraveId).filter(Boolean);
      if (occGraveIds.length) clauses.push({ id: { [Op.in]: occGraveIds } });
    }
    where[Op.or] = clauses;
  }

  // filtro dedicado por PROPRIETÁRIO (nome OU CPF do titular da concessão ativa).
  if (query.owner) {
    const like = `%${query.owner}%`;
    const rows = await Concession.findAll({
      where: { tenantId, status: 'ativa' },
      attributes: ['graveId'],
      include: [{
        model: Person, as: 'person', required: true, attributes: [],
        where: { [Op.or]: [{ fullName: { [Op.iLike]: like } }, { cpf: { [Op.iLike]: like } }] },
      }],
    });
    const ids = rows.map((r) => r.graveId).filter(Boolean);
    // AND com os demais filtros; sem match → id impossível (nenhum resultado).
    where.id = ids.length ? { [Op.in]: ids } : '00000000-0000-0000-0000-000000000000';
  }
  return where;
}

// include do lote com filtro opcional por quadra/rua (belongsTo — não multiplica linhas)
function lotInclude(query) {
  const streetInclude = {
    model: Street, as: 'street',
    include: [{ model: Block, as: 'block' }],
  };
  if (query.streetId) { streetInclude.where = { id: query.streetId }; streetInclude.required = true; }
  if (query.blockId) {
    streetInclude.required = true;
    streetInclude.include = [{ model: Block, as: 'block', where: { id: query.blockId }, required: true }];
  }
  // QUADRA por TEXTO: na listagem do cliente a quadra é digitada, não escolhida
  // numa lista de ids (são milhares de quadras).
  if (query.block) {
    streetInclude.required = true;
    streetInclude.include = [{
      model: Block, as: 'block', required: true,
      where: { code: { [Op.iLike]: `%${query.block}%` } },
    }];
  }
  // LOTE por TEXTO, mesma razão.
  const lotWhere = query.lot ? { code: { [Op.iLike]: `%${query.lot}%` } } : undefined;
  const required = Boolean(query.blockId || query.streetId || query.block || query.lot);
  const include = { model: Lot, as: 'lot', required, include: [streetInclude] };
  if (lotWhere) include.where = lotWhere;
  return include;
}

// include APENAS para filtrar (quadra/rua) sem selecionar colunas — necessário
// em queries agrupadas (statusCounts): trazer colunas do lote/rua/quadra sem
// pô-las no GROUP BY quebra o Postgres ("column lot.id must appear in GROUP BY").
function lotFilterInclude(query) {
  const blockInclude = { model: Block, as: 'block', attributes: [], required: true };
  if (query.blockId) blockInclude.where = { id: query.blockId };
  else if (query.block) blockInclude.where = { code: { [Op.iLike]: `%${query.block}%` } };
  const streetInclude = {
    model: Street, as: 'street', attributes: [], required: true,
    include: [blockInclude],
  };
  if (query.streetId) streetInclude.where = { id: query.streetId };
  const include = { model: Lot, as: 'lot', attributes: [], required: true, include: [streetInclude] };
  if (query.lot) include.where = { code: { [Op.iLike]: `%${query.lot}%` } };
  return include;
}

async function list(tenantId, query) {
  const { page, perPage, limit, offset } = getPagination(query, { defaultPerPage: 30 });
  const where = await buildListWhere(tenantId, query);

  const { rows, count } = await Grave.findAndCountAll({
    where,
    limit,
    offset,
    order: [['code', 'ASC']],
    include: [
      { model: GraveStatus, as: 'status' },
      { model: Cemetery, as: 'cemetery', attributes: ['id', 'name'] },
      // Jazigo PAI quando a linha é uma gaveta — a gaveta herda quadra/lote do
      // pai, então sem isto ela aparece idêntica ao jazigo na listagem.
      { model: Grave, as: 'parentGrave', attributes: ['id', 'code', 'unitType'], required: false },
      lotInclude(query),
    ],
  });

  // Enriquecimento por página (evita multiplicação de linhas de hasMany na paginação):
  // ocupação (sepultamentos ativos), sepultado(s) atuais e concessionário titular.
  const ids = rows.map((g) => g.id);
  const occupancyByGrave = {};
  const ownerByGrave = {};
  const occupantsByGrave = {};
  // Quantas GAVETAS cada sepultura tem: o seletor do sepultado só pede o
  // "Número da gaveta" quando existem filhas — sem isso a tela teria que
  // consultar uma a uma.
  const childCountByGrave = {};
  if (ids.length) {
    const children = await Grave.findAll({
      where: { tenantId, parentGraveId: { [Op.in]: ids } },
      attributes: ['parentGraveId', [sequelize.fn('COUNT', sequelize.col('id')), 'total']],
      group: ['parentGraveId'],
      raw: true,
    });
    children.forEach((c) => { childCountByGrave[c.parentGraveId] = Number(c.total); });

    const counts = await Burial.findAll({
      where: { tenantId, graveId: { [Op.in]: ids }, status: 'ativo' },
      attributes: ['graveId', [sequelize.fn('COUNT', sequelize.col('id')), 'total']],
      group: ['graveId'],
      raw: true,
    });
    counts.forEach((c) => { occupancyByGrave[c.graveId] = Number(c.total); });

    // Sepultado(s) atualmente na sepultura (Deceased.currentGraveId).
    const occupants = await Deceased.findAll({
      where: { tenantId, currentGraveId: { [Op.in]: ids } },
      attributes: ['id', 'fullName', 'currentGraveId'],
    });
    occupants.forEach((d) => {
      (occupantsByGrave[d.currentGraveId] = occupantsByGrave[d.currentGraveId] || []).push({
        id: d.id, fullName: d.fullName,
      });
    });

    const concessions = await Concession.findAll({
      where: { tenantId, graveId: { [Op.in]: ids }, status: 'ativa' },
      include: [{ model: Person, as: 'person', attributes: ['id', 'fullName', 'cpf', 'phonePrimary'] }],
    });
    concessions.forEach((c) => { if (!ownerByGrave[c.graveId]) ownerByGrave[c.graveId] = c; });
  }

  const data = rows.map((g) => {
    const json = g.toJSON();
    // Assina a foto para exibição imediata (<img>) — o editar de sepultura mostra
    // a miniatura da foto já cadastrada em vez de um campo de arquivo vazio.
    json.photoUrl = signPhoto(g.photoUrl);
    const active = occupancyByGrave[g.id] || 0;
    json.activeBurials = active;
    json.available = Math.max(0, (g.capacity || 0) - active);
    json.occupancy = `${active}/${g.capacity || 0}`;
    json.isMapped = Boolean(g.geoPolygon);
    json.occupants = occupantsByGrave[g.id] || [];
    json.childCount = childCountByGrave[g.id] || 0;
    const owner = ownerByGrave[g.id];
    json.owner = owner ? { concessionId: owner.id, person: owner.person } : null;
    return json;
  });

  return { rows: data, meta: buildPageMeta(count, page, perPage) };
}

// Contadores por status (chips da listagem), respeitando os mesmos filtros.
async function statusCounts(tenantId, query) {
  const where = await buildListWhere(tenantId, query);
  const grouped = await Grave.findAll({
    where,
    attributes: ['statusId', [sequelize.fn('COUNT', sequelize.col('Grave.id')), 'total']],
    include: (query.blockId || query.streetId || query.block || query.lot) ? [lotFilterInclude(query)] : [],
    group: ['statusId'],
    raw: true,
  });
  const countByStatus = {};
  let total = 0;
  grouped.forEach((r) => { countByStatus[r.statusId] = Number(r.total); total += Number(r.total); });

  const statuses = await GraveStatus.findAll({
    where: { [Op.or]: [{ tenantId: null }, { tenantId }], active: true },
    order: [['isSystem', 'DESC'], ['name', 'ASC']],
  });
  const byStatus = statuses.map((s) => ({
    statusId: s.id, slug: s.slug, name: s.name, color: s.color, count: countByStatus[s.id] || 0,
  }));
  return { total, byStatus };
}

async function getById(tenantId, id, { includes = baseIncludes } = {}) {
  const grave = await Grave.findOne({ where: { id, tenantId }, include: includes });
  if (!grave) throw AppError.notFound('Sepultura não encontrada.');
  return grave;
}

// Visão 360º do jazigo: hierarquia, status, concessão ativa, ocupantes, gavetas
async function summary(tenantId, id) {
  const grave = await getById(tenantId, id, {
    includes: [
      ...baseIncludes,
      { model: Cemetery, as: 'cemetery' },
      {
        model: Grave, as: 'childGraves',
        include: [
          { model: GraveStatus, as: 'status' },
          // ocupantes ativos de cada gaveta (gaveta = child grave do jazigo/túmulo)
          {
            model: Burial, as: 'burials', where: { status: 'ativo' }, required: false,
            include: [{ model: Deceased, as: 'deceased' }],
          },
        ],
      },
      {
        model: Concession, as: 'concessions', where: { status: 'ativa' }, required: false,
        include: [{ model: Person, as: 'person' }],
      },
      {
        model: Burial, as: 'burials', where: { status: 'ativo' }, required: false,
        include: [{ model: Deceased, as: 'deceased' }],
      },
    ],
  });
  // ocupação total = sepultamentos ativos na própria unidade + nas gavetas filhas
  const childBurials = (grave.childGraves || []).reduce((sum, c) => sum + (c.burials?.length || 0), 0);
  const activeBurials = (grave.burials?.length || 0) + childBurials;
  const capacity = grave.capacity || 0;
  return {
    grave,
    occupancy: { capacity, activeBurials, available: Math.max(0, capacity - activeBurials) },
  };
}

// Cadastro RÁPIDO: o operador digita QUADRA e LOTE (texto) em vez de escolher
// numa cascata de selects. A estrutura Quadra→Rua→Lote é criada/reaproveitada
// nos bastidores (find-or-create), então o mapa e os filtros continuam
// funcionando. A "Rua" não aparece na UI simplificada → usamos uma rua padrão
// por quadra ('GERAL'). Chaves únicas são por `code` dentro do pai.
async function resolveLotFromText(tenantId, { cemeteryId, block, street, lot }, transaction) {
  const cemetery = await Cemetery.findOne({ where: { id: cemeteryId, tenantId }, transaction });
  if (!cemetery) throw AppError.notFound('Cemitério não encontrado.');

  const blockCode = String(block == null ? '' : block).trim();
  const lotCode = String(lot == null ? '' : lot).trim();
  if (!blockCode) throw AppError.badRequest('Informe a quadra.', 'MISSING_BLOCK');
  if (!lotCode) throw AppError.badRequest('Informe o lote.', 'MISSING_LOT');
  const streetName = String(street == null ? '' : street).trim();
  const streetCode = streetName || 'GERAL';

  const [blockRow] = await Block.findOrCreate({
    where: { tenantId, cemeteryId, code: blockCode },
    defaults: { tenantId, cemeteryId, code: blockCode, name: blockCode },
    transaction,
  });
  const [streetRow] = await Street.findOrCreate({
    where: { tenantId, blockId: blockRow.id, code: streetCode },
    defaults: { tenantId, cemeteryId, blockId: blockRow.id, code: streetCode, name: streetName || 'Geral' },
    transaction,
  });
  const [lotRow] = await Lot.findOrCreate({
    where: { tenantId, streetId: streetRow.id, code: lotCode },
    defaults: { tenantId, cemeteryId, streetId: streetRow.id, code: lotCode, name: lotCode },
    transaction,
  });
  return lotRow;
}

/**
 * CÓDIGO da sepultura derivado de QUADRA-LOTE.
 *
 * O sistema do cliente não pede um código: a sepultura é "Quadra Q4P1C4, Lote
 * 01". Montamos o código a partir disso e, quando a mesma quadra/lote já tem
 * sepultura, acrescentamos um sufixo sequencial (-2, -3, ...). O código segue
 * ÚNICO por cemitério, que é o que o índice exige.
 *
 * Só conta sepulturas ATIVAS. O índice de unicidade é PARCIAL
 * (`graves_cemetery_id_code_active_unique ON graves (cemetery_id, code)
 * WHERE deleted_at IS NULL`, migration 20260717000001), portanto uma linha
 * soft-deleted NÃO ocupa o código e não colide no insert.
 *
 * Antes esta busca usava `paranoid: false` e enxergava as apagadas: o cliente
 * criava e excluía a MESMA sepultura repetidas vezes e o código ia ganhando
 * sufixo a cada rodada (12-12BLOCO18, -2, -3, -4, -5). Mesmo bug de subdomínio
 * preso por cidade apagada, resolvido em tenants.service. Recriar uma sepultura
 * excluída deve reaproveitar o código natural; a unicidade entre ATIVAS
 * continua garantida pelo sufixo + pelo índice parcial.
 */
async function nextGraveCode(tenantId, lot, transaction) {
  const block = await Block.findOne({
    where: { tenantId, id: (await Street.findByPk(lot.streetId, { transaction }))?.blockId || null },
    transaction,
  });
  const base = [block?.code, lot.code].filter(Boolean).join('-') || 'SEP';

  const taken = await Grave.findAll({
    where: { tenantId, cemeteryId: lot.cemeteryId, code: { [Op.like]: `${base}%` } },
    attributes: ['code'],
    raw: true,
    transaction,
  });
  const used = new Set(taken.map((g) => g.code));
  if (!used.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base}-${n}`;
    if (!used.has(candidate)) return candidate;
  }
}

async function create(tenantId, data, userId) {
  const grave = await sequelize.transaction(async (transaction) => {
    // Jazigo pai (gaveta) — validado antes: pode fornecer o LOTE por herança,
    // então a gaveta é cadastrada só com o pai + o número (código), sem redigitar
    // quadra/lote (fluxo "Gavetas › Novo" do sistema antigo).
    let parent = null;
    if (data.parentGraveId) {
      parent = await Grave.findOne({ where: { id: data.parentGraveId, tenantId }, transaction });
      if (!parent) throw AppError.notFound('Jazigo pai não encontrado.');
      if (parent.unitType !== 'jazigo' && parent.unitType !== 'tumulo') {
        throw AppError.badRequest('Gavetas só podem pertencer a jazigos ou túmulos.', 'INVALID_PARENT');
      }
    }

    // LOCAL: `lotId` direto (compat) OU quadra/lote por TEXTO OU herda do pai.
    let lot;
    if (data.lotId) {
      lot = await Lot.findOne({ where: { id: data.lotId, tenantId }, transaction });
      if (!lot) throw AppError.notFound('Lote não encontrado.');
    } else if (data.cemeteryId && data.block && data.lot) {
      lot = await resolveLotFromText(
        tenantId,
        { cemeteryId: data.cemeteryId, block: data.block, street: data.street, lot: data.lot },
        transaction
      );
    } else if (parent) {
      lot = await Lot.findOne({ where: { id: parent.lotId, tenantId }, transaction });
      if (!lot) throw AppError.notFound('Lote do jazigo pai não encontrado.');
    } else {
      throw AppError.badRequest('Informe o cemitério, a quadra e o lote.', 'MISSING_LOCATION');
    }

    const status = data.statusId
      ? await graveStatuses.resolve(tenantId, { id: data.statusId })
      : await graveStatuses.resolve(tenantId, { slug: 'livre' });

    // Só campos de coluna real entram no create (block/lot/quadra/ownerPersonId
    // etc. são de entrada, não colunas de Grave).
    const graveData = {};
    for (const f of EDITABLE_FIELDS) {
      if (data[f] !== undefined) graveData[f] = data[f];
    }

    // CÓDIGO automático: no sistema do cliente a sepultura é identificada por
    // cemitério + quadra + lote — não existe um "código da unidade" para digitar.
    // Derivamos daí e desempatamos com sufixo quando a mesma quadra/lote tem
    // mais de uma sepultura (o código continua ÚNICO por cemitério).
    if (!graveData.code) {
      graveData.code = await nextGraveCode(tenantId, lot, transaction);
    }

    const grave = await Grave.create(
      {
        tenantId,
        cemeteryId: lot.cemeteryId,
        lotId: lot.id,
        parentGraveId: data.parentGraveId || null,
        statusId: status.id,
        ...graveData,
      },
      { transaction }
    );

    await graveEvents.record(
      {
        tenantId, graveId: grave.id, eventType: 'outro',
        title: 'Sepultura cadastrada',
        metadata: { code: grave.code, unitType: grave.unitType },
        userId,
      },
      { transaction }
    );
    return grave;
  });

  // PROPRIETÁRIO opcional → EMITE a concessão pelo fluxo oficial (fora da
  // transação da sepultura). Assim a concessão perpétua também gera a CERTIDÃO
  // DE PERPETUIDADE (concessions.issue cuida do documento). Perpétua quando a
  // utilização indicar perpetuidade; senão temporária. Best-effort: a sepultura
  // já criada não é desfeita se a emissão falhar.
  if (data.ownerPersonId) {
    try {
      const concessions = require('../concessions/concessions.service');
      const isPerpetua = isPerpetualUse(data.utilizacao);
      await concessions.issue(
        tenantId,
        grave.id,
        {
          personId: data.ownerPersonId,
          responsiblePersonId: data.responsiblePersonId || null,
          concessionType: isPerpetua ? 'perpetua' : 'temporaria',
        },
        userId
      );
    } catch (err) {
      console.error('[graves] emissão da concessão do proprietário falhou:', err.message);
    }
  }

  // CERTIDÃO DE PERPETUIDADE: sai sempre que a utilização for "Perpétuo" —
  // com ou sem proprietário. Idempotente (a emissão da concessão pode já ter
  // gerado). Best-effort: não desfaz a sepultura criada.
  await tryPerpetuityCertificate(tenantId, grave, userId);

  return grave;
}

async function update(tenantId, id, data, userId) {
  const grave = await getById(tenantId, id, { includes: [] });

  // RELOCAÇÃO: cemitério/quadra/lote deixaram de ser imutáveis. Só se corrigia
  // erro de cadastro apagando e recriando a sepultura — o que levava junto o
  // histórico, os documentos e a demarcação no mapa. A estrutura de destino é
  // criada se não existir, mesma regra do cadastro.
  let novoLote = null;
  if (data.cemeteryId || data.block || data.lot || data.street) {
    novoLote = await resolveLotFromText(tenantId, {
      cemeteryId: data.cemeteryId || grave.cemeteryId,
      block: data.block,
      street: data.street,
      lot: data.lot,
    });
    data.lotId = novoLote.id;
    data.cemeteryId = novoLote.cemeteryId;
  }

  const campos = {};
  for (const f of [...EDITABLE_FIELDS, 'lotId', 'cemeteryId']) {
    if (data[f] !== undefined) campos[f] = data[f];
  }

  // RECALCULA O CÓDIGO quando o lote muda. O code é DERIVADO de quadra-lote
  // (ver nextGraveCode) e era gravado só no cadastro: ao corrigir o número do
  // jazigo (ex.: 49 → 99), a tela mostrava o lote novo mas o `code` continuava
  // "M4-49" congelado — a "referência errada" relatada pelo cliente. Só
  // recalculamos quando o operador NÃO informou um código explícito (o
  // formulário padrão não informa) e o lote realmente mudou.
  if (novoLote && data.code === undefined && novoLote.id !== grave.lotId) {
    campos.code = await nextGraveCode(tenantId, novoLote);
  }

  await grave.update(campos);

  // PROPRIETÁRIO escolhido na edição (o dono vive em Concession, não em Grave).
  const resultadoDono = await aplicarProprietario(tenantId, grave, data, userId);

  // Passou a ser PERPÉTUA na edição (ou ganhou dono agora) → garante a certidão.
  await tryPerpetuityCertificate(tenantId, grave, userId);

  // Devolve a sepultura JÁ com o proprietário vigente: a tela reflete a troca
  // na hora, sem depender de um GET extra.
  const json = grave.toJSON();
  json.owner = await ownerOf(tenantId, grave.id);
  if (resultadoDono) json.ownerChange = resultadoDono;
  return json;
}

/** Concessão ATIVA do jazigo, no formato usado pela listagem ({ concessionId, person }). */
async function ownerOf(tenantId, graveId) {
  const c = await Concession.findOne({
    where: { tenantId, graveId, status: 'ativa' },
    include: [{ model: Person, as: 'person', attributes: ['id', 'fullName', 'cpf', 'phonePrimary'] }],
  });
  return c ? { concessionId: c.id, person: c.person } : null;
}

/**
 * Aplica o PROPRIETÁRIO informado na edição da sepultura.
 *
 * Regras (sempre pelo fluxo oficial das concessões, para a certidão de
 * perpetuidade e o histórico de titulares saírem corretos):
 *  - sem concessão ativa + veio proprietário → EMITE (concessions.issue), o
 *    mesmo caminho do cadastro;
 *  - concessão ativa e o proprietário MUDOU → TRANSFERE (concessions.transfer):
 *    a anterior vira 'transferida', nasce a nova e fica o ConcessionTransfer no
 *    histórico. Motivo 'regularizacao' — é uma correção de cadastro feita na
 *    tela de sepulturas, não uma venda/herança declarada;
 *  - veio VAZIO com concessão ativa → NÃO apaga nada. Encerrar uma concessão é
 *    ato administrativo (rescisão) e tem tela própria; um campo em branco no
 *    formulário não pode revogar a titularidade de um jazigo em silêncio. Só
 *    relatamos o que foi ignorado.
 *
 * Best-effort: a sepultura já foi gravada e não é desfeita se a concessão
 * falhar — o erro volta em `ownerChange` e fica na auditoria.
 */
async function aplicarProprietario(tenantId, grave, data, userId) {
  if (data.ownerPersonId === undefined && data.responsiblePersonId === undefined) return null;

  const novoDono = data.ownerPersonId || null;
  const ativa = await Concession.findOne({ where: { tenantId, graveId: grave.id, status: 'ativa' } });
  const concessions = require('../concessions/concessions.service');

  try {
    if (!novoDono) {
      if (!ativa) return { acao: 'nenhuma' };
      return {
        acao: 'ignorado',
        motivo: 'Proprietário em branco não encerra a concessão ativa. Use a rescisão da concessão.',
      };
    }

    const tipo = isPerpetualUse(grave.utilizacao) ? 'perpetua' : 'temporaria';

    if (!ativa) {
      const nova = await concessions.issue(
        tenantId, grave.id,
        {
          personId: novoDono,
          responsiblePersonId: data.responsiblePersonId || null,
          concessionType: tipo,
        },
        userId
      );
      return { acao: 'emitida', concessionId: nova.id };
    }

    if (ativa.personId !== novoDono) {
      const { concession } = await concessions.transfer(
        tenantId, ativa.id,
        {
          toPersonId: novoDono,
          transferReason: 'regularizacao',
          concessionType: tipo,
          notes: 'Troca de proprietário pela edição da sepultura.',
        },
        userId
      );
      if (data.responsiblePersonId !== undefined) {
        await concession.update({ responsiblePersonId: data.responsiblePersonId || null });
      }
      return { acao: 'transferida', concessionId: concession.id, deId: ativa.personId };
    }

    // Mesmo proprietário: só o responsável pode ter mudado.
    if (data.responsiblePersonId !== undefined
      && (ativa.responsiblePersonId || null) !== (data.responsiblePersonId || null)) {
      await ativa.update({ responsiblePersonId: data.responsiblePersonId || null });
      await graveEvents.record({
        tenantId, graveId: grave.id, eventType: 'concessao',
        title: 'Responsável pela sepultura atualizado',
        referenceType: 'concession', referenceId: ativa.id,
        metadata: { responsiblePersonId: data.responsiblePersonId || null },
        userId,
      });
      return { acao: 'responsavel_atualizado', concessionId: ativa.id };
    }
    return { acao: 'nenhuma' };
  } catch (err) {
    console.error('[graves] troca de proprietário na edição falhou:', err.message, err.stack);
    audit.record({
      action: 'edicao',
      entityType: 'Sepultura',
      entityId: grave.id,
      description: `FALHA ao aplicar o proprietário na edição: ${err.message}`,
      newData: { erro: err.message, ownerPersonId: novoDono },
    });
    return { acao: 'falhou', erro: err.message };
  }
}

// Mudança de status com registro obrigatório na timeline
async function changeStatus(tenantId, id, { statusId, slug, reason }, userId) {
  return sequelize.transaction(async (transaction) => {
    const grave = await Grave.findOne({ where: { id, tenantId }, include: [{ model: GraveStatus, as: 'status' }], transaction });
    if (!grave) throw AppError.notFound('Sepultura não encontrada.');
    const newStatus = await graveStatuses.resolve(tenantId, { id: statusId, slug });

    const oldStatus = grave.status;
    await grave.update({ statusId: newStatus.id }, { transaction });

    await graveEvents.record(
      {
        tenantId, graveId: grave.id, eventType: 'alteracao_status',
        title: `Status alterado: ${oldStatus?.name || '—'} → ${newStatus.name}`,
        description: reason || null,
        metadata: { from: oldStatus?.slug, to: newStatus.slug },
        userId,
      },
      { transaction }
    );
    return getById(tenantId, id);
  });
}

// Bloqueio/desbloqueio operacional (ex.: inadimplência) — trava sepultamentos/reformas
async function setBlocked(tenantId, id, { blocked, reason }, userId) {
  return sequelize.transaction(async (transaction) => {
    const grave = await Grave.findOne({ where: { id, tenantId }, transaction });
    if (!grave) throw AppError.notFound('Sepultura não encontrada.');
    await grave.update(
      { isBlocked: Boolean(blocked), blockedReason: blocked ? reason || 'Bloqueio administrativo' : null },
      // skipAudit: o hook genérico logaria 'edicao'; registramos o semântico
      // 'bloqueio'/'desbloqueio' explicitamente abaixo.
      { transaction, skipAudit: true }
    );
    await graveEvents.record(
      {
        tenantId, graveId: grave.id,
        eventType: blocked ? 'bloqueio' : 'desbloqueio',
        title: blocked ? `Jazigo bloqueado: ${reason || 'sem motivo informado'}` : 'Jazigo desbloqueado',
        userId,
      },
      { transaction }
    );

    // Auditoria semântica — bloqueio/desbloqueio operacional do jazigo.
    audit.record({
      action: blocked ? 'bloqueio' : 'desbloqueio',
      entityType: 'Sepultura',
      entityId: grave.id,
      description: `Jazigo ${grave.code} ${blocked ? 'bloqueado' : 'desbloqueado'}`,
      newData: { motivo: blocked ? reason || 'Bloqueio administrativo' : null },
    });
    return grave;
  });
}

/**
 * IMPACTO da exclusão: o que está preso à sepultura e o que aconteceria com
 * cada coisa. Serve para a tela mostrar ao operador, ANTES de confirmar,
 * exatamente o que ele está prestes a arrastar junto — em vez de só barrar com
 * uma mensagem seca ou apagar silenciosamente.
 */
async function deleteImpact(tenantId, id) {
  const grave = await getById(tenantId, id, { includes: [] });

  const [activeBurials, occupants, activeConcessions, documents] = await Promise.all([
    Burial.count({ where: { tenantId, graveId: id, status: 'ativo' } }),
    Deceased.findAll({
      where: { tenantId, currentGraveId: id },
      attributes: ['id', 'fullName'],
      raw: true,
    }),
    Concession.count({ where: { tenantId, graveId: id, status: 'ativa' } }),
    Document.count({ where: { tenantId, graveId: id } }),
  ]);

  return {
    code: grave.code,
    blocked: activeBurials > 0,
    activeBurials,
    occupants: occupants.map((d) => d.fullName),
    activeConcessions,
    documents,
  };
}

/**
 * Exclusão da sepultura.
 *
 * Sem `force`, sepultura ocupada é barrada — é a regra que protege o operador
 * de apagar um registro com corpo dentro. Com `force` (confirmação explícita na
 * tela, listando o impacto), a exclusão prossegue e ARRASTA o que a bloqueava:
 * os sepultamentos ativos são encerrados e os sepultados desvinculados; as
 * concessões ativas são encerradas.
 *
 * O que NUNCA é apagado: os DOCUMENTOS já emitidos (certidão, autorização).
 * São registro civil e continuam disponíveis em Documentos.
 */
async function remove(tenantId, id, { force = false, userId = null } = {}) {
  const grave = await getById(tenantId, id, { includes: [] });
  const activeBurials = await Burial.count({ where: { tenantId, graveId: id, status: 'ativo' } });

  if (activeBurials > 0 && !force) {
    throw AppError.conflict('Sepultura possui sepultamentos ativos — não pode ser excluída.', 'GRAVE_OCCUPIED');
  }

  await sequelize.transaction(async (transaction) => {
    if (force) {
      await Burial.update(
        { status: 'transladado' },
        { where: { tenantId, graveId: id, status: 'ativo' }, transaction }
      );
      await Deceased.update(
        { currentGraveId: null },
        { where: { tenantId, currentGraveId: id }, transaction }
      );
      await Concession.update(
        { status: 'encerrada' },
        { where: { tenantId, graveId: id, status: 'ativa' }, transaction }
      );
    }
    await grave.destroy({ transaction }); // soft delete
  });

  if (force) {
    audit.record({
      action: 'exclusao',
      entityType: 'Sepultura',
      entityId: id,
      description: `Sepultura ${grave.code} excluída COM FORÇA: ${activeBurials} sepultamento(s) encerrado(s).`,
      newData: { forcado: true, sepultamentosEncerrados: activeBurials },
      userId,
    });
  }
}

/**
 * Upload da FOTOGRAFIA da sepultura (base64). Espelha deceased.uploadPhoto:
 * valida tipo/tamanho, grava via storage e devolve a URL ASSINADA para exibição
 * imediata no painel.
 */
async function uploadPhoto(tenantId, id, { contentBase64, fileName, mimeType } = {}) {
  const grave = await Grave.findOne({ where: { id, tenantId } });
  if (!grave) throw AppError.notFound('Sepultura não encontrada.');

  if (!contentBase64) throw AppError.badRequest('Envie o arquivo da foto (contentBase64).', 'MISSING_FILE');
  const mime = String(mimeType || '').toLowerCase();
  if (!PHOTO_MIME_TYPES.includes(mime)) {
    throw AppError.badRequest('Formato inválido. Envie uma imagem PNG, JPEG ou WEBP.', 'INVALID_IMAGE_TYPE');
  }
  const buffer = Buffer.from(contentBase64, 'base64');
  if (!buffer.length) throw AppError.badRequest('Arquivo de foto vazio ou inválido.', 'INVALID_FILE');
  if (buffer.length > PHOTO_MAX_BYTES) {
    throw AppError.badRequest('Imagem muito grande. O limite é 5 MB.', 'FILE_TOO_LARGE');
  }

  const saved = await storage.saveFile({
    tenantId,
    fileName: fileName || 'sepultura.png',
    content: buffer,
    mimeType: mime,
  });
  await grave.update({ photoUrl: saved.fileUrl });
  return { photoUrl: signPhoto(saved.fileUrl) };
}

module.exports = {
  list, statusCounts, getById, summary, create, update, changeStatus, setBlocked, remove, deleteImpact,
  uploadPhoto, EDITABLE_FIELDS,
  // reaproveitados pelo backfill de certidões (mesma regra da emissão automática)
  ensurePerpetuityCertificate, isPerpetualUse,
};
