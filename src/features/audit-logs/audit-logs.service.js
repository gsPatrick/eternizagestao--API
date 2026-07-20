'use strict';

const { Op } = require('sequelize');
const AppError = require('../../utils/app-error');
const { getPagination, buildPageMeta } = require('../../utils/pagination');
const { AuditLog, User } = require('../../models');

// Mapa grupo de ação -> ações concretas (espelha a tela de Auditoria do front).
const ACTION_GROUPS = {
  criacoes: ['criacao'],
  edicoes: ['edicao'],
  exclusoes: ['exclusao'],
  acessos: ['login', 'logout'],
  financeiro: ['pagamento_manual', 'bloqueio', 'desbloqueio'],
  documentos: ['emissao_documento', 'exportacao'],
};

// Parser simples de userAgent -> "Navegador · SO" (helper puro).
// Se não reconhecer, retorna o UA cru truncado.
function parseDevice(ua) {
  if (!ua || typeof ua !== 'string') return null;

  let browser = null;
  if (/edg/i.test(ua)) browser = 'Edge';
  else if (/opr\/|opera/i.test(ua)) browser = 'Opera';
  else if (/chrome|crios|chromium/i.test(ua)) browser = 'Chrome';
  else if (/firefox|fxios/i.test(ua)) browser = 'Firefox';
  else if (/safari/i.test(ua)) browser = 'Safari';

  let os = null;
  if (/windows/i.test(ua)) os = 'Windows';
  else if (/iphone|ipad|ipod/i.test(ua)) os = 'iOS';
  else if (/mac os x|macintosh/i.test(ua)) os = 'macOS';
  else if (/android/i.test(ua)) os = 'Android';
  else if (/linux/i.test(ua)) os = 'Linux';

  if (browser && os) return `${browser} · ${os}`;
  if (browser) return browser;
  if (os) return os;
  return ua.length > 60 ? `${ua.slice(0, 57)}…` : ua;
}

// Normaliza um registro do Sequelize para o shape que o front consome.
function serialize(log) {
  const plain = typeof log.get === 'function' ? log.get({ plain: true }) : log;
  const { user, userAgent, ...rest } = plain;
  return {
    id: rest.id,
    action: rest.action,
    entityType: rest.entityType,
    entityId: rest.entityId,
    description: rest.description,
    previousData: rest.previousData,
    newData: rest.newData,
    ipAddress: rest.ipAddress,
    device: parseDevice(userAgent),
    userAgent,
    userId: rest.userId,
    userName: user ? user.name : null,
    createdAt: rest.createdAt,
  };
}

// Constrói a cláusula WHERE a partir dos query params (todos opcionais/combináveis).
function buildWhere(tenantId, query = {}) {
  const where = { tenantId };

  // Ação específica e/ou grupo de ação. Combinados via AND (Op.and) quando ambos vierem.
  const actionConditions = [];
  if (query.action) actionConditions.push({ action: query.action });
  if (query.actionGroup && query.actionGroup !== 'todas') {
    const actions = ACTION_GROUPS[query.actionGroup];
    if (actions) actionConditions.push({ action: { [Op.in]: actions } });
  }
  if (actionConditions.length === 1) {
    Object.assign(where, actionConditions[0]);
  } else if (actionConditions.length > 1) {
    where[Op.and] = actionConditions;
  }

  if (query.userId) where.userId = query.userId;
  if (query.entityType) where.entityType = query.entityType;

  const dateFrom = query.dateFrom || query.from;
  const dateTo = query.dateTo || query.to;
  if (dateFrom || dateTo) {
    where.createdAt = {};
    if (dateFrom) where.createdAt[Op.gte] = new Date(dateFrom);
    if (dateTo) where.createdAt[Op.lte] = new Date(dateTo);
  }

  // Busca livre em description / entityType / ipAddress.
  if (query.q) {
    const term = `%${query.q}%`;
    where[Op.or] = [
      { description: { [Op.iLike]: term } },
      { entityType: { [Op.iLike]: term } },
      { ipAddress: { [Op.iLike]: term } },
    ];
  }

  return where;
}

async function list(tenantId, query = {}) {
  const { page, perPage, limit, offset } = getPagination(query, { defaultPerPage: 30 });
  const where = buildWhere(tenantId, query);

  const { rows, count } = await AuditLog.findAndCountAll({
    where,
    limit,
    offset,
    order: [['createdAt', 'DESC']],
    include: [{ model: User, as: 'user', attributes: ['id', 'name'] }],
  });

  return { rows: rows.map(serialize), meta: buildPageMeta(count, page, perPage) };
}

async function getById(tenantId, id) {
  const log = await AuditLog.findOne({
    where: { id, tenantId },
    include: [{ model: User, as: 'user', attributes: ['id', 'name'] }],
  });
  if (!log) throw AppError.notFound('Registro de auditoria não encontrado.');
  return serialize(log);
}

module.exports = { list, getById, parseDevice, ACTION_GROUPS };
