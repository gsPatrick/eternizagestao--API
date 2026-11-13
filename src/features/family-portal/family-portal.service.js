'use strict';

const crypto = require('crypto');
const { Op } = require('sequelize');
const AppError = require('../../utils/app-error');
const { getPagination, buildPageMeta } = require('../../utils/pagination');
const { hashPassword, comparePassword, randomToken } = require('../../utils/password');
const { signAccessToken } = require('../../utils/jwt');
const { portalActivationUrl } = require('../../utils/tenant-url');
const {
  FamilyPortalAccount, Person, Billing, Payment, Concession, Grave,
  GraveStatus, Lot, Street, Block, Deceased, Burial, GraveEvent, Cemetery, Tenant, Document,
} = require('../../models');

// Campos da Person que o próprio titular pode ver/editar pelo portal.
const PORTAL_PERSON_FIELDS = [
  'id', 'fullName', 'cpf', 'birthDate', 'email', 'phonePrimary', 'phoneSecondary',
  'whatsapp', 'addressStreet', 'addressNumber', 'addressComplement', 'addressDistrict',
  'addressCity', 'addressState', 'addressZipcode', 'photoUrl',
];

const PORTAL_EDITABLE_FIELDS = [
  'email', 'phonePrimary', 'phoneSecondary', 'whatsapp', 'addressStreet',
  'addressNumber', 'addressComplement', 'addressDistrict', 'addressCity',
  'addressState', 'addressZipcode',
];

const graveIncludes = [
  { model: GraveStatus, as: 'status' },
  {
    model: Lot, as: 'lot',
    include: [{ model: Street, as: 'street', include: [{ model: Block, as: 'block' }] }],
  },
];

function normalizeCpf(cpf) {
  return String(cpf || '').replace(/\D/g, '');
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function serializePerson(person) {
  const out = {};
  for (const field of PORTAL_PERSON_FIELDS) out[field] = person[field];
  return out;
}

// Resposta genérica e IDÊNTICA para todos os desfechos do auto-cadastro
// (CPF inexistente, e-mail divergente, sem e-mail na base, conta já existente
// ou criação bem-sucedida). Evita enumeração de CPF/e-mail e nunca expõe o token.
const GENERIC_REGISTER_MESSAGE =
  'Se os dados conferirem, enviaremos um link de ativação por e-mail/WhatsApp.';
const genericRegisterResult = () => ({ ok: true, message: GENERIC_REGISTER_MESSAGE });

// Hash determinístico do token de ativação (uso único, guardado no banco).
// SHA-256 permite busca por igualdade no activate; o token cru nunca é persistido.
function hashActivationToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

// Contrato externo (feature `notifications`) — require defensivo para não
// derrubar o módulo caso a dependência ainda não esteja disponível.
let notificationsService = null;
try {
  notificationsService = require('../notifications/notifications.service');
} catch (_err) {
  notificationsService = null;
}

// Hook de envio do link de ativação (e-mail). É o ÚNICO ponto que conhece o
// token cru — jamais retornar/logar o token (ele só viaja dentro do cta_url).
// Enfileira via notifications.notify (não bloqueia o request); melhor-esforço,
// nunca derruba o cadastro. O LINK usa o subdomínio da cidade (`tenant`); sem
// tenant cai no PORTAL_URL global (fallback).
async function dispatchActivationLink({ tenantId, tenant, account, person, activationToken } = {}) {
  if (!notificationsService || !account) return null;
  try {
    await notificationsService.notify({
      tenantId,
      personId: person ? person.id : account.personId,
      contact: account.email,
      channel: 'email',
      notificationType: 'portal_acesso',
      subject: 'Ative seu acesso ao Portal da Família',
      template: 'activation',
      vars: { nome: person ? person.fullName : '', cta_url: portalActivationUrl(tenant, activationToken) },
      referenceType: 'family_portal_account',
      referenceId: account.id,
    });
  } catch (err) {
    console.error('[family-portal] envio do link de ativação falhou:', err.message);
  }
  return null;
}

/**
 * Auto-cadastro: familiar informa CPF + e-mail. Só cria conta (pendente de
 * ativação) quando o CPF existe, o cadastro TEM e-mail e ele confere com o
 * informado. Em qualquer outro caso responde de forma idêntica, sem revelar o
 * motivo (anti-enumeração). O token é gerado, apenas seu HASH é persistido, e
 * nunca é retornado — o envio fica a cargo do provider de notificação.
 */
async function register(tenantId, { email, cpf }) {
  const normalizedCpf = normalizeCpf(cpf);
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedCpf) throw AppError.badRequest('CPF inválido.', 'INVALID_CPF');

  // CPF pode estar salvo com ou sem máscara — compara só os dígitos em JS.
  const candidates = await Person.findAll({
    where: { tenantId, cpf: { [Op.ne]: null } },
    attributes: ['id', 'cpf', 'email'],
  });
  const person = candidates.find((p) => normalizeCpf(p.cpf) === normalizedCpf);

  // CPF inexistente → resposta genérica (não confirma ausência).
  if (!person) return genericRegisterResult();

  // Sem e-mail cadastrado: auto-cadastro NEGADO — exige fluxo assistido pela
  // administração. Nunca aceitar "qualquer e-mail" quando não há e-mail na base.
  if (!person.email || !normalizeEmail(person.email)) return genericRegisterResult();

  // E-mail informado não confere com o cadastro → resposta genérica.
  if (normalizeEmail(person.email) !== normalizedEmail) return genericRegisterResult();

  // Conta já existente → resposta genérica (não confirma existência).
  const existing = await FamilyPortalAccount.findOne({
    where: { tenantId, personId: person.id },
  });
  if (existing) return genericRegisterResult();

  // Gera token de uso único e persiste APENAS o hash; o token cru fica em memória.
  const activationToken = randomToken();
  const account = await FamilyPortalAccount.create({
    tenantId,
    personId: person.id,
    email: normalizedEmail,
    status: 'pendente_ativacao',
    activationToken: hashActivationToken(activationToken),
  });

  // Tenant p/ derivar o LINK branded (subdomínio da cidade); null → fallback global.
  const tenant = await Tenant.findByPk(tenantId, { attributes: ['id', 'subdomain'] }).catch(() => null);

  // Envio do link fica a cargo do provider de notificação (melhor-esforço).
  await dispatchActivationLink({ tenantId, tenant, account, person, activationToken }).catch(() => {});

  return genericRegisterResult();
}

