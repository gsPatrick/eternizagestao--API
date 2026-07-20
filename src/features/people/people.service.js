'use strict';

const crypto = require('crypto');
const { Op, fn, col, literal } = require('sequelize');
const AppError = require('../../utils/app-error');
const storage = require('../../providers/storage');
const { getPagination, buildPageMeta } = require('../../utils/pagination');
const { randomToken } = require('../../utils/password');
const { portalActivationUrl } = require('../../utils/tenant-url');
const {
  Person, PersonRelationship, Concession, Grave,
  FamilyPortalAccount, MaintenanceFee, Tenant,
} = require('../../models');

// Foto da pessoa: aceita PNG/JPEG/WEBP; teto de 5 MB (foto de perfil).
const PHOTO_MIME_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
const PHOTO_MAX_BYTES = 5 * 1024 * 1024; // 5 MB

// TTL longo (7 dias) da URL assinada da foto devolvida ao painel via <img>.
const PHOTO_URL_TTL_SECONDS = Number(process.env.PHOTO_URL_TTL_SECONDS || 7 * 24 * 3600);

// Assina o photoUrl LOCAL (/files/...) p/ exibição via <img>; externo/vazio passa intacto.
function signPhoto(photoUrl) {
  return photoUrl ? storage.signedUrl(photoUrl, { ttlSeconds: PHOTO_URL_TTL_SECONDS }) : photoUrl;
}

// Contrato externo (feature `notifications`) — require defensivo para não
// derrubar o módulo caso a dependência ainda não esteja disponível.
let notificationsService = null;
try {
  notificationsService = require('../notifications/notifications.service');
} catch (_err) {
  notificationsService = null;
}

// Dispara (via FILA) o e-mail de ativação do Portal da Família. Best-effort:
// enfileira e nunca propaga erro — o convite não pode falhar por causa do envio.
// O token cru só viaja dentro do cta_url; jamais é retornado/logado. O LINK usa
// o subdomínio da cidade (`tenant`); sem tenant cai no PORTAL_URL global.
async function sendActivationEmail({ tenantId, tenant, person, email, rawToken }) {
  if (!notificationsService) return;
  try {
    await notificationsService.notify({
      tenantId,
      personId: person.id,
      contact: email,
      channel: 'email',
      notificationType: 'portal_acesso',
      subject: 'Ative seu acesso ao Portal da Família',
      template: 'activation',
      vars: { nome: person.fullName, cta_url: portalActivationUrl(tenant, rawToken) },
      referenceType: 'family_portal_account',
    });
  } catch (err) {
    // notify já é "nunca rejeita", mas protegemos o convite de qualquer forma.
    console.error('[people] envio do convite de portal falhou:', err.message);
  }
}

const EDITABLE_FIELDS = [
  'fullName', 'cpf', 'rg', 'birthDate', 'gender', 'email', 'phonePrimary',
  'phoneSecondary', 'whatsapp', 'addressStreet', 'addressNumber', 'addressComplement',
  'addressDistrict', 'addressCity', 'addressState', 'addressZipcode', 'photoUrl',
  'notes', 'active',
];

// Papéis derivados de dados reais (não há coluna "role" — o papel é uma relação):
//  - proprietario: possui concessão
//  - responsavel: figura como pagador de alguma taxa de manutenção
//  - familiar: participa de algum vínculo familiar (qualquer lado)
//  - portal: possui conta de Portal da Família não bloqueada
const ROLE_FILTERS = ['proprietario', 'responsavel', 'familiar', 'portal'];

