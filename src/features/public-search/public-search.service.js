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
  Concession,
  Person,
} = require('../../models');

// A página pública não tem sessão e mantém a foto na tela enquanto o cidadão
// navega — TTL longo para a URL assinada sobreviver à visita.
const PHOTO_TTL_SECONDS = Number(process.env.PUBLIC_PHOTO_URL_TTL_SECONDS || 7 * 24 * 3600);
const MIN_TERM = 2; // comprimento mínimo de um termo textual livre
const MAX_GRAVE_IDS = 500; // teto de covas candidatas por filtro (base pública é pequena)

/* ============================ helpers ============================ */

const str = (v) => String(v ?? '').trim();
const digitsOf = (v) => String(v ?? '').replace(/\D/g, '');
const like = (v) => ({ [Op.iLike]: `%${str(v)}%` });

// CPF cadastrado pode estar com ou sem máscara → casa ambas as formas.
function cpfVariants(digits) {
  if (digits.length !== 11) return [digits];
  return [digits, `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`];
}

// Assina fotos locais (/files/...) para leitura pública sem sessão; URLs
// externas/vazias passam intactas (o provider trata).
const signPhoto = (url) => (url ? storage.signedUrl(url, { ttlSeconds: PHOTO_TTL_SECONDS }) : null);

// Concessão vigente (proprietário/responsável atual): prioriza 'ativa', senão a
// mais recente por data de início. Se a cova não tem concessão própria (ex.:
// gaveta), herda a do jazigo pai.
function currentHolder(grave) {
  const list = (grave?.concessions?.length ? grave.concessions : grave?.parentGrave?.concessions) || [];
  if (!list.length) return null;
  const sorted = [...list].sort((a, b) => {
    const aActive = a.status === 'ativa' ? 1 : 0;
    const bActive = b.status === 'ativa' ? 1 : 0;
    if (aActive !== bActive) return bActive - aActive;
    return String(b.startDate || '').localeCompare(String(a.startDate || ''));
  });
  const holder = sorted.find((c) => c.person) || null;
  if (!holder || !holder.person) return null;
  return {
    name: holder.person.fullName || null,
    concessionType: holder.concessionType || null,
    concessionStatus: holder.status || null,
  };
}

/* ============================ serialização PÚBLICA ============================ */

