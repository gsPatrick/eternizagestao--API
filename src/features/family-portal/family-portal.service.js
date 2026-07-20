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
  GraveStatus, Lot, Street, Block, Deceased, Burial, GraveEvent, Cemetery, Tenant,
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
    where: { tenantId, personId },
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

// Meus jazigos: todas as concessões do titular (qualquer status), já enriquecidas
// para a tela do portal — localização, situação financeira (em dia x pendência),
// sepultados e linha do tempo de cada jazigo. Somente leitura.
async function listGraves(tenantId, personId) {
  const concessions = await Concession.findAll({
    where: { tenantId, personId },
    order: [['startDate', 'DESC']],
    include: [{
      model: Grave, as: 'grave',
      include: [...graveIncludes, { model: Cemetery, as: 'cemetery', attributes: ['id', 'name'] }],
    }],
  });

  const graveIds = [...new Set(concessions.map((c) => c.graveId).filter(Boolean))];
  if (!graveIds.length) return [];

  const [openBillings, occupants, burials, events] = await Promise.all([
    // Situação financeira por jazigo: existe cobrança em aberto? → pendência.
    Billing.findAll({
      where: {
        tenantId, payerPersonId: personId, graveId: { [Op.in]: graveIds },
        status: { [Op.in]: ['pendente', 'em_atraso'] },
      },
      attributes: ['graveId'],
    }),
    // Ocupantes atuais de cada jazigo.
    Deceased.findAll({
      where: { tenantId, currentGraveId: { [Op.in]: graveIds } },
      order: [['fullName', 'ASC']],
    }),
    // Histórico de sepultamentos (data + fallback de sepultados sem ocupação atual).
    Burial.findAll({
      where: { tenantId, graveId: { [Op.in]: graveIds } },
      include: [{ model: Deceased, as: 'deceased' }],
      order: [['burialDate', 'DESC']],
    }),
    // Linha do tempo do jazigo.
    GraveEvent.findAll({
      where: { tenantId, graveId: { [Op.in]: graveIds } },
      order: [['occurredAt', 'DESC']],
    }),
  ]);

  const openByGrave = new Set(openBillings.map((b) => b.graveId));
  const groupBy = (rows, key) => {
    const map = new Map();
    for (const row of rows) {
      const k = row[key];
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(row);
    }
    return map;
  };
  const occByGrave = groupBy(occupants, 'currentGraveId');
  const burialsByGrave = groupBy(burials, 'graveId');
  const eventsByGrave = groupBy(events, 'graveId');

  return concessions.map((c) => {
    const g = c.grave;
    const gid = c.graveId;
    const graveBurials = burialsByGrave.get(gid) || [];
    const burialDateFor = (deceasedId) => {
      const b = graveBurials.find((x) => x.deceasedId === deceasedId);
      return b ? b.burialDate : null;
    };

    // Sepultados: ocupantes atuais; se não houver, deriva do histórico de sepultamentos.
    let deceased = (occByGrave.get(gid) || []).map((d) => ({
      id: d.id, fullName: d.fullName, birthDate: d.birthDate,
      deathDate: d.deathDate, burialDate: burialDateFor(d.id),
    }));
    if (!deceased.length) {
      const seen = new Set();
      for (const b of graveBurials) {
        if (!b.deceased || seen.has(b.deceasedId)) continue;
        seen.add(b.deceasedId);
        deceased.push({
          id: b.deceased.id, fullName: b.deceased.fullName, birthDate: b.deceased.birthDate,
          deathDate: b.deceased.deathDate, burialDate: b.burialDate,
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
      code: g ? g.code : null,
      unitType: g ? g.unitType : null,
      cemetery: g && g.cemetery ? g.cemetery.name : null,
      concessionType: c.concessionType,
      contractNumber: c.contractNumber,
      startDate: c.startDate,
      concessionStatus: c.status,
      status: openByGrave.has(gid) ? 'pendente' : 'em_dia',
      location: {
        block: block ? block.name : null,
        street: street ? street.name : null,
        lot: lot ? lot.code : null,
      },
      deceased,
      timeline,
    };
  });
}

// Meus sepultados: ocupantes atuais dos jazigos com concessão ATIVA do titular,
// mais o histórico de sepultamentos desses jazigos.
async function listDeceased(tenantId, personId) {
  const activeConcessions = await Concession.findAll({
    where: { tenantId, personId, status: 'ativa' },
    attributes: ['graveId'],
  });
  const graveIds = [...new Set(activeConcessions.map((c) => c.graveId))];
  if (!graveIds.length) return { deceased: [], history: [] };

  const [deceased, history] = await Promise.all([
    Deceased.findAll({
      where: { tenantId, currentGraveId: { [Op.in]: graveIds } },
      order: [['fullName', 'ASC']],
    }),
    Burial.findAll({
      where: { tenantId, graveId: { [Op.in]: graveIds } },
      include: [{ model: Deceased, as: 'deceased' }],
      order: [['burialDate', 'DESC']],
    }),
  ]);

  return { deceased, history };
}

module.exports = {
  register, activate, login, getMe, updateMe, changePassword, listDebts, listBillings,
  reissueBilling, listGraves, listDeceased, PORTAL_EDITABLE_FIELDS,
};