async function activate(tenantId, { email, activationToken, password }) {
  if (!password || String(password).length < 8) {
    throw AppError.badRequest('Senha deve ter no mínimo 8 caracteres.', 'WEAK_PASSWORD');
  }

  const account = await FamilyPortalAccount.scope('withSecrets').findOne({
    where: {
      tenantId,
      email: normalizeEmail(email),
      // token guardado como hash — compara o hash do token apresentado.
      activationToken: hashActivationToken(activationToken),
      status: 'pendente_ativacao',
    },
  });
  if (!account) {
    throw AppError.unauthorized('Dados de ativação inválidos.', 'INVALID_ACTIVATION');
  }

  await account.update({
    passwordHash: await hashPassword(password),
    status: 'ativo',
    activationToken: null,
  });
  return { accountId: account.id, status: account.status };
}

async function login(tenantId, { email, password }) {
  const account = await FamilyPortalAccount.scope('withSecrets').findOne({
    where: { tenantId, email: normalizeEmail(email), status: 'ativo' },
    include: [{ model: Person, as: 'person', attributes: ['id', 'fullName'] }],
  });
  if (!account || !(await comparePassword(password, account.passwordHash))) {
    throw AppError.unauthorized('E-mail ou senha inválidos.', 'INVALID_CREDENTIALS');
  }

  const accessToken = signAccessToken(
    { sub: account.id, tenantId, personId: account.personId },
    'portal'
  );
  await account.update({ lastLoginAt: new Date() });

  return {
    accessToken,
    person: { id: account.person.id, fullName: account.person.fullName },
  };
}

