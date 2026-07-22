'use strict';

const AppError = require('../../utils/app-error');
const storage = require('../../providers/storage');
const { readGeoreference, isTiff } = require('../../utils/geotiff');
const { rasterToWebImage } = require('../../utils/raster-to-web');
const { Cemetery, Orthophoto, MapPath, Grave, Block, Street, Lot } = require('../../models');

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

// Valida o shape de corners { tl,tr,br,bl } com cada canto = [lat, lng].
function assertCorners(corners) {
  if (corners == null) return;
  const keys = ['tl', 'tr', 'br', 'bl'];
  const ok = corners && typeof corners === 'object' && keys.every((k) => {
    const c = corners[k];
    return Array.isArray(c) && c.length === 2 && c.every((n) => typeof n === 'number' && Number.isFinite(n));
  });
  if (!ok) {
    throw AppError.badRequest(
      'corners deve ser { tl:[lat,lng], tr:[lat,lng], br:[lat,lng], bl:[lat,lng] } com números.',
      'INVALID_CORNERS'
    );
  }
}

function assertOpacity(opacity) {
  if (opacity == null) return;
  if (typeof opacity !== 'number' || opacity < 0 || opacity > 1) {
    throw AppError.badRequest('opacity deve ser um número entre 0 e 1.', 'INVALID_OPACITY');
  }
}

// Zera isActive das demais ortofotos do cemitério, deixando só `keepId` ativa.
async function deactivateOthers(tenantId, cemeteryId, keepId) {
  await Orthophoto.update(
    { isActive: false },
    { where: { tenantId, cemeteryId, id: { [require('sequelize').Op.ne]: keepId } } }
  );
}

async function uploadOrthophoto(tenantId, cemeteryId, data) {
  await assertCemetery(tenantId, cemeteryId);
  assertCorners(data.corners);
  assertOpacity(data.opacity);
  let fileUrl = data.fileUrl;

  // Campos que o GeoTIFF preenche sozinho (quando for um GeoTIFF).
  let geo = null;

  if (data.content || data.contentBase64) {
    let content = data.content
      || (data.contentBase64 ? Buffer.from(data.contentBase64, 'base64') : null);
    let fileName = data.fileName || 'ortofoto.png';
    let mimeType = data.mimeType || 'image/png';

    // GEOTIFF: o ortomosaico do drone já sabe onde fica no mundo. Lendo isso, a
    // ortofoto nasce posicionada — sem ninguém encaixar a foto no mapa à mão,
    // e com a precisão da própria aerofotogrametria. Mas nenhum navegador
    // exibe TIFF, então convertemos a imagem para web e guardamos a convertida.
    if (content && isTiff(content)) {
      geo = readGeoreference(content);
      const web = await rasterToWebImage(content, geo || {});
      content = web.content;
      mimeType = web.mimeType;
      fileName = `${String(fileName).replace(/\.[^.]+$/, '')}.webp`;
    }

    const saved = await storage.saveFile({
      tenantId,
      fileName,
      content, // Buffer (upload binário) — sem inchaço do base64
      mimeType,
    });
    fileUrl = saved.fileUrl;
  }
  if (!fileUrl) throw AppError.badRequest('Informe o arquivo (binário/base64) ou fileUrl.', 'MISSING_FILE');

  const ortho = await Orthophoto.create({
    tenantId, cemeteryId, fileUrl,
    name: data.name,
    bounds: data.bounds,
    // O que veio do arquivo tem prioridade sobre o que veio da requisição: a
    // georreferência do GeoTIFF é medida, não estimada.
    corners: (geo && geo.corners) || data.corners,
    opacity: data.opacity,
    widthPx: (geo && geo.widthPx) || data.widthPx,
    heightPx: (geo && geo.heightPx) || data.heightPx,
    resolutionCmPx: (geo && geo.resolutionCmPx) || data.resolutionCmPx,
    capturedAt: data.capturedAt,
  });

  // apenas uma ortofoto ativa por cemitério
  if (data.setActive !== false) {
    await deactivateOthers(tenantId, cemeteryId, ortho.id);
    await ortho.update({ isActive: true });
  }
  return serializeOrthophoto(ortho);
}

