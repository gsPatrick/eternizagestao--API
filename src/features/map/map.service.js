'use strict';

const AppError = require('../../utils/app-error');
const storage = require('../../providers/storage');
const { Cemetery, Orthophoto, MapPath, Grave } = require('../../models');

// TTL longo (7 dias) para a URL assinada da ortofoto: é branding/mapa exibido via
// <img>/<iframe>, o painel rebusca fresco antes de expirar.
const ORTHO_TTL_SECONDS = Number(process.env.ORTHOPHOTO_URL_TTL_SECONDS || 7 * 24 * 3600);

// Serializa uma Orthophoto trocando o fileUrl cru (/files/...) pela URL ASSINADA.
function serializeOrthophoto(ortho) {
  if (!ortho) return ortho;
  const json = typeof ortho.toJSON === 'function' ? ortho.toJSON() : { ...ortho };
  if (json.fileUrl) json.fileUrl = storage.signedUrl(json.fileUrl, { ttlSeconds: ORTHO_TTL_SECONDS });
  return json;
}

async function assertCemetery(tenantId, cemeteryId) {
  const cemetery = await Cemetery.findOne({ where: { id: cemeteryId, tenantId } });
  if (!cemetery) throw AppError.notFound('Cemitério não encontrado.');
  return cemetery;
}

// ---- Ortofotos ----
async function listOrthophotos(tenantId, cemeteryId) {
  await assertCemetery(tenantId, cemeteryId);
  const rows = await Orthophoto.findAll({ where: { tenantId, cemeteryId }, order: [['createdAt', 'DESC']] });
  return rows.map(serializeOrthophoto);
}

async function uploadOrthophoto(tenantId, cemeteryId, data) {
  await assertCemetery(tenantId, cemeteryId);
  let fileUrl = data.fileUrl;
  if (data.contentBase64) {
    const saved = await storage.saveFile({
      tenantId,
      fileName: data.fileName || 'ortofoto.png',
      contentBase64: data.contentBase64,
      mimeType: data.mimeType || 'image/png',
    });
    fileUrl = saved.fileUrl;
  }
  if (!fileUrl) throw AppError.badRequest('Informe contentBase64 (arquivo) ou fileUrl.', 'MISSING_FILE');

  const ortho = await Orthophoto.create({
    tenantId, cemeteryId, fileUrl,
    name: data.name,
    bounds: data.bounds,
    widthPx: data.widthPx,
    heightPx: data.heightPx,
    resolutionCmPx: data.resolutionCmPx,
    capturedAt: data.capturedAt,
  });

  // apenas uma ortofoto ativa por cemitério
  if (data.setActive !== false) {
    await Orthophoto.update(
      { isActive: false },
      { where: { tenantId, cemeteryId, id: { [require('sequelize').Op.ne]: ortho.id } } }
    );
    await ortho.update({ isActive: true });
  }
  return serializeOrthophoto(ortho);
}

async function updateOrthophoto(tenantId, id, data) {
  const ortho = await Orthophoto.findOne({ where: { id, tenantId } });
  if (!ortho) throw AppError.notFound('Ortofoto não encontrada.');
  const { name, bounds, widthPx, heightPx, resolutionCmPx, capturedAt, isActive } = data;
  await ortho.update({ name, bounds, widthPx, heightPx, resolutionCmPx, capturedAt, isActive });
  return serializeOrthophoto(ortho);
}

// ---- Malha de caminhos (navegação GPS) ----
async function listPaths(tenantId, cemeteryId) {
  await assertCemetery(tenantId, cemeteryId);
  return MapPath.findAll({ where: { tenantId, cemeteryId, isActive: true } });
}

async function createPath(tenantId, cemeteryId, data) {
  await assertCemetery(tenantId, cemeteryId);
  if (!Array.isArray(data.pathCoordinates) || data.pathCoordinates.length < 2) {
    throw AppError.badRequest('pathCoordinates deve ser uma polilinha [[lat,lng], ...] com 2+ pontos.', 'INVALID_PATH');
  }
  return MapPath.create({ tenantId, cemeteryId, name: data.name, pathCoordinates: data.pathCoordinates, notes: data.notes });
}

async function removePath(tenantId, id) {
  const path = await MapPath.findOne({ where: { id, tenantId } });
  if (!path) throw AppError.notFound('Caminho não encontrado.');
  await path.destroy();
}

// ---- Geometria da sepultura (demarcação sobre a ortofoto) ----
async function setGraveGeometry(tenantId, graveId, { geoPolygon, latitude, longitude }) {
  const grave = await Grave.findOne({ where: { id: graveId, tenantId } });
  if (!grave) throw AppError.notFound('Sepultura não encontrada.');
  if (geoPolygon && (!Array.isArray(geoPolygon) || geoPolygon.length < 3)) {
    throw AppError.badRequest('geoPolygon deve ser um polígono [[lat,lng], ...] com 3+ pontos.', 'INVALID_POLYGON');
  }
  return grave.update({ geoPolygon, latitude, longitude });
}

module.exports = {
  listOrthophotos, uploadOrthophoto, updateOrthophoto,
  listPaths, createPath, removePath, setGraveGeometry,
};
