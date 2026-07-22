'use strict';

/**
 * Leitor MÍNIMO de GeoTIFF — só o necessário para descobrir ONDE a ortofoto
 * fica no mundo.
 *
 * Por que existe: o ortomosaico do drone já sai georreferenciado. Quando o
 * cliente exporta como PNG/JPG, essa informação é jogada fora e alguém precisa
 * encaixar a foto no mapa na mão — trabalhoso e impreciso. Lendo o .tif
 * original, a ortofoto nasce no lugar exato, com a precisão da própria
 * aerofotogrametria.
 *
 * Implementado à mão em vez de trazer uma biblioteca de geoprocessamento: são
 * três tags e uma fórmula, e não queremos uma dependência pesada (GDAL) só
 * para isso.
 *
 * Tags usadas:
 *   33550 ModelPixelScale   — tamanho do pixel no terreno (metros)
 *   33922 ModelTiepoint     — amarra um pixel a uma coordenada do mundo
 *   34264 ModelTransformation — alternativa (matriz completa), usada quando o
 *                               raster é rotacionado
 *   34735 GeoKeyDirectory   — chaves do sistema de coordenadas (EPSG)
 */

const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };

const TAG = {
  WIDTH: 256,
  HEIGHT: 257,
  PIXEL_SCALE: 33550,
  TIEPOINT: 33922,
  TRANSFORM: 34264,
  GEO_KEYS: 34735,
  GEO_ASCII: 34737,
};

/** O buffer é um TIFF? (assinatura II*\0 little-endian ou MM\0* big-endian) */
function isTiff(buffer) {
  if (!buffer || buffer.length < 4) return false;
  const le = buffer[0] === 0x49 && buffer[1] === 0x49;
  const be = buffer[0] === 0x4d && buffer[1] === 0x4d;
  if (!le && !be) return false;
  const magic = le ? buffer.readUInt16LE(2) : buffer.readUInt16BE(2);
  return magic === 42 || magic === 43; // 42 = TIFF, 43 = BigTIFF
}

/** Lê as tags do primeiro IFD. Retorna { [tag]: valor } ou null. */
function readTags(buffer) {
  if (!isTiff(buffer)) return null;
  const le = buffer[0] === 0x49;
  const u16 = (o) => (le ? buffer.readUInt16LE(o) : buffer.readUInt16BE(o));
  const u32 = (o) => (le ? buffer.readUInt32LE(o) : buffer.readUInt32BE(o));
  const u64 = (o) => Number(le ? buffer.readBigUInt64LE(o) : buffer.readBigUInt64BE(o));
  const f64 = (o) => (le ? buffer.readDoubleLE(o) : buffer.readDoubleBE(o));

  const big = u16(2) === 43;
  const ifdOffset = big ? u64(8) : u32(4);
  if (ifdOffset <= 0 || ifdOffset >= buffer.length) return null;

  const count = big ? u64(ifdOffset) : u16(ifdOffset);
  const entrySize = big ? 20 : 12;
  const base = ifdOffset + (big ? 8 : 2);

  const tags = {};
  for (let i = 0; i < count; i += 1) {
    const e = base + i * entrySize;
    if (e + entrySize > buffer.length) break;
    const tag = u16(e);
    const type = u16(e + 2);
    const n = big ? u64(e + 4) : u32(e + 4);
    const valueField = e + (big ? 12 : 8);
    const size = (TYPE_SIZE[type] || 1) * n;
    const inline = size <= (big ? 8 : 4);
    const at = inline ? valueField : (big ? u64(valueField) : u32(valueField));
    if (!inline && (at < 0 || at + size > buffer.length)) continue;

    if (type === 12) { // double
      const arr = [];
      for (let k = 0; k < n; k += 1) arr.push(f64(at + k * 8));
      tags[tag] = arr;
    } else if (type === 3) { // short
      const arr = [];
      for (let k = 0; k < n; k += 1) arr.push(u16(at + k * 2));
      tags[tag] = arr;
    } else if (type === 4) { // long
      const arr = [];
      for (let k = 0; k < n; k += 1) arr.push(u32(at + k * 4));
      tags[tag] = arr;
    } else if (type === 2) { // ascii
      tags[tag] = buffer.toString('latin1', at, at + size).replace(/\0+$/, '');
    }
  }
  return tags;
}

