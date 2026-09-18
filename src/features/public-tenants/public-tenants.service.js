'use strict';

const { Op } = require('sequelize');
const { Tenant, Cemetery, Schedule, Chapel, Deceased, Grave } = require('../../models');
const storage = require('../../providers/storage');
const { startOfTodayInTZ, combineLocalDateTime } = require('../../utils/date-local');

// Logo local (/files/...) → URL assinada (TTL longo, branding); http externa passa direto.
function signLogo(logoUrl) {
  return logoUrl ? storage.signedUrl(logoUrl, { ttlSeconds: 604800 }) : logoUrl;
}

// Serialização PÚBLICA de tenant — apenas identidade/branding para o front
// montar a lista de cidades. Nunca expor CNPJ, contato, settings ou endereço.
function toPublicTenant(tenant) {
  return {
    id: tenant.id,
    name: tenant.name,
    subdomain: tenant.subdomain,
    primaryColor: tenant.primaryColor,
    secondaryColor: tenant.secondaryColor,
    logoUrl: signLogo(tenant.logoUrl),
    // Arte da página pública da cidade (quando vazia, o front usa a padrão).
    heroImageUrl: signLogo(tenant.heroImageUrl),
    footerImageUrl: signLogo(tenant.footerImageUrl),
  };
}

// Lista pública de clientes ativos (cidades) — sem auth e sem tenant no contexto.
async function listTenants() {
  const tenants = await Tenant.findAll({
    where: { active: true },
    order: [['name', 'ASC']],
  });
  return tenants.map(toPublicTenant);
}

// Lista PÚBLICA de cemitérios ativos do tenant (id + nome apenas). Serve para
// o portal público escolher qual agenda exibir (ex.: primeiro cemitério).
// Isolamento garantido pelo tenantId resolvido do subdomínio.
async function listCemeteries(tenantId) {
  const cemeteries = await Cemetery.findAll({
    where: { tenantId, active: true },
    order: [['name', 'ASC']],
    attributes: ['id', 'name'],
  });
  return cemeteries.map((c) => ({ id: c.id, name: c.name }));
}

// Tipos de agendamento expostos publicamente. Visitas técnicas e "outro"
// não são de interesse do público e ficam de fora.
const PUBLIC_SCHEDULE_TYPES = ['velorio', 'sepultamento', 'exumacao'];

// Local legível do evento: capela (velório) ou identificação do túmulo
// (sepultamento/exumação). Sem dados sensíveis.
function resolvePlace(schedule) {
  if (schedule.chapel?.name) return schedule.chapel.name;
  if (schedule.grave?.code) return `Túmulo ${schedule.grave.code}`;
  return null;
}

function toPublicAgendaItem(schedule) {
  return {
    id: schedule.id,
    type: schedule.scheduleType,
    title: schedule.title || null,
    dateTime: schedule.startsAt,
    place: resolvePlace(schedule),
    deceasedName: schedule.deceased?.fullName || null,
    // Qual cemitério — a agenda pode agregar TODOS os cemitérios da cidade.
    cemeteryId: schedule.cemeteryId,
    cemeteryName: schedule.cemetery?.name || null,
  };
}

const AGENDA_DEFAULT_LIMIT = 200;
const AGENDA_MAX_LIMIT = 500;

/**
 * Agenda PÚBLICA: próximos velórios/sepultamentos/exumações, somente campos não
 * sensíveis, ordenados por data. Isolamento multi-tenant garantido pelo tenantId
 * (resolvido do subdomínio).
 *
 * `cemeteryId` é OPCIONAL: sem ele a agenda agrega TODOS os cemitérios do tenant
 * (cada item carrega o cemitério a que pertence) — um sepultamento marcado num
 * cemitério que não é o primeiro da cidade também precisa aparecer.
 *
 * CORTE POR DIA, NÃO POR INSTANTE: o corte é a MEIA-NOITE de hoje no fuso de
 * operação. Usar `new Date()` fazia o sepultamento cadastrado no mesmo dia, mas
 * com horário já passado (ex.: 08:00, ou a hora padrão 09:00), nascer "vencido"
 * e sumir do portal — exatamente o bug relatado pelo cliente. Aceita ainda uma
 * janela opcional from/to (YYYY-MM-DD ou ISO) e paginação por limit/offset.
 */
async function cemeteryAgenda(tenantId, cemeteryId, { from, to, limit, offset } = {}) {
  const startsAt = {};
  startsAt[Op.gte] = from ? combineLocalDateTime(from, '00:00') || startOfTodayInTZ() : startOfTodayInTZ();
  // `to` é inclusivo no DIA: 23:59 do dia informado, no fuso de operação.
  if (to) {
    const fim = combineLocalDateTime(to, '23:59');
    if (fim) startsAt[Op.lte] = fim;
  }

  const where = {
    tenantId,
    scheduleType: { [Op.in]: PUBLIC_SCHEDULE_TYPES },
    status: { [Op.notIn]: ['cancelado'] },
    startsAt,
  };
  if (cemeteryId) where.cemeteryId = cemeteryId;

  const schedules = await Schedule.findAll({
    where,
    include: [
      { model: Cemetery, as: 'cemetery', attributes: ['id', 'name'], required: false },
      { model: Chapel, as: 'chapel', attributes: ['id', 'name'], required: false },
      { model: Grave, as: 'grave', attributes: ['id', 'code'], required: false },
      { model: Deceased, as: 'deceased', attributes: ['id', 'fullName'], required: false },
    ],
    order: [['startsAt', 'ASC']],
    limit: Math.min(Math.max(Number(limit) || AGENDA_DEFAULT_LIMIT, 1), AGENDA_MAX_LIMIT),
    offset: Math.max(Number(offset) || 0, 0),
  });

  return schedules.map(toPublicAgendaItem);
}

module.exports = { listTenants, listCemeteries, cemeteryAgenda };