function roleExists(role) {
  switch (role) {
    case 'proprietario':
      return literal('EXISTS (SELECT 1 FROM concessions c WHERE c.person_id = "Person".id AND c.tenant_id = "Person".tenant_id AND c.deleted_at IS NULL)');
    case 'responsavel':
      // responsável LEGAL de alguma concessão (§3.2) — distinto do proprietário.
      return literal('EXISTS (SELECT 1 FROM concessions c WHERE c.responsible_person_id = "Person".id AND c.tenant_id = "Person".tenant_id AND c.deleted_at IS NULL)');
    case 'familiar':
      return literal('EXISTS (SELECT 1 FROM person_relationships pr WHERE pr.tenant_id = "Person".tenant_id AND (pr.person_id = "Person".id OR pr.related_person_id = "Person".id))');
    case 'portal':
      return literal("EXISTS (SELECT 1 FROM family_portal_accounts fpa WHERE fpa.person_id = \"Person\".id AND fpa.tenant_id = \"Person\".tenant_id AND fpa.status <> 'bloqueado')");
    default:
      return null;
  }
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function portalSummary(account) {
  if (!account) return { active: false, status: null, email: null, since: null };
  return {
    active: account.status !== 'bloqueado',
    status: account.status,
    email: account.email,
    since: account.createdAt,
  };
}

/**
 * Anota cada pessoa da página com os papéis derivados, a contagem de concessões
 * e o resumo da conta do portal — em poucas queries agrupadas (sem N+1).
 */
async function annotate(tenantId, people) {
  const ids = people.map((p) => p.id);
  if (!ids.length) return [];

  const [concCounts, respCounts, relOwner, relRelated, portals] = await Promise.all([
    Concession.findAll({
      where: { tenantId, personId: { [Op.in]: ids } },
      attributes: ['personId', [fn('COUNT', col('id')), 'count']],
      group: ['personId'], raw: true,
    }),
    // concessões onde a pessoa é o RESPONSÁVEL legal (papel 'responsavel')
    Concession.findAll({
      where: { tenantId, responsiblePersonId: { [Op.in]: ids } },
      attributes: ['responsiblePersonId', [fn('COUNT', col('id')), 'count']],
      group: ['responsiblePersonId'], raw: true,
    }),
    PersonRelationship.findAll({
      where: { tenantId, personId: { [Op.in]: ids } },
      attributes: ['personId'], group: ['personId'], raw: true,
    }),
    PersonRelationship.findAll({
      where: { tenantId, relatedPersonId: { [Op.in]: ids } },
      attributes: ['relatedPersonId'], group: ['relatedPersonId'], raw: true,
    }),
    FamilyPortalAccount.findAll({
      where: { tenantId, personId: { [Op.in]: ids } },
      attributes: ['personId', 'status', 'email', 'createdAt'], raw: true,
    }),
  ]);

  const concMap = {};
  concCounts.forEach((r) => { concMap[r.personId] = Number(r.count); });
  const respMap = {};
  respCounts.forEach((r) => { respMap[r.responsiblePersonId] = Number(r.count); });
  const familiarSet = new Set([
    ...relOwner.map((r) => r.personId),
    ...relRelated.map((r) => r.relatedPersonId),
  ]);
  const portalMap = {};
  portals.forEach((a) => { portalMap[a.personId] = a; });

  return people.map((p) => {
    const json = p.toJSON();
    const concessionsCount = concMap[p.id] || 0;
    const responsibleCount = respMap[p.id] || 0;
    const account = portalMap[p.id] || null;
    const roles = [];
    if (concessionsCount > 0) roles.push('proprietario');
    if (responsibleCount > 0) roles.push('responsavel');
    if (familiarSet.has(p.id)) roles.push('familiar');
    return {
      ...json,
      // photoUrl assinado (só se local /files/...) — a <img> do painel não manda Bearer.
      photoUrl: signPhoto(json.photoUrl),
      roles,
      concessionsCount,
      responsibleCount,
      portal: portalSummary(account),
    };
  });
}

async function list(tenantId, query) {
  const { page, perPage, limit, offset } = getPagination(query, { defaultPerPage: 30 });
  const where = { tenantId };
  const and = [];
  if (query.search) {
    where[Op.or] = [
      { fullName: { [Op.iLike]: `%${query.search}%` } },
      { cpf: { [Op.iLike]: `%${query.search}%` } },
      { email: { [Op.iLike]: `%${query.search}%` } },
    ];
  }
  if (query.active !== undefined) where.active = query.active === 'true';
  if (query.role && ROLE_FILTERS.includes(query.role)) and.push(roleExists(query.role));
  if (and.length) where[Op.and] = and;

  const { rows, count } = await Person.findAndCountAll({
    where, limit, offset, order: [['fullName', 'ASC']],
  });
  return { rows: await annotate(tenantId, rows), meta: buildPageMeta(count, page, perPage) };
}

// Contadores dos chips de filtro da listagem.
async function summary(tenantId) {
  const roleCount = (role) => Person.count({ where: { tenantId, [Op.and]: [roleExists(role)] } });
  const [total, proprietario, responsavel, familiar, portal, inativos, withWhatsapp] = await Promise.all([
    Person.count({ where: { tenantId } }),
    roleCount('proprietario'),
    roleCount('responsavel'),
    roleCount('familiar'),
    roleCount('portal'),
    Person.count({ where: { tenantId, active: false } }),
    Person.count({ where: { tenantId, whatsapp: { [Op.and]: [{ [Op.ne]: null }, { [Op.ne]: '' }] } } }),
  ]);
  return { total, proprietario, responsavel, familiar, portal, inativos, withWhatsapp };
}

async function getById(tenantId, id) {
  const person = await Person.findOne({
    where: { id, tenantId },
    include: [
      {
        model: PersonRelationship, as: 'relationships',
        include: [{ model: Person, as: 'relatedPerson', attributes: ['id', 'fullName', 'cpf'] }],
      },
      {
        model: Concession, as: 'concessions',
        attributes: ['id', 'graveId', 'concessionType', 'contractNumber', 'startDate', 'endDate', 'status'],
        include: [{ model: Grave, as: 'grave', attributes: ['id', 'code'] }],
      },
      {
        // concessões onde a pessoa é o RESPONSÁVEL legal (não o proprietário)
        model: Concession, as: 'responsibleConcessions',
        attributes: ['id', 'graveId', 'concessionType', 'contractNumber', 'startDate', 'endDate', 'status'],
        include: [
          { model: Grave, as: 'grave', attributes: ['id', 'code'] },
          { model: Person, as: 'person', attributes: ['id', 'fullName'] },
        ],
      },
      { model: FamilyPortalAccount, as: 'portalAccount' },
    ],
    order: [[{ model: Concession, as: 'concessions' }, 'startDate', 'DESC']],
  });
  if (!person) throw AppError.notFound('Pessoa não encontrada.');
  const json = person.toJSON();
  json.portal = portalSummary(person.portalAccount);
  json.photoUrl = signPhoto(json.photoUrl); // assinado (só se local /files/...)
  // papéis derivados (o detalhe também precisa dos badges de vínculo)
  const roles = [];
  if ((json.concessions || []).length) roles.push('proprietario');
  if ((json.responsibleConcessions || []).length) roles.push('responsavel');
  if ((json.relationships || []).length) roles.push('familiar');
  json.roles = roles;
  return json;
}

async function create(tenantId, data) {
  return Person.create({ ...data, tenantId });
}

async function update(tenantId, id, data) {
  const person = await Person.findOne({ where: { id, tenantId } });
  if (!person) throw AppError.notFound('Pessoa não encontrada.');
  return person.update(data);
}

async function remove(tenantId, id) {
  const person = await Person.findOne({ where: { id, tenantId } });
  if (!person) throw AppError.notFound('Pessoa não encontrada.');
  try {
    await person.destroy(); // soft delete
  } catch (err) {
    if (err.name === 'SequelizeForeignKeyConstraintError') {
      throw AppError.conflict('Pessoa vinculada a concessões/cobranças — desative em vez de excluir.', 'PERSON_IN_USE');
    }
    throw err;
  }
}

// ---- vínculos familiares ----
async function addRelationship(tenantId, personId, { relatedPersonId, relationshipType, notes }) {
  const [person, related] = await Promise.all([
    Person.findOne({ where: { id: personId, tenantId } }),
    Person.findOne({ where: { id: relatedPersonId, tenantId } }),
  ]);
  if (!person || !related) throw AppError.notFound('Pessoa não encontrada.');
  if (personId === relatedPersonId) throw AppError.badRequest('Pessoa não pode ter vínculo consigo mesma.');
  return PersonRelationship.create({ tenantId, personId, relatedPersonId, relationshipType, notes });
}

async function removeRelationship(tenantId, personId, relationshipId) {
  const rel = await PersonRelationship.findOne({ where: { id: relationshipId, tenantId, personId } });
  if (!rel) throw AppError.notFound('Vínculo não encontrado.');
  await rel.destroy();
}

// ---- conta do Portal da Família (gestão administrativa) ----
// Convite: cria/reativa a conta em 'pendente_ativacao' com token de ativação de
// uso único (apenas o HASH é persistido; o token cru fica a cargo do provider de
// notificação — nunca retornado). Espelha o fluxo do family-portal.service.
async function invitePortal(tenantId, personId, { email } = {}) {
  const person = await Person.findOne({ where: { id: personId, tenantId } });
  if (!person) throw AppError.notFound('Pessoa não encontrada.');

  const targetEmail = normalizeEmail(email || person.email);
  if (!targetEmail) {
    throw AppError.badRequest('Pessoa sem e-mail — informe um e-mail para o convite do portal.', 'PORTAL_EMAIL_REQUIRED');
  }

  const activationToken = randomToken();
  let account = await FamilyPortalAccount.scope('withSecrets').findOne({ where: { tenantId, personId } });
  if (account) {
    if (account.status === 'ativo') {
      throw AppError.conflict('Pessoa já possui acesso ativo ao portal.', 'PORTAL_ALREADY_ACTIVE');
    }
    await account.update({ email: targetEmail, status: 'pendente_ativacao', activationToken: hashToken(activationToken) });
  } else {
    account = await FamilyPortalAccount.create({
      tenantId, personId, email: targetEmail,
      status: 'pendente_ativacao', activationToken: hashToken(activationToken),
    });
  }

  // Tenant p/ derivar o LINK branded (subdomínio da cidade); null → fallback global.
  const tenant = await Tenant.findByPk(tenantId, { attributes: ['id', 'subdomain'] }).catch(() => null);

  // Envio do link de ativação via FILA (não bloqueia/derruba o convite).
  await sendActivationEmail({ tenantId, tenant, person, email: targetEmail, rawToken: activationToken });

  // resposta sem segredos — o token cru nunca sai do servidor
  return { id: account.id, personId, email: account.email, status: account.status, since: account.createdAt };
}

async function revokePortal(tenantId, personId) {
  const account = await FamilyPortalAccount.findOne({ where: { tenantId, personId } });
  if (!account) throw AppError.notFound('Conta do portal não encontrada.');
  await account.update({ status: 'bloqueado' });
  return { id: account.id, personId, email: account.email, status: account.status };
}

/**
 * Upload da FOTO da pessoa (base64). Valida tipo/tamanho, persiste via storage
 * (servido em /files/...), grava person.photoUrl (fileUrl estável) e devolve
 * { photoUrl } ASSINADO p/ exibição imediata via <img>. Espelha tenants.uploadLogo.
 */
async function uploadPhoto(tenantId, id, { contentBase64, fileName, mimeType } = {}) {
  const person = await Person.findOne({ where: { id, tenantId } });
  if (!person) throw AppError.notFound('Pessoa não encontrada.');

  if (!contentBase64) {
    throw AppError.badRequest('Envie o arquivo da foto (contentBase64).', 'MISSING_FILE');
  }
  const mime = String(mimeType || '').toLowerCase();
  if (!PHOTO_MIME_TYPES.includes(mime)) {
    throw AppError.badRequest('Formato inválido. Envie uma imagem PNG, JPEG ou WEBP.', 'INVALID_IMAGE_TYPE');
  }
  const buffer = Buffer.from(contentBase64, 'base64');
  if (!buffer.length) {
    throw AppError.badRequest('Arquivo de foto vazio ou inválido.', 'INVALID_FILE');
  }
  if (buffer.length > PHOTO_MAX_BYTES) {
    throw AppError.badRequest('Imagem muito grande. O limite é 5 MB.', 'FILE_TOO_LARGE');
  }

  const saved = await storage.saveFile({
    tenantId,
    fileName: fileName || 'foto.png',
    content: buffer,
    mimeType: mime,
  });

  await person.update({ photoUrl: saved.fileUrl });
  return { photoUrl: signPhoto(saved.fileUrl) };
}

module.exports = {
  list, summary, getById, create, update, remove,
  addRelationship, removeRelationship, invitePortal, revokePortal, uploadPhoto,
  EDITABLE_FIELDS,
};