/**
 * EPSG do raster a partir do GeoKeyDirectory.
 * Chave 3072 = ProjectedCSTypeGeoKey; 2048 = GeographicTypeGeoKey.
 */
function readEpsg(tags) {
  const keys = tags[TAG.GEO_KEYS];
  if (!Array.isArray(keys) || keys.length < 4) return null;
  const total = keys[3];
  let projected = null;
  let geographic = null;
  for (let i = 0; i < total; i += 1) {
    const o = 4 + i * 4;
    if (o + 3 >= keys.length) break;
    const id = keys[o];
    const location = keys[o + 1];
    const value = keys[o + 3];
    // location 0 => o valor está aqui mesmo (não em outra tag)
    if (location !== 0) continue;
    if (id === 3072) projected = value;      // ProjectedCSTypeGeoKey
    else if (id === 2048) geographic = value; // GeographicTypeGeoKey (datum)
  }
  // A PROJEÇÃO manda: o datum (ex.: 4674 = SIRGAS 2000) aparece mesmo em
  // arquivos cujas coordenadas estão em UTM, e usá-lo faria a ortofoto ser
  // tratada como graus — parando no meio do oceano.
  return projected || geographic || null;
}

/**
 * Zona UTM a partir do nome da projeção (34737 GeoAsciiParams).
 * Necessário porque há arquivos que descrevem a projeção só por extenso,
 * sem o código EPSG — caso dos ortomosaicos que recebemos.
 */
function utmFromAscii(tags) {
  const txt = tags[TAG.GEO_ASCII];
  if (typeof txt !== 'string') return null;
  const m = /UTM\s*zone\s*(\d{1,2})\s*([NS])/i.exec(txt);
  if (!m) return null;
  const zone = Number(m[1]);
  if (!(zone >= 1 && zone <= 60)) return null;
  return { zone, south: m[2].toUpperCase() === 'S' };
}

/** UTM (norte/leste, metros) → WGS84 (lat/lng em graus). Fórmula inversa padrão. */
function utmToLatLng(easting, northing, zone, south) {
  const a = 6378137.0;
  const f = 1 / 298.257223563;
  const e2 = f * (2 - f);
  const e = Math.sqrt(e2);
  const k0 = 0.9996;

  const x = easting - 500000.0;
  const y = northing - (south ? 10000000.0 : 0);

  const M = y / k0;
  const mu = M / (a * (1 - e2 / 4 - (3 * e2 ** 2) / 64 - (5 * e2 ** 3) / 256));
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));

  const phi1 = mu
    + ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu)
    + ((21 * e1 ** 2) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu)
    + ((151 * e1 ** 3) / 96) * Math.sin(6 * mu)
    + ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);

  const ep2 = e2 / (1 - e2);
  const C1 = ep2 * Math.cos(phi1) ** 2;
  const T1 = Math.tan(phi1) ** 2;
  const N1 = a / Math.sqrt(1 - e2 * Math.sin(phi1) ** 2);
  const R1 = (a * (1 - e2)) / (1 - e2 * Math.sin(phi1) ** 2) ** 1.5;
  const D = x / (N1 * k0);

  const lat = phi1
    - ((N1 * Math.tan(phi1)) / R1)
    * (D ** 2 / 2
      - ((5 + 3 * T1 + 10 * C1 - 4 * C1 ** 2 - 9 * ep2) * D ** 4) / 24
      + ((61 + 90 * T1 + 298 * C1 + 45 * T1 ** 2 - 252 * ep2 - 3 * C1 ** 2) * D ** 6) / 720);

  const lon = (D
    - ((1 + 2 * T1 + C1) * D ** 3) / 6
    + ((5 - 2 * C1 + 28 * T1 - 3 * C1 ** 2 + 8 * ep2 + 24 * T1 ** 2) * D ** 5) / 120)
    / Math.cos(phi1);

  const lon0 = ((zone - 1) * 6 - 180 + 3) * (Math.PI / 180);
  return [lat * (180 / Math.PI), (lon0 + lon) * (180 / Math.PI)];
}

/**
 * Zona/hemisfério UTM a partir do EPSG. Cobre as famílias usadas no Brasil:
 *   SIRGAS 2000 / UTM sul  -> 31978..31985  (zonas 18S..25S)
 *   SAD69 / UTM sul        -> 29188..29195
 *   WGS84 / UTM sul        -> 32701..32760
 *   WGS84 / UTM norte      -> 32601..32660
 * SIRGAS 2000 e WGS84 diferem por menos de 1 m — irrelevante para exibir a
 * ortofoto, então tratamos igual em vez de embutir uma transformação de datum.
 */
