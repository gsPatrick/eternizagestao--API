'use strict';

const { Op } = require('sequelize');
const AppError = require('../../utils/app-error');
const storage = require('../../providers/storage');
const { Cemetery, Orthophoto, MapPath, Block, Street, Lot, Grave } = require('../../models');

// TTL longo (7 dias) para a ortofoto do mapa PÚBLICO: a página não tem sessão e
// rebusca fresco; a URL assinada precisa sobreviver ao tempo de visita.
const ORTHO_TTL_SECONDS = Number(process.env.ORTHOPHOTO_URL_TTL_SECONDS || 7 * 24 * 3600);

// Mapa público do cemitério: ortofoto ativa + camadas de polígonos
async function cemeteryMap(tenantId, cemeteryId) {
  const cemetery = await Cemetery.findOne({
    where: { id: cemeteryId, tenantId, active: true },
    attributes: ['id', 'name', 'entranceLatitude', 'entranceLongitude', 'geoPolygon'],
  });
  if (!cemetery) throw AppError.notFound('Cemitério não encontrado.');

  const [orthophoto, blocks, streets, lots, graves] = await Promise.all([
    Orthophoto.findOne({
      where: { tenantId, cemeteryId, isActive: true },
      attributes: ['id', 'fileUrl', 'bounds', 'widthPx', 'heightPx', 'corners', 'opacity'],
    }),
    Block.findAll({ where: { tenantId, cemeteryId }, attributes: ['id', 'code', 'name', 'geoPolygon'] }),
    Street.findAll({ where: { tenantId, cemeteryId }, attributes: ['id', 'code', 'name', 'geoPolygon'] }),
    Lot.findAll({ where: { tenantId, cemeteryId }, attributes: ['id', 'code', 'geoPolygon'] }),
    Grave.findAll({
      where: {
        tenantId, cemeteryId,
        [Op.or]: [{ geoPolygon: { [Op.ne]: null } }, { latitude: { [Op.ne]: null } }],
      },
      attributes: ['id', 'code', 'geoPolygon', 'latitude', 'longitude'],
    }),
  ]);

  // A ortofoto é exibida via <img>/<iframe> sem token na URL crua → assina.
  let orthophotoOut = orthophoto;
  if (orthophoto) {
    orthophotoOut = orthophoto.toJSON();
    if (orthophotoOut.fileUrl) {
      orthophotoOut.fileUrl = storage.signedUrl(orthophotoOut.fileUrl, { ttlSeconds: ORTHO_TTL_SECONDS });
    }
  }

  return { cemetery, orthophoto: orthophotoOut, layers: { blocks, streets, lots, graves } };
}

// Dados para navegação GPS: entrada → sepultura + malha de caminhos
async function graveRoute(tenantId, graveId) {
  const grave = await Grave.findOne({
    where: { id: graveId, tenantId },
    attributes: ['id', 'code', 'latitude', 'longitude', 'cemeteryId'],
  });
  if (!grave) throw AppError.notFound('Sepultura não encontrada.');
  if (grave.latitude == null || grave.longitude == null) {
    throw AppError.notFound('Sepultura ainda não mapeada no GPS.', 'GRAVE_NOT_MAPPED');
  }

  const cemetery = await Cemetery.findOne({
    where: { id: grave.cemeteryId, tenantId },
    attributes: ['id', 'name', 'entranceLatitude', 'entranceLongitude'],
  });
  const paths = await MapPath.findAll({
    where: { tenantId, cemeteryId: grave.cemeteryId, isActive: true },
    attributes: ['id', 'name', 'pathCoordinates'],
  });

  // o roteamento fino (menor caminho na malha) é responsabilidade do app cliente
  return {
    entrance: { latitude: cemetery?.entranceLatitude, longitude: cemetery?.entranceLongitude },
    target: { latitude: grave.latitude, longitude: grave.longitude, code: grave.code },
    paths,
  };
}

module.exports = { cemeteryMap, graveRoute };