async function getMe(tenantId, personId, account) {
  const person = await Person.findOne({ where: { id: personId, tenantId } });
  if (!person) throw AppError.notFound('Pessoa não encontrada.');

  // Cemitério de referência do titular: o da sua concessão mais recente.
  // Somente leitura — usado como rótulo no cabeçalho do portal.
  let cemetery = null;
  const concession = await Concession.findOne({
    where: concessionLinkWhere(tenantId, personId),
    order: [['startDate', 'DESC']],
    include: [{
      model: Grave, as: 'grave', attributes: ['id', 'cemeteryId'],
      include: [{ model: Cemetery, as: 'cemetery', attributes: ['id', 'name'] }],
    }],
  });
  if (concession && concession.grave && concession.grave.cemetery) {
    cemetery = concession.grave.cemetery.name;
  }

  return { ...serializePerson(person), account: { email: account.email }, cemetery };
}

async function updateMe(tenantId, personId, data) {
  const person = await Person.findOne({ where: { id: personId, tenantId } });
  if (!person) throw AppError.notFound('Pessoa não encontrada.');
  await person.update(data);
  return serializePerson(person);
}

/**
 * Troca de senha do titular no portal. Exige a senha atual (confere via bcrypt)
 * e grava o novo hash. A conta chega do portalAuth SEM o hash (defaultScope o
 * oculta): recarrega com o escopo `withSecrets` para validar a senha atual.
 * Senha atual incorreta → 400 (mensagem amigável), sem revelar detalhes.
 */
async function changePassword(tenantId, account, { currentPassword, newPassword }) {
  if (!currentPassword) {
    throw AppError.badRequest('Informe a senha atual.', 'MISSING_CURRENT_PASSWORD');
  }
  if (!newPassword || String(newPassword).length < 8) {
    throw AppError.badRequest('A nova senha deve ter no mínimo 8 caracteres.', 'WEAK_PASSWORD');
  }

  const secured = await FamilyPortalAccount.scope('withSecrets').findOne({
    where: { id: account.id, tenantId, status: 'ativo' },
  });
  if (!secured || !(await comparePassword(currentPassword, secured.passwordHash))) {
    throw AppError.badRequest('Senha atual incorreta.', 'INVALID_CURRENT_PASSWORD');
  }

  await secured.update({ passwordHash: await hashPassword(newPassword) });
  return { ok: true };
}

// Débitos em aberto + totais (pendente x em atraso).
async function listDebts(tenantId, personId) {
  const billings = await Billing.findAll({
    where: {
      tenantId,
      payerPersonId: personId,
      status: { [Op.in]: ['pendente', 'em_atraso'] },
    },
    order: [['dueDate', 'ASC']],
  });

  let pendingTotal = 0;
  let overdueTotal = 0;
  for (const billing of billings) {
    const total = parseFloat(billing.totalAmount) || 0;
    if (billing.status === 'em_atraso') overdueTotal += total;
    else pendingTotal += total;
  }

  return {
    billings,
    summary: {
      pendingTotal: Number(pendingTotal.toFixed(2)),
      overdueTotal: Number(overdueTotal.toFixed(2)),
    },
  };
}

// Histórico financeiro do titular, paginado. Exclui cobranças canceladas/estornadas
// (ruído interno — a 2ª via cancela a origem e gera uma nova pendente). Inclui a
// sepultura (rótulo) e os pagamentos (data da baixa) para a tela renderizar direto.
async function listBillings(tenantId, personId, query) {
  const { page, perPage, limit, offset } = getPagination(query, { defaultPerPage: 30 });
  const { rows, count } = await Billing.findAndCountAll({
    where: {
      tenantId,
      payerPersonId: personId,
      status: { [Op.notIn]: ['cancelado', 'estornado'] },
    },
    include: [
      { model: Payment, as: 'payments' },
      { model: Grave, as: 'grave', attributes: ['id', 'code', 'unitType'] },
    ],
    order: [['dueDate', 'DESC']],
    limit,
    offset,
    distinct: true,
  });
  return { rows, meta: buildPageMeta(count, page, perPage) };
}

// 2ª via — só de cobrança do próprio titular; a emissão em si é do billings.service.
async function reissueBilling(tenantId, personId, billingId) {
  const billing = await Billing.findOne({
    where: { id: billingId, tenantId, payerPersonId: personId },
  });
  if (!billing) throw AppError.notFound('Cobrança não encontrada.');

  // require tardio: feature billings é implementada em paralelo (mesmo contrato).
  const billingsService = require('../billings/billings.service');
  return billingsService.reissue(tenantId, billingId);
}

