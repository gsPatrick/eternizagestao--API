'use strict';

const { Op } = require('sequelize');
const AppError = require('../../utils/app-error');
const { getPagination, buildPageMeta } = require('../../utils/pagination');
const graveEvents = require('../grave-timeline/grave-event.recorder');
const graveStatuses = require('../grave-statuses/grave-statuses.service');
const audit = require('../audit-logs/audit.service');
const {
  sequelize, Grave, GraveStatus, Lot, Street, Block, Cemetery,
  Concession, Person, Burial, Deceased,
} = require('../../models');

const EDITABLE_FIELDS = [
  'code', 'unitType', 'capacity', 'geoPolygon', 'latitude', 'longitude',
  'photoUrl', 'areaM2', 'notes',
  // Campos oficiais dos modelos de documento (certidão/autorização).
  'utilizacao', 'tombType', 'carneiraPermission',
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
  if (query.blocked !== undefined) where.isBlocked = query.blocked === 'true';
  if (query.onlyRoot === 'true' || query.onlyRoot === true) where.parentGraveId = null;

  // busca livre: código OU nome do concessionário titular (concessão ativa)
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
  const required = Boolean(query.blockId || query.streetId);
  return { model: Lot, as: 'lot', required, include: [streetInclude] };
}

// include APENAS para filtrar (quadra/rua) sem selecionar colunas — necessário
// em queries agrupadas (statusCounts): trazer colunas do lote/rua/quadra sem
// pô-las no GROUP BY quebra o Postgres ("column lot.id must appear in GROUP BY").
function lotFilterInclude(query) {
  const blockInclude = { model: Block, as: 'block', attributes: [], required: true };
  if (query.blockId) blockInclude.where = { id: query.blockId };
  const streetInclude = {
    model: Street, as: 'street', attributes: [], required: true,
    include: [blockInclude],
  };
  if (query.streetId) streetInclude.where = { id: query.streetId };
  return { model: Lot, as: 'lot', attributes: [], required: true, include: [streetInclude] };
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
      lotInclude(query),
    ],
  });

  // Enriquecimento por página (evita multiplicação de linhas de hasMany na paginação):
  // ocupação (sepultamentos ativos) e concessionário titular de cada jazigo.
  const ids = rows.map((g) => g.id);
  const occupancyByGrave = {};
  const ownerByGrave = {};
  if (ids.length) {
    const counts = await Burial.findAll({
      where: { tenantId, graveId: { [Op.in]: ids }, status: 'ativo' },
      attributes: ['graveId', [sequelize.fn('COUNT', sequelize.col('id')), 'total']],
      group: ['graveId'],
      raw: true,
    });
    counts.forEach((c) => { occupancyByGrave[c.graveId] = Number(c.total); });

    const concessions = await Concession.findAll({
      where: { tenantId, graveId: { [Op.in]: ids }, status: 'ativa' },
      include: [{ model: Person, as: 'person', attributes: ['id', 'fullName', 'cpf', 'phonePrimary'] }],
    });
    concessions.forEach((c) => { if (!ownerByGrave[c.graveId]) ownerByGrave[c.graveId] = c; });
  }

  const data = rows.map((g) => {
    const json = g.toJSON();
    const active = occupancyByGrave[g.id] || 0;
    json.activeBurials = active;
    json.available = Math.max(0, (g.capacity || 0) - active);
    json.occupancy = `${active}/${g.capacity || 0}`;
    json.isMapped = Boolean(g.geoPolygon);
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
    include: (query.blockId || query.streetId) ? [lotFilterInclude(query)] : [],
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

async function create(tenantId, data, userId) {
  return sequelize.transaction(async (transaction) => {
    const lot = await Lot.findOne({ where: { id: data.lotId, tenantId }, transaction });
    if (!lot) throw AppError.notFound('Lote não encontrado.');

    // gaveta precisa de um jazigo pai válido do mesmo tenant
    if (data.parentGraveId) {
      const parent = await Grave.findOne({ where: { id: data.parentGraveId, tenantId }, transaction });
      if (!parent) throw AppError.notFound('Jazigo pai não encontrado.');
      if (parent.unitType !== 'jazigo' && parent.unitType !== 'tumulo') {
        throw AppError.badRequest('Gavetas só podem pertencer a jazigos ou túmulos.', 'INVALID_PARENT');
      }
    }

    const status = data.statusId
      ? await graveStatuses.resolve(tenantId, { id: data.statusId })
      : await graveStatuses.resolve(tenantId, { slug: 'livre' });

    const grave = await Grave.create(
      {
        tenantId,
        cemeteryId: lot.cemeteryId,
        lotId: lot.id,
        parentGraveId: data.parentGraveId || null,
        statusId: status.id,
        ...data,
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
}

async function update(tenantId, id, data) {
  const grave = await getById(tenantId, id, { includes: [] });
  return grave.update(data);
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

async function remove(tenantId, id) {
  const grave = await getById(tenantId, id, { includes: [] });
  const activeBurials = await Burial.count({ where: { graveId: id, status: 'ativo' } });
  if (activeBurials > 0) {
    throw AppError.conflict('Sepultura possui sepultamentos ativos — não pode ser excluída.', 'GRAVE_OCCUPIED');
  }
  await grave.destroy(); // soft delete
}

module.exports = {
  list, statusCounts, getById, summary, create, update, changeStatus, setBlocked, remove, EDITABLE_FIELDS,
};
