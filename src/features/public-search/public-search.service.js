'use strict';

const { Op } = require('sequelize');
const AppError = require('../../utils/app-error');
const storage = require('../../providers/storage');
const { getPagination, buildPageMeta } = require('../../utils/pagination');
const {
  Deceased,
  Grave,
  Lot,
  Street,
  Block,
  Cemetery,
  GraveStatus,
} = require('../../models');

// A página pública não tem sessão e mantém a foto na tela enquanto o cidadão
// navega — TTL longo para a URL assinada sobreviver à visita.
const PHOTO_TTL_SECONDS = Number(process.env.PUBLIC_PHOTO_URL_TTL_SECONDS || 7 * 24 * 3600);
const MIN_TERM = 2; // comprimento mínimo de um termo textual livre
const MAX_GRAVE_IDS = 500; // teto de covas candidatas por filtro (base pública é pequena)

/* ============================ helpers ============================ */

const str = (v) => String(v ?? '').trim();
const like = (v) => ({ [Op.iLike]: `%${str(v)}%` });

// Assina fotos locais (/files/...) para leitura pública sem sessão; URLs
// externas/vazias passam intactas (o provider trata).
const signPhoto = (url) => (url ? storage.signedUrl(url, { ttlSeconds: PHOTO_TTL_SECONDS }) : null);

/* ============================ serialização PÚBLICA ============================ */

// LGPD: a consulta pública é anônima e só pode devolver o NOME DO FALECIDO, os
// DADOS DA SEPULTURA (cemitério, quadra/rua/lote, código, situação, localização
// e foto) e a DATA DE FALECIMENTO.
// NUNCA expõe dado pessoal de terceiros vivos — proprietário/responsável da
// concessão, contatos — nem documentos (CPF, RG, certidão), causa da morte,
// filiação/declarante ou valores financeiros. O responsável só aparece nas
// telas AUTENTICADAS (Portal da Família e painel da prefeitura).
function toPublic(deceased) {
  const grave = deceased.currentGrave;
  const status = grave?.status;
  return {
    id: deceased.id,
    fullName: deceased.fullName,
    birthDate: deceased.birthDate,
    deathDate: deceased.deathDate,
    photoUrl: signPhoto(deceased.photoUrl),
    burial: grave
      ? {
          cemetery: grave.cemetery ? { id: grave.cemetery.id, name: grave.cemetery.name } : null,
          block: grave.lot?.street?.block?.name || null,
          street: grave.lot?.street?.name || null,
          lot: grave.lot?.code || null,
          graveId: grave.id,
          graveCode: grave.code,
          unitType: grave.unitType,
          status: status
            ? { name: status.name, slug: status.slug, color: status.color || null }
            : null,
          latitude: grave.latitude,
          longitude: grave.longitude,
          geoPolygon: grave.geoPolygon,
          photoUrl: signPhoto(grave.photoUrl),
        }
      : null,
  };
}

/* ============================ busca por critérios de COVA ============================ */

// Ids de covas cujo CADASTRO (código/quadra/lote/situação) casa com os critérios.
// Usa joins belongsTo (lot→street→block, status). Devolve [] quando nada casa.
async function structuralGraveIds(tenantId, crit) {
  const or = [];
  const t = crit.anyText ? str(crit.anyText) : null;

  // nome "Quadra X" / "Lote N" contém palavras genéricas → casa o CÓDIGO por
  // substring (discrimina: A, B, A-R1-L1) e o NOME por igualdade case-insensitive
  // (para quem digita o rótulo inteiro). Evita "A" casar "Quadra B".
  const exact = (v) => ({ [Op.iLike]: str(v) });

  if (crit.code || t) or.push({ code: like(crit.code || t) });
  if (crit.quadra || t) {
    const v = crit.quadra || t;
    or.push({ '$lot.street.block.code$': like(v) }, { '$lot.street.block.name$': exact(v) });
  }
  if (crit.lote || t) {
    const v = crit.lote || t;
    or.push({ '$lot.code$': like(v) }, { '$lot.name$': exact(v) });
  }
  if (crit.situacao || t) {
    const v = crit.situacao || t;
    or.push({ '$status.name$': like(v) }, { '$status.slug$': like(v) });
  }
  if (!or.length) return [];

  const rows = await Grave.findAll({
    where: { tenantId, [Op.or]: or },
    attributes: ['id'],
    include: [
      {
        model: Lot,
        as: 'lot',
        attributes: [],
        include: [
          {
            model: Street,
            as: 'street',
            attributes: [],
            include: [{ model: Block, as: 'block', attributes: [] }],
          },
        ],
      },
      { model: GraveStatus, as: 'status', attributes: [] },
    ],
    subQuery: false,
    limit: MAX_GRAVE_IDS,
    raw: true,
  });
  return rows.map((r) => r.id);
}