/* ------------------------------------------------------------------------- */
/* Vínculo pessoa ↔ jazigos/sepultados                                       */
/* ------------------------------------------------------------------------- */
//
// O titular do portal enxerga um jazigo quando é o PROPRIETÁRIO da concessão
// (Concession.personId) OU o RESPONSÁVEL legal por ela
// (Concession.responsiblePersonId). Num jazigo-bloco a concessão fica no
// jazigo PAI, enquanto os sepultados ocupam as GAVETAS filhas
// (Grave.parentGraveId) — por isso toda busca por ocupantes/sepultamentos/
// documentos expande o conjunto para incluir as gavetas.

// WHERE de concessões vinculadas à pessoa (proprietário OU responsável).
// `extra` entra em AND (ex.: filtro de status).
function concessionLinkWhere(tenantId, personId, extra = {}) {
  return {
    tenantId,
    ...extra,
    [Op.or]: [{ personId }, { responsiblePersonId: personId }],
  };
}

// Gavetas filhas dos jazigos informados. Devolve os ids das gavetas, o mapa
// gaveta → jazigo pai (para agrupar no card do jazigo) e o código de cada gaveta.
async function expandDrawers(tenantId, graveIds) {
  const parentOf = new Map();
  const codeOf = new Map();
  if (!graveIds.length) return { drawerIds: [], parentOf, codeOf };
  const drawers = await Grave.findAll({
    where: { tenantId, parentGraveId: { [Op.in]: graveIds } },
    attributes: ['id', 'parentGraveId', 'code'],
  });
  const ownSet = new Set(graveIds);
  const drawerIds = [];
  for (const d of drawers) {
    // gaveta que já tem concessão própria do titular continua sendo um jazigo seu
    if (ownSet.has(d.id)) continue;
    drawerIds.push(d.id);
    parentOf.set(d.id, d.parentGraveId);
    codeOf.set(d.id, d.code);
  }
  return { drawerIds, parentOf, codeOf };
}

function groupBy(rows, keyFn) {
  const map = new Map();
  for (const row of rows) {
    const k = keyFn(row);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(row);
  }
  return map;
}

