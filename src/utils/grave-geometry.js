'use strict';

/**
 * GEOMETRIA EFETIVA de uma sepultura no mapa.
 *
 * A gaveta é parte física do BLOCO de gavetas (uma Grave filha, `parentGraveId`).
 * Quem é demarcado na ortofoto é o bloco — a gaveta fica exatamente ali. Antes
 * cada gaveta nascia sem geometria própria e o sistema pedia para "demarcar a
 * gaveta" (badge "Pendente", botão "Demarcar", busca pública sem "ver no mapa").
 * O cliente: "a gaveta faz parte do bloco, deveria estar automaticamente
 * apontada para o bloco em que ela foi criada e já demarcada".
 *
 * Regra: sem geometria própria, a gaveta herda a do bloco pai. Nada é gravado —
 * se o bloco for redemarcado, todas as gavetas acompanham.
 */

const GEO_ATTRS = ['id', 'code', 'geoPolygon', 'latitude', 'longitude'];

function hasOwnGeometry(g) {
  return Boolean(g && (g.geoPolygon || (g.latitude != null && g.longitude != null)));
}

/**
 * Preenche, em objetos PLANOS (toJSON), a geometria herdada do pai para as
 * gavetas sem geometria. Marca `geometryInherited: true` nas que herdaram.
 *
 * @param {import('sequelize').ModelStatic<any>} Grave
 * @param {string} tenantId
 * @param {object[]} items  objetos planos com id/parentGraveId/geoPolygon/latitude/longitude
 * @returns {Promise<object[]>} os mesmos objetos (mutados)
 */
async function inheritParentGeometry(Grave, tenantId, items) {
  const precisa = items.filter((g) => g && g.parentGraveId && !hasOwnGeometry(g));
  if (!precisa.length) return items;

  const parentIds = [...new Set(precisa.map((g) => g.parentGraveId))];
  const parents = await Grave.findAll({
    where: { tenantId, id: parentIds },
    attributes: GEO_ATTRS,
    raw: true,
  });
  const byId = new Map(parents.map((p) => [p.id, p]));

  precisa.forEach((g) => {
    const p = byId.get(g.parentGraveId);
    if (!p || !hasOwnGeometry(p)) return;
    g.geoPolygon = p.geoPolygon;
    g.latitude = p.latitude;
    g.longitude = p.longitude;
    g.geometryInherited = true;
  });
  return items;
}

module.exports = { inheritParentGeometry, hasOwnGeometry };