function utmFromEpsg(epsg) {
  if (!epsg) return null;
  if (epsg >= 31978 && epsg <= 31985) return { zone: epsg - 31960, south: true };
  if (epsg >= 29188 && epsg <= 29195) return { zone: epsg - 29170, south: true };
  if (epsg >= 32701 && epsg <= 32760) return { zone: epsg - 32700, south: true };
  if (epsg >= 32601 && epsg <= 32660) return { zone: epsg - 32600, south: false };
  return null;
}

/**
 * Georreferência da ortofoto.
 *
 * @returns {null | {
 *   widthPx, heightPx, resolutionCmPx, epsg,
 *   corners: { tl, tr, br, bl },   // [lat, lng]
 *   groundWidthM, groundHeightM
 * }}
 * Devolve null quando o arquivo não é TIFF ou não tem georreferência — nesse
 * caso o fluxo manual de posicionamento continua valendo.
 */
function readGeoreference(buffer) {
  const tags = readTags(buffer);
  if (!tags) return null;

  const widthPx = tags[TAG.WIDTH] && tags[TAG.WIDTH][0];
  const heightPx = tags[TAG.HEIGHT] && tags[TAG.HEIGHT][0];
  if (!widthPx || !heightPx) return null;

  // Origem e escala: preferimos Tiepoint+PixelScale (caso comum); a matriz
  // completa cobre rasters rotacionados.
  let originX; let originY; let scaleX; let scaleY;
  const tie = tags[TAG.TIEPOINT];
  const scale = tags[TAG.PIXEL_SCALE];
  const mat = tags[TAG.TRANSFORM];

  if (Array.isArray(tie) && tie.length >= 6 && Array.isArray(scale) && scale.length >= 2) {
    // tie = [i, j, k, X, Y, Z] — o pixel (i,j) corresponde a (X,Y)
    originX = tie[3] - tie[0] * scale[0];
    originY = tie[4] + tie[1] * scale[1];
    scaleX = scale[0];
    scaleY = scale[1];
  } else if (Array.isArray(mat) && mat.length >= 16) {
    originX = mat[3];
    originY = mat[7];
    scaleX = mat[0];
    scaleY = -mat[5];
  } else {
    return null;
  }
  if (!Number.isFinite(originX) || !Number.isFinite(originY) || !scaleX || !scaleY) return null;

  const epsg = readEpsg(tags);
  const groundWidthM = widthPx * Math.abs(scaleX);
  const groundHeightM = heightPx * Math.abs(scaleY);

  // Cantos no sistema do arquivo (Y cresce para o norte, então descemos).
  const box = {
    tl: [originX, originY],
    tr: [originX + groundWidthM, originY],
    br: [originX + groundWidthM, originY - groundHeightM],
    bl: [originX, originY - groundHeightM],
  };

  let corners;
  const utm = utmFromEpsg(epsg) || utmFromAscii(tags);
  if (utm) {
    const conv = ([X, Y]) => utmToLatLng(X, Y, utm.zone, utm.south);
    corners = { tl: conv(box.tl), tr: conv(box.tr), br: conv(box.br), bl: conv(box.bl) };
  } else if (epsg === 4326 || (Math.abs(originX) <= 180 && Math.abs(originY) <= 90)) {
    // já em graus (lat/lng): X = longitude, Y = latitude
    const conv = ([X, Y]) => [Y, X];
    corners = { tl: conv(box.tl), tr: conv(box.tr), br: conv(box.br), bl: conv(box.bl) };
  } else {
    // projeção que não sabemos converter — melhor admitir do que chutar um
    // lugar errado no mundo.
    return null;
  }

  const ok = Object.values(corners).every(
    ([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng)
      && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
  );
  if (!ok) return null;

  return {
    widthPx,
    heightPx,
    resolutionCmPx: Math.abs(scaleX) * 100,
    epsg: epsg || null,
    corners,
    groundWidthM,
    groundHeightM,
  };
}

module.exports = { readGeoreference, isTiff, utmToLatLng, readTags, readEpsg };