// Meus jazigos: concessões do titular (como proprietário, qualquer status; como
// responsável, exceto canceladas), já enriquecidas para a tela do portal —
// localização, situação financeira (em dia x pendência), sepultados (inclusive
// os das gavetas do jazigo) e linha do tempo. Somente leitura.
async function listGraves(tenantId, personId) {
  const rawConcessions = await Concession.findAll({
    where: {
      tenantId,
      [Op.or]: [
        { personId },
        { responsiblePersonId: personId, status: { [Op.ne]: 'cancelada' } },
      ],
    },
    order: [['startDate', 'DESC']],
    include: [{
      model: Grave, as: 'grave',
      include: [...graveIncludes, { model: Cemetery, as: 'cemetery', attributes: ['id', 'name'] }],
    }],
  });

  // Um card por jazigo: se houver mais de uma concessão no mesmo jazigo (ex.:
  // titular de uma e responsável de outra), prefere a ATIVA, senão a mais recente.
  const byGrave = new Map();
  for (const c of rawConcessions) {
    if (!c.graveId) continue;
    const current = byGrave.get(c.graveId);
    if (!current || (current.status !== 'ativa' && c.status === 'ativa')) byGrave.set(c.graveId, c);
  }
  const concessions = [...byGrave.values()];

  const graveIds = concessions.map((c) => c.graveId);
  if (!graveIds.length) return [];

  const { drawerIds, parentOf, codeOf } = await expandDrawers(tenantId, graveIds);
  const allGraveIds = [...graveIds, ...drawerIds];
  // gaveta → jazigo pai (o card); jazigo próprio → ele mesmo
  const portalGraveOf = (id) => parentOf.get(id) || id;

  const [openBillings, occupants, burials, events] = await Promise.all([
    // Situação financeira por jazigo: existe cobrança em aberto? → pendência.
    Billing.findAll({
      where: {
        tenantId, payerPersonId: personId, graveId: { [Op.in]: allGraveIds },
        status: { [Op.in]: ['pendente', 'em_atraso'] },
      },
      attributes: ['graveId'],
    }),
    // Ocupantes atuais de cada jazigo (e de suas gavetas).
    Deceased.findAll({
      where: { tenantId, currentGraveId: { [Op.in]: allGraveIds } },
      order: [['fullName', 'ASC']],
    }),
    // Histórico de sepultamentos (data + fallback de sepultados sem ocupação atual).
    Burial.findAll({
      where: { tenantId, graveId: { [Op.in]: allGraveIds } },
      include: [{ model: Deceased, as: 'deceased' }],
      order: [['burialDate', 'DESC']],
    }),
    // Linha do tempo do jazigo (e de suas gavetas).
    GraveEvent.findAll({
      where: { tenantId, graveId: { [Op.in]: allGraveIds } },
      order: [['occurredAt', 'DESC']],
    }),
  ]);

  const openByGrave = new Set(openBillings.map((b) => portalGraveOf(b.graveId)));
  const occByGrave = groupBy(occupants, (d) => portalGraveOf(d.currentGraveId));
  const burialsByGrave = groupBy(burials, (b) => portalGraveOf(b.graveId));
  const eventsByGrave = groupBy(events, (e) => portalGraveOf(e.graveId));

  return concessions.map((c) => {
    const g = c.grave;
    const gid = c.graveId;
    const graveBurials = burialsByGrave.get(gid) || [];
    const burialDateFor = (deceasedId) => {
      const b = graveBurials.find((x) => x.deceasedId === deceasedId);
      return b ? b.burialDate : null;
    };

    // Sepultados: ocupantes atuais; se não houver, deriva do histórico de sepultamentos.
    // `drawerCode` identifica a gaveta quando o sepultado está numa gaveta do jazigo.
    let deceased = (occByGrave.get(gid) || []).map((d) => ({
      id: d.id, fullName: d.fullName, birthDate: d.birthDate,
      deathDate: d.deathDate, burialDate: burialDateFor(d.id),
      drawerCode: codeOf.get(d.currentGraveId) || null,
    }));
    if (!deceased.length) {
      const seen = new Set();
      for (const b of graveBurials) {
        if (!b.deceased || seen.has(b.deceasedId)) continue;
        seen.add(b.deceasedId);
        deceased.push({
          id: b.deceased.id, fullName: b.deceased.fullName, birthDate: b.deceased.birthDate,
          deathDate: b.deceased.deathDate, burialDate: b.burialDate,
          drawerCode: codeOf.get(b.graveId) || null,
        });
      }
    }

    const timeline = (eventsByGrave.get(gid) || []).map((e) => ({
      type: e.eventType, date: e.occurredAt, text: e.title,
    }));

    const lot = g && g.lot ? g.lot : null;
    const street = lot && lot.street ? lot.street : null;
    const block = street && street.block ? street.block : null;

    return {
      id: gid,
      concessionId: c.id,
      // vínculo do titular com o jazigo: proprietário da concessão ou responsável legal
      relation: c.personId === personId ? 'proprietario' : 'responsavel',
      code: g ? g.code : null,
      unitType: g ? g.unitType : null,
      cemetery: g && g.cemetery ? g.cemetery.name : null,
      cemeteryId: g ? g.cemeteryId : null,
      concessionType: c.concessionType,
      contractNumber: c.contractNumber,
      startDate: c.startDate,
      concessionStatus: c.status,
      status: openByGrave.has(gid) ? 'pendente' : 'em_dia',
      // gavetas do jazigo (o front filtra documentos do jazigo por elas também)
      drawerIds: drawerIds.filter((id) => parentOf.get(id) === gid),
      location: {
        block: block ? block.name : null,
        street: street ? street.name : null,
        lot: lot ? lot.code : null,
      },
      // geometria REAL (lat/lng) para o mapa do portal (PublicCemeteryMap)
      geoPolygon: g ? g.geoPolygon : null,
      latitude: g ? g.latitude : null,
      longitude: g ? g.longitude : null,
      deceased,
      timeline,
    };
  });
}

