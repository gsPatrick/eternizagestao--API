'use strict';

const { Op, fn, col } = require('sequelize');
const AppError = require('../../utils/app-error');
const { getPagination, buildPageMeta } = require('../../utils/pagination');
const { Cemetery, Block, Street, Lot, Grave, GraveStatus } = require('../../models');

/**
 * Hierarquia espacial: Cemetery → Block (quadra) → Street (rua) → Lot (lote).
 * Os três níveis têm o mesmo shape; a descrição de cada nível fica em LEVELS
 * e as operações são genéricas — evita triplicação de CRUD sem esconder lógica.
 */
const LEVELS = {
  block: {
    model: Block,
    label: 'Quadra',
    parentKey: 'cemeteryId',
    parentModel: Cemetery,
    parentLabel: 'Cemitério',
  },
  street: {
    model: Street,
    label: 'Rua',
    parentKey: 'blockId',
    parentModel: Block,
    parentLabel: 'Quadra',
  },
  lot: {
    model: Lot,
    label: 'Lote',
    parentKey: 'streetId',
    parentModel: Street,
    parentLabel: 'Rua',
  },
};

function getLevel(levelName) {
  const level = LEVELS[levelName];
  if (!level) throw AppError.badRequest(`Nível desconhecido: ${levelName}`);
  return level;
}

// Garante que o pai existe e pertence ao tenant (isolamento multi-tenant)
async function assertParent(level, tenantId, parentId) {
  const parent = await level.parentModel.findOne({ where: { id: parentId, tenantId } });
  if (!parent) throw AppError.notFound(`${level.parentLabel} não encontrado(a).`);
  return parent;
}

async function listByParent(levelName, tenantId, parentId, query) {
  const level = getLevel(levelName);
  await assertParent(level, tenantId, parentId);
  const { page, perPage, limit, offset } = getPagination(query, { defaultPerPage: 50 });
  const { rows, count } = await level.model.findAndCountAll({
    where: { tenantId, [level.parentKey]: parentId },
    limit,
    offset,
    order: [['code', 'ASC']],
  });
  return { rows, meta: buildPageMeta(count, page, perPage) };
}

async function getById(levelName, tenantId, id) {
  const level = getLevel(levelName);
  const record = await level.model.findOne({ where: { id, tenantId } });
  if (!record) throw AppError.notFound(`${level.label} não encontrado(a).`);
  return record;
}

async function create(levelName, tenantId, parentId, data) {
  const level = getLevel(levelName);
  const parent = await assertParent(level, tenantId, parentId);
  // streets/lots herdam o cemeteryId do pai para consultas rápidas
  const cemeteryId = levelName === 'block' ? parent.id : parent.cemeteryId;
  return level.model.create({
    tenantId,
    cemeteryId,
    [level.parentKey]: parentId,
    name: data.name,
    code: data.code,
    geoPolygon: data.geoPolygon,
    notes: data.notes,
  });
}

async function update(levelName, tenantId, id, data) {
  const record = await getById(levelName, tenantId, id);
  // parentKey não é editável — mover de pai é operação estrutural (nova criação).
  // PATCH parcial: só sobrescreve os campos presentes (ex.: salvar apenas
  // geoPolygon ao demarcar a camada no mapa não pode zerar name/code).
  const patch = {};
  for (const key of ['name', 'code', 'geoPolygon', 'notes']) {
    if (data[key] !== undefined) patch[key] = data[key];
  }
  return record.update(patch);
}

async function remove(levelName, tenantId, id) {
  const record = await getById(levelName, tenantId, id);
  try {
    await record.destroy();
  } catch (err) {
    if (err.name === 'SequelizeForeignKeyConstraintError') {
      throw AppError.conflict(
        'Não é possível excluir: existem registros vinculados a este nível.',
        'HAS_CHILDREN'
      );
    }
    throw err;
  }
}

// Contagens de sepulturas (total e livres) por lote, do cemitério inteiro.
// Duas queries agrupadas por lot_id — evita N+1 percorrendo a árvore.
async function graveCountsByLot(tenantId, cemeteryId) {
  const where = { tenantId, cemeteryId };
  const [totals, frees] = await Promise.all([
    Grave.findAll({
      where,
      attributes: ['lotId', [fn('COUNT', col('id')), 'count']],
      group: ['lotId'],
      raw: true,
    }),
    Grave.findAll({
      where,
      attributes: ['lotId', [fn('COUNT', col('Grave.id')), 'count']],
      include: [{ model: GraveStatus, as: 'status', attributes: [], where: { slug: 'livre' }, required: true }],
      group: ['lotId'],
      raw: true,
    }),
  ]);
  const map = {};
  totals.forEach((r) => { map[r.lotId] = { graves: Number(r.count), free: 0 }; });
  frees.forEach((r) => { if (map[r.lotId]) map[r.lotId].free = Number(r.count); });
  return map;
}

// Árvore completa de um cemitério (para telas de navegação/mapa), com contadores
// de sepulturas por lote e agregados por rua e por quadra (total/livres/ocupação).
async function tree(tenantId, cemeteryId) {
  const cemetery = await Cemetery.findOne({ where: { id: cemeteryId, tenantId } });
  if (!cemetery) throw AppError.notFound('Cemitério não encontrado.');
  const blocks = await Block.findAll({
    where: { tenantId, cemeteryId },
    order: [['code', 'ASC']],
    include: [{
      model: Street,
      as: 'streets',
      include: [{ model: Lot, as: 'lots' }],
    }],
  });

  const lotCounts = await graveCountsByLot(tenantId, cemeteryId);
  const rollup = (graves, free) => ({ graves, free, occupancy: graves > 0 ? Math.round(((graves - free) / graves) * 100) : 0 });

  const blocksJson = blocks.map((block) => {
    const b = block.toJSON();
    let blockGraves = 0;
    let blockFree = 0;
    b.streets = (b.streets || []).map((street) => {
      let streetGraves = 0;
      let streetFree = 0;
      street.lots = (street.lots || []).map((lot) => {
        const counts = lotCounts[lot.id] || { graves: 0, free: 0 };
        streetGraves += counts.graves;
        streetFree += counts.free;
        return { ...lot, stats: rollup(counts.graves, counts.free) };
      });
      blockGraves += streetGraves;
      blockFree += streetFree;
      return { ...street, stats: { ...rollup(streetGraves, streetFree), lots: street.lots.length } };
    });
    return { ...b, stats: { ...rollup(blockGraves, blockFree), streets: b.streets.length } };
  });

  return { cemetery, blocks: blocksJson };
}

module.exports = { listByParent, getById, create, update, remove, tree, graveCountsByLot };
