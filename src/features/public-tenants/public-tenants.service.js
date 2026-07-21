'use strict';

const { Op } = require('sequelize');
const { Tenant, Cemetery, Schedule, Chapel, Deceased, Grave } = require('../../models');
const storage = require('../../providers/storage');

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
  };
}

// Agenda PÚBLICA de um cemitério: próximos velórios/sepultamentos/exumações,
// somente campos não sensíveis, ordenados por data. Isolamento multi-tenant
// garantido pelo tenantId (resolvido do subdomínio) + cemeteryId.
async function cemeteryAgenda(tenantId, cemeteryId, { limit = 30 } = {}) {
  const schedules = await Schedule.findAll({
    where: {
      tenantId,
      cemeteryId,
      scheduleType: { [Op.in]: PUBLIC_SCHEDULE_TYPES },
      status: { [Op.notIn]: ['cancelado'] },
      startsAt: { [Op.gte]: new Date() },
    },
    include: [
      { model: Chapel, as: 'chapel', attributes: ['id', 'name'], required: false },
      { model: Grave, as: 'grave', attributes: ['id', 'code'], required: false },
      { model: Deceased, as: 'deceased', attributes: ['id', 'fullName'], required: false },
    ],
    order: [['startsAt', 'ASC']],
    limit: Math.min(Number(limit) || 30, 30),
  });

  return schedules.map(toPublicAgendaItem);
}

module.exports = { listTenants, listCemeteries, cemeteryAgenda };