// LGPD: a busca pública NÃO pesquisa mais por nome/CPF/RG de proprietário ou
// responsável da concessão. Permitir esse critério vazava por confirmação —
// ao retornar um jazigo, provava que aquele nome/CPF está ligado à sepultura.
// Restam apenas critérios de CADASTRO da cova (código, quadra, rua/lote, situação).
// Devolve [] quando nada casa (nunca null) — `IN ([])` filtra corretamente.
async function graveIds(tenantId, crit) {
  return structuralGraveIds(tenantId, crit);
}

/* ============================ busca principal ============================ */

/**
 * Busca PÚBLICA do portal (PDF §3.6), anônima e restrita pela LGPD. Aceita:
 *   - `q`        busca ampla: casa em nome do SEPULTADO, código/número do jazigo,
 *                quadra, lote e situação da cova.
 *   - filtros específicos (combinados em E): `nome`, `quadra`, `lote`,
 *     `jazigo`, `situacao`, `documento` (apenas nº da certidão de óbito).
 *   - compat legado: `name` (→ nome), `graveCode` (→ jazigo).
 * NÃO aceita mais pesquisa por CPF/RG nem por nome de proprietário/responsável:
 * qualquer um deles confirmaria o vínculo de uma pessoa com um jazigo.
 * Isolamento por tenant preservado em toda query.
 */
async function search(tenantId, query) {
  const q = str(query.q);
  const nome = str(query.nome || query.name);
  const quadra = str(query.quadra);
  const lote = str(query.lote);
  const jazigo = str(query.jazigo || query.graveCode);
  const situacao = str(query.situacao);
  const documento = str(query.documento);

  const hasSpecific = nome || quadra || lote || jazigo || situacao || documento;
  if (!q && !hasSpecific) {
    throw AppError.badRequest(
      'Informe ao menos um critério: q (busca ampla) ou um filtro (nome, documento, quadra, lote, jazigo, situacao).',
      'MISSING_CRITERIA'
    );
  }
  if (q && q.length < MIN_TERM) {
    throw AppError.badRequest(`A busca deve ter ao menos ${MIN_TERM} caracteres.`, 'SEARCH_TOO_SHORT');
  }
  if (nome && nome.length < MIN_TERM) {
    throw AppError.badRequest(`O nome deve ter ao menos ${MIN_TERM} caracteres.`, 'NAME_TOO_SHORT');
  }

  const and = [];

  // busca ampla: nome do sepultado OU cova candidata (código/quadra/lote/situação)
  if (q) {
    const ids = await graveIds(tenantId, { anyText: q });
    and.push({ [Op.or]: [{ fullName: like(q) }, { currentGraveId: { [Op.in]: ids } }] });
  }

  // nome: apenas o nome do SEPULTADO (nunca o do proprietário/responsável)
  if (nome) and.push({ fullName: like(nome) });

  // documento: somente o nº da certidão de óbito (documento do registro do
  // sepultamento). CPF e RG — do sepultado ou do responsável — não são critério
  // público: serviriam para confirmar o vínculo de um CPF com um jazigo.
  if (documento) and.push({ deathCertificateNumber: like(documento) });

  if (quadra) and.push({ currentGraveId: { [Op.in]: await graveIds(tenantId, { quadra }) } });
  if (lote) and.push({ currentGraveId: { [Op.in]: await graveIds(tenantId, { lote }) } });
  if (jazigo) and.push({ currentGraveId: { [Op.in]: await graveIds(tenantId, { code: jazigo }) } });
  if (situacao) and.push({ currentGraveId: { [Op.in]: await graveIds(tenantId, { situacao }) } });

  const where = { tenantId, [Op.and]: and };

  const graveInclude = {
    model: Grave,
    as: 'currentGrave',
    required: false,
    attributes: ['id', 'code', 'unitType', 'latitude', 'longitude', 'geoPolygon', 'photoUrl'],
    include: [
      { model: Cemetery, as: 'cemetery', attributes: ['id', 'name'] },
      { model: GraveStatus, as: 'status', attributes: ['id', 'name', 'slug', 'color'] },
      {
        model: Lot,
        as: 'lot',
        attributes: ['id', 'code', 'name'],
        include: [
          {
            model: Street,
            as: 'street',
            attributes: ['id', 'name'],
            include: [{ model: Block, as: 'block', attributes: ['id', 'name', 'code'] }],
          },
        ],
      },
      // LGPD: nenhum include de Concession/Person aqui — o dado do
      // proprietário/responsável não pode sequer sair pela rede na rota pública.
    ],
  };

  const { page, perPage, limit, offset } = getPagination(query, { defaultPerPage: 10, maxPerPage: 25 });
  const { rows, count } = await Deceased.findAndCountAll({
    where,
    include: [graveInclude],
    limit,
    offset,
    order: [['fullName', 'ASC']],
    distinct: true,
  });

  return { rows: rows.map(toPublic), meta: buildPageMeta(count, page, perPage) };
}

module.exports = { search };