// Meus sepultados: ocupantes atuais dos jazigos com concessão ATIVA do titular
// (como proprietário ou responsável, incluindo as gavetas desses jazigos), mais
// os sepultados de quem ele é o responsável direto (Deceased.responsiblePersonId),
// e o histórico de sepultamentos correspondente.
async function listDeceased(tenantId, personId) {
  const activeConcessions = await Concession.findAll({
    where: concessionLinkWhere(tenantId, personId, { status: 'ativa' }),
    attributes: ['graveId'],
  });
  const graveIds = [...new Set(activeConcessions.map((c) => c.graveId).filter(Boolean))];
  const { drawerIds } = await expandDrawers(tenantId, graveIds);
  const allGraveIds = [...graveIds, ...drawerIds];

  const deceasedOr = [{ responsiblePersonId: personId }];
  if (allGraveIds.length) deceasedOr.push({ currentGraveId: { [Op.in]: allGraveIds } });

  const deceased = await Deceased.findAll({
    where: { tenantId, [Op.or]: deceasedOr },
    order: [['fullName', 'ASC']],
  });
  if (!deceased.length && !allGraveIds.length) return { deceased: [], history: [] };

  const burialOr = [];
  if (allGraveIds.length) burialOr.push({ graveId: { [Op.in]: allGraveIds } });
  if (deceased.length) burialOr.push({ deceasedId: { [Op.in]: deceased.map((d) => d.id) } });

  const history = await Burial.findAll({
    where: { tenantId, [Op.or]: burialOr },
    include: [{ model: Deceased, as: 'deceased' }],
    order: [['burialDate', 'DESC']],
  });

  return { deceased, history };
}

/* ------------------------------------------------------------------------- */
/* Documentos do titular                                                     */
/* ------------------------------------------------------------------------- */

// Tipos de documento oficial disponibilizados à família no portal.
const PORTAL_DOCUMENT_TYPES = ['autorizacao_sepultamento', 'certidao_perpetuidade'];

