'use strict';

const { Op, fn, col } = require('sequelize');
const AppError = require('../../utils/app-error');
const { getPagination, buildPageMeta } = require('../../utils/pagination');
const { Cemetery, Block, Street, Lot, Grave, GraveStatus, Orthophoto } = require('../../models');

const EDITABLE_FIELDS = [
  'name', 'code', 'description', 'addressStreet', 'addressNumber', 'addressDistrict',
  'addressCity', 'addressState', 'addressZipcode', 'entranceLatitude', 'entranceLongitude',
  'geoPolygon', 'logoUrl', 'brandPrimaryColor', 'brandSecondaryColor',
  'managerName', 'managerDocument', 'managerPhone', 'managerEmail', 'active', 'notes',
];

/**
 * Agrega, para um conjunto de cemitérios, as contagens exibidas nas telas:
 * quadras, ruas, lotes, sepulturas (total/livres → ocupação) e se há ortofoto
 * ativa. Uma query agrupada por nível — evita N+1 por cemitério.
 */
async function statsFor(tenantId, cemeteryIds) {
  const empty = () => ({ blocks: 0, streets: 0, lots: 0, graves: 0, freeGraves: 0, occupancy: 0, hasOrthophoto: false });
  const stats = {};
  cemeteryIds.forEach((id) => { stats[id] = empty(); });
  if (!cemeteryIds.length) return stats;

  const where = { tenantId, cemeteryId: { [Op.in]: cemeteryIds } };
  const groupCount = (model) =>
    model.findAll({
      where,
      attributes: ['cemeteryId', [fn('COUNT', col('id')), 'count']],
      group: ['cemeteryId'],
      raw: true,
    });

  const [blocks, streets, lots, graves, freeGraves, orthophotos] = await Promise.all([
    groupCount(Block),
    groupCount(Street),
    groupCount(Lot),
    groupCount(Grave),
    // sepulturas livres — status de sistema 'livre'
    Grave.findAll({
      where,
      attributes: ['cemeteryId', [fn('COUNT', col('Grave.id')), 'count']],
      include: [{ model: GraveStatus, as: 'status', attributes: [], where: { slug: 'livre' }, required: true }],
      group: ['cemeteryId'],
      raw: true,
    }),
    Orthophoto.findAll({
      where: { tenantId, cemeteryId: { [Op.in]: cemeteryIds }, isActive: true },
      attributes: ['cemeteryId', [fn('COUNT', col('id')), 'count']],
      group: ['cemeteryId'],
      raw: true,
    }),
  ]);

  const apply = (rows, key) => rows.forEach((r) => { if (stats[r.cemeteryId]) stats[r.cemeteryId][key] = Number(r.count); });
  apply(blocks, 'blocks');
  apply(streets, 'streets');
  apply(lots, 'lots');
  apply(graves, 'graves');
  apply(freeGraves, 'freeGraves');
  orthophotos.forEach((r) => { if (stats[r.cemeteryId]) stats[r.cemeteryId].hasOrthophoto = Number(r.count) > 0; });

  Object.values(stats).forEach((s) => {
    s.occupancy = s.graves > 0 ? Math.round(((s.graves - s.freeGraves) / s.graves) * 100) : 0;
  });
  return stats;
}

async function list(tenantId, query) {
  const { page, perPage, limit, offset } = getPagination(query);
  const where = { tenantId };
  if (query.active !== undefined) where.active = query.active === 'true';
  if (query.search) {
    where[Op.or] = [
      { name: { [Op.iLike]: `%${query.search}%` } },
      { addressCity: { [Op.iLike]: `%${query.search}%` } },
    ];
  }

  const { rows, count } = await Cemetery.findAndCountAll({
    where, limit, offset, order: [['name', 'ASC']],
  });

  const stats = await statsFor(tenantId, rows.map((c) => c.id));
  let data = rows.map((c) => ({ ...c.toJSON(), stats: stats[c.id] }));

  // filtro por presença de ortofoto (com_ortofoto / sem_ortofoto)
  if (query.hasOrthophoto !== undefined) {
    const want = query.hasOrthophoto === 'true';
    data = data.filter((c) => c.stats.hasOrthophoto === want);
  }

  return { rows: data, meta: buildPageMeta(count, page, perPage) };
}

async function getById(tenantId, id) {
  const cemetery = await Cemetery.findOne({ where: { id, tenantId } });
  if (!cemetery) throw AppError.notFound('Cemitério não encontrado.');
  const stats = await statsFor(tenantId, [cemetery.id]);
  return { ...cemetery.toJSON(), stats: stats[cemetery.id] };
}

async function create(tenantId, data) {
  return Cemetery.create({ ...data, tenantId });
}

async function update(tenantId, id, data) {
  const cemetery = await Cemetery.findOne({ where: { id, tenantId } });
  if (!cemetery) throw AppError.notFound('Cemitério não encontrado.');
  return cemetery.update(data);
}

async function remove(tenantId, id) {
  const cemetery = await Cemetery.findOne({ where: { id, tenantId } });
  if (!cemetery) throw AppError.notFound('Cemitério não encontrado.');
  await cemetery.destroy();
}

module.exports = { list, getById, create, update, remove, statsFor, EDITABLE_FIELDS };