// Nunca expõe: CPF completo, RG, causa da morte, certidão, contato. O nome do
// concessionário é dado de registro público (constava na lápide/concessão).
function toPublic(deceased) {
  const grave = deceased.currentGrave;
  const status = grave?.status;
  const holder = grave ? currentHolder(grave) : null;
  return {
    id: deceased.id,
    fullName: deceased.fullName,
    birthDate: deceased.birthDate,
    deathDate: deceased.deathDate,
    photoUrl: signPhoto(deceased.photoUrl),
    holder: holder ? { name: holder.name } : null,
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

// Ids de covas cujo PROPRIETÁRIO/RESPONSÁVEL (via concessão) casa por nome ou CPF.
// Concession.person é belongsTo → `where` no include resolve limpo (sem $nested$).
async function ownerGraveIds(tenantId, crit) {
  const personOr = [];
  const t = crit.anyText ? str(crit.anyText) : null;
  if (crit.ownerName || t) personOr.push({ fullName: like(crit.ownerName || t) });
  if (crit.cpfDigits) personOr.push({ cpf: { [Op.in]: cpfVariants(crit.cpfDigits) } });
  if (!personOr.length) return [];

  const rows = await Concession.findAll({
    where: { tenantId },
    attributes: ['graveId'],
    include: [
      { model: Person, as: 'person', attributes: [], required: true, where: { [Op.or]: personOr } },
    ],
    subQuery: false,
    limit: MAX_GRAVE_IDS,
    raw: true,
  });
  const ids = rows.map((r) => r.graveId);
  // A concessão fica no jazigo (pai), mas o sepultado ocupa a gaveta (filha):
  // inclui as covas-filhas para o dono também localizar quem está nas gavetas.
  return withChildGraves(tenantId, ids);
}

// Expande um conjunto de covas com suas covas-filhas diretas (gavetas do jazigo).
async function withChildGraves(tenantId, ids) {
  if (!ids.length) return ids;
  const children = await Grave.findAll({
    where: { tenantId, parentGraveId: { [Op.in]: ids } },
    attributes: ['id'],
    raw: true,
  });
  return [...new Set([...ids, ...children.map((c) => c.id)])];
}

// União dos ids de cova que casam por cadastro OU por proprietário/responsável.
// Devolve [] quando nada casa (nunca null) — `IN ([])` filtra corretamente.
async function graveIds(tenantId, crit) {
  const [structural, owner] = await Promise.all([
    structuralGraveIds(tenantId, crit),
    ownerGraveIds(tenantId, crit),
  ]);
  return [...new Set([...structural, ...owner])];
}

/* ============================ busca principal ============================ */

/**
 * Busca PÚBLICA do portal (PDF §3.6). Aceita:
 *   - `q`        busca ampla: casa em nome do sepultado, proprietário/responsável
 *                (via concessão), CPF, código/número do jazigo, quadra, lote e situação.
 *   - filtros específicos (combinados em E): `nome`, `cpf`, `quadra`, `lote`,
 *     `jazigo`, `situacao`.
 *   - compat legado: `name` (→ nome), `graveCode` (→ jazigo).
 * Cada filtro textual casa tanto no dado do sepultado quanto no da cova/concessão
 * quando fizer sentido. Isolamento por tenant preservado em toda query.
 */
async function search(tenantId, query) {
  const q = str(query.q);
  const nome = str(query.nome || query.name);
  const cpfRaw = str(query.cpf);
  const quadra = str(query.quadra);
  const lote = str(query.lote);
  const jazigo = str(query.jazigo || query.graveCode);
  const situacao = str(query.situacao);

  const hasSpecific = nome || cpfRaw || quadra || lote || jazigo || situacao;
  if (!q && !hasSpecific) {
    throw AppError.badRequest(
      'Informe ao menos um critério: q (busca ampla) ou um filtro (nome, cpf, quadra, lote, jazigo, situacao).',
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

  // busca ampla: nome do sepultado OU (CPF completo do sepultado) OU cova candidata
  if (q) {
    const qDigits = digitsOf(q);
    const ids = await graveIds(tenantId, { anyText: q, cpfDigits: qDigits.length === 11 ? qDigits : null });
    const or = [{ fullName: like(q) }];
    if (qDigits.length === 11) or.push({ cpf: { [Op.in]: cpfVariants(qDigits) } });
    or.push({ currentGraveId: { [Op.in]: ids } });
    and.push({ [Op.or]: or });
  }

  // nome: casa no sepultado OU no proprietário/responsável
  if (nome) {
    const ids = await graveIds(tenantId, { ownerName: nome });
    and.push({ [Op.or]: [{ fullName: like(nome) }, { currentGraveId: { [Op.in]: ids } }] });
  }

  // cpf: casa no sepultado OU no proprietário/responsável
  if (cpfRaw) {
    const d = digitsOf(cpfRaw);
    const ids = await graveIds(tenantId, { cpfDigits: d });
    and.push({ [Op.or]: [{ cpf: { [Op.in]: cpfVariants(d) } }, { currentGraveId: { [Op.in]: ids } }] });
  }

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
      {
        model: Concession,
        as: 'concessions',
        required: false,
        attributes: ['id', 'status', 'startDate', 'concessionType'],
        include: [{ model: Person, as: 'person', attributes: ['id', 'fullName'] }],
      },
      {
        // fallback do proprietário quando o sepultado está numa gaveta
        model: Grave,
        as: 'parentGrave',
        required: false,
        attributes: ['id'],
        include: [
          {
            model: Concession,
            as: 'concessions',
            required: false,
            attributes: ['id', 'status', 'startDate', 'concessionType'],
            include: [{ model: Person, as: 'person', attributes: ['id', 'fullName'] }],
          },
        ],
      },
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