const PORTAL_DOCUMENT_LABELS = {
  autorizacao_sepultamento: 'Autorização de Sepultamento',
  certidao_perpetuidade: 'Certidão de Perpetuidade',
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Escopo de documentos do titular: jazigos de concessões NÃO canceladas (como
// proprietário ou responsável) + gavetas filhas; sepultados nesses jazigos/
// gavetas + sepultados sob sua responsabilidade direta.
async function resolveDocumentScope(tenantId, personId) {
  const concessions = await Concession.findAll({
    where: concessionLinkWhere(tenantId, personId, { status: { [Op.ne]: 'cancelada' } }),
    attributes: ['graveId'],
  });
  const graveIds = [...new Set(concessions.map((c) => c.graveId).filter(Boolean))];
  const { drawerIds, parentOf } = await expandDrawers(tenantId, graveIds);
  const allGraveIds = [...graveIds, ...drawerIds];

  const deceasedOr = [{ responsiblePersonId: personId }];
  if (allGraveIds.length) deceasedOr.push({ currentGraveId: { [Op.in]: allGraveIds } });
  const deceased = await Deceased.findAll({
    where: { tenantId, [Op.or]: deceasedOr },
    attributes: ['id', 'currentGraveId'],
  });

  return {
    concessionGraveIds: new Set(graveIds),
    allGraveIds,
    parentOf,
    deceasedIds: deceased.map((d) => d.id),
    deceasedGraveOf: new Map(deceased.map((d) => [d.id, d.currentGraveId])),
  };
}

// Regra de PROPRIEDADE do documento (mesma na listagem e no download):
// do jazigo/gaveta do titular, de um sepultado vinculado a ele, ou emitido em seu nome.
function documentOwnershipWhere(scope, personId) {
  const or = [{ personId }];
  if (scope.allGraveIds.length) or.push({ graveId: { [Op.in]: scope.allGraveIds } });
  if (scope.deceasedIds.length) or.push({ deceasedId: { [Op.in]: scope.deceasedIds } });
  return { [Op.or]: or };
}

// Documentos do titular no portal: certidões de perpetuidade e autorizações de
// sepultamento vinculadas aos seus jazigos/sepultados. Exibe só a via MAIS
// RECENTE de cada documento (a 2ª via aponta para a origem por
// originalDocumentId — agrupamos pela raiz da cadeia) e nunca as canceladas.
async function listDocuments(tenantId, personId) {
  const scope = await resolveDocumentScope(tenantId, personId);

  // Busca SEM filtro de status para resolver a raiz da cadeia de vias mesmo
  // quando uma via intermediária foi cancelada; as canceladas saem depois.
  const docs = await Document.findAll({
    where: {
      tenantId,
      documentType: { [Op.in]: PORTAL_DOCUMENT_TYPES },
      ...documentOwnershipWhere(scope, personId),
    },
    include: [
      { model: Grave, as: 'grave', attributes: ['id', 'code', 'unitType', 'parentGraveId'] },
      { model: Deceased, as: 'deceased', attributes: ['id', 'fullName'] },
    ],
    order: [['issuedAt', 'DESC'], ['createdAt', 'DESC']],
  });

  const byId = new Map(docs.map((d) => [d.id, d]));
  const rootOf = (doc) => {
    let current = doc;
    const seen = new Set([doc.id]);
    while (current.originalDocumentId) {
      const parent = byId.get(current.originalDocumentId);
      // origem fora do conjunto → a própria referência é a raiz
      if (!parent) return current.originalDocumentId;
      if (seen.has(parent.id)) break; // proteção contra ciclo
      seen.add(parent.id);
      current = parent;
    }
    return current.id;
  };

  // Jazigo do portal (card) a que o documento pertence: gaveta → jazigo pai.
  const portalGraveOf = (graveId) => {
    if (!graveId) return null;
    if (scope.parentOf.has(graveId)) return scope.parentOf.get(graveId);
    return scope.concessionGraveIds.has(graveId) ? graveId : null;
  };

  // `docs` já vem do mais novo para o mais antigo: a 1ª via válida de cada raiz vence.
  const latestByRoot = new Map();
  for (const doc of docs) {
    if (doc.status === 'cancelado') continue;
    const root = rootOf(doc);
    if (!latestByRoot.has(root)) latestByRoot.set(root, doc);
  }

  return [...latestByRoot.values()].map((d) => ({
    id: d.id,
    documentType: d.documentType,
    typeLabel: PORTAL_DOCUMENT_LABELS[d.documentType] || 'Documento',
    formattedNumber: d.formattedNumber,
    issuedAt: d.issuedAt,
    status: d.status,
    isReissue: Boolean(d.originalDocumentId) || (d.reissueCount || 0) > 0,
    graveId: d.graveId,
    graveCode: d.grave ? d.grave.code : null,
    graveUnitType: d.grave ? d.grave.unitType : null,
    portalGraveId: portalGraveOf(d.graveId)
      || portalGraveOf(scope.deceasedGraveOf.get(d.deceasedId)),
    deceasedId: d.deceasedId,
    deceasedName: d.deceased ? d.deceased.fullName : null,
  }));
}

// PDF de um documento do titular. Confere a propriedade pela MESMA regra da
// listagem e delega a renderização ao gerador oficial (documents.service),
// que monta o PDF na hora a partir do cadastro atual.
async function getDocumentPdf(tenantId, personId, documentId) {
  if (!UUID_RE.test(String(documentId || ''))) throw AppError.notFound('Documento não encontrado.');

  const scope = await resolveDocumentScope(tenantId, personId);
  const owned = await Document.findOne({
    where: {
      id: documentId,
      tenantId,
      documentType: { [Op.in]: PORTAL_DOCUMENT_TYPES },
      status: { [Op.ne]: 'cancelado' },
      ...documentOwnershipWhere(scope, personId),
    },
    attributes: ['id'],
  });
  if (!owned) throw AppError.notFound('Documento não encontrado.');

  // require tardio: evita carregar o pipeline de PDF no boot do portal.
  const documentsService = require('../documents/documents.service');
  return documentsService.getOrCreatePdf(tenantId, documentId);
}

module.exports = {
  register, activate, login, getMe, updateMe, changePassword, listDebts, listBillings,
  reissueBilling, listGraves, listDeceased, listDocuments, getDocumentPdf,
  PORTAL_EDITABLE_FIELDS,
};