async function updateOrthophoto(tenantId, id, data) {
  const ortho = await Orthophoto.findOne({ where: { id, tenantId } });
  if (!ortho) throw AppError.notFound('Ortofoto não encontrada.');
  assertCorners(data.corners);
  assertOpacity(data.opacity);
  // Só sobrescreve os campos presentes no payload (PATCH parcial).
  const patch = {};
  for (const key of ['name', 'bounds', 'corners', 'opacity', 'widthPx', 'heightPx', 'resolutionCmPx', 'capturedAt', 'isActive']) {
    if (data[key] !== undefined) patch[key] = data[key];
  }
  await ortho.update(patch);
  // Ao ativar via PATCH, garante unicidade da ortofoto ativa por cemitério.
  if (patch.isActive === true) await deactivateOthers(tenantId, ortho.cemeteryId, ortho.id);
  return serializeOrthophoto(ortho);
}

async function removeOrthophoto(tenantId, id) {
  const ortho = await Orthophoto.findOne({ where: { id, tenantId } });
  if (!ortho) throw AppError.notFound('Ortofoto não encontrada.');
  await ortho.destroy();
}

// Contexto do mapa: centro do cemitério (entrada GPS) + ortofoto ativa + bounds.
// Vive no domínio do MAPA para não depender da feature cemeteries.
async function getMapContext(tenantId, cemeteryId) {
  const cemetery = await assertCemetery(tenantId, cemeteryId);
  const lat = cemetery.entranceLatitude != null ? Number(cemetery.entranceLatitude) : null;
  const lng = cemetery.entranceLongitude != null ? Number(cemetery.entranceLongitude) : null;
  // Ortofoto ativa + camadas de quadra/rua/lote (espelha public-map.cemeteryMap).
  // O painel alterna essas camadas sobre a ortofoto; só as com geoPolygon são
  // desenháveis, mas devolvemos todas (o front ignora as sem geometria).
  const [active, blocks, streets, lots] = await Promise.all([
    Orthophoto.findOne({
      where: { tenantId, cemeteryId, isActive: true },
      order: [['createdAt', 'DESC']],
    }),
    Block.findAll({ where: { tenantId, cemeteryId }, attributes: ['id', 'code', 'name', 'geoPolygon'] }),
    Street.findAll({ where: { tenantId, cemeteryId }, attributes: ['id', 'code', 'name', 'geoPolygon'] }),
    Lot.findAll({ where: { tenantId, cemeteryId }, attributes: ['id', 'code', 'geoPolygon'] }),
  ]);
  const orthophoto = active ? serializeOrthophoto(active) : null;
  return {
    cemetery: {
      id: cemetery.id,
      name: cemetery.name,
      center: lat != null && lng != null ? { lat, lng } : null,
    },
    orthophoto,
    bounds: orthophoto ? orthophoto.bounds : null,
    layers: { blocks, streets, lots },
  };
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
//
// CONVENÇÃO DE COORDENADAS (geoPolygon):
//   geoPolygon é um ANEL de vértices [[lat, lng], [lat, lng], ...] (3+ pontos),
//   na MESMA ordem [latitude, longitude] usada em todo o sistema (map_paths,
//   bounds/corners da ortofoto, Leaflet). NÃO é a ordem GeoJSON [lng, lat].
//   O anel não precisa repetir o primeiro ponto no fim (não é GeoJSON estrito).
//   `latitude`/`longitude` guardam o ponto-âncora (centro/pino) da sepultura.
async function setGraveGeometry(tenantId, graveId, { geoPolygon, latitude, longitude }) {
  const grave = await Grave.findOne({ where: { id: graveId, tenantId } });
  if (!grave) throw AppError.notFound('Sepultura não encontrada.');
  if (geoPolygon && (!Array.isArray(geoPolygon) || geoPolygon.length < 3)) {
    throw AppError.badRequest('geoPolygon deve ser um polígono [[lat,lng], ...] com 3+ pontos.', 'INVALID_POLYGON');
  }
  const patch = {};
  if (geoPolygon !== undefined) patch.geoPolygon = geoPolygon;
  if (latitude !== undefined) patch.latitude = latitude;
  if (longitude !== undefined) patch.longitude = longitude;
  return grave.update(patch);
}

module.exports = {
  listOrthophotos, uploadOrthophoto, updateOrthophoto, removeOrthophoto, getMapContext,
  listPaths, createPath, removePath, setGraveGeometry,
};
