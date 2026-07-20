'use strict';

/**
 * Exporters — mapa { exportType: buildRows(tenantId, { periodStart, periodEnd, cemeteryId }) }.
 * Cada exporter retorna um array plano de objetos (pronto para toCsv/JSON).
 * As consultas são intencionalmente independentes dos reports (duplicação leve
 * aceita) para que exportações oficiais não quebrem com mudanças nos relatórios.
 */
const { Op } = require('sequelize');
const {
  Burial, Deceased, Grave, GraveStatus, Cemetery, Person, User,
  Exhumation, Payment, Billing, Lot, Street, Block,
} = require('../../models');

function dateOnlyRange(periodStart, periodEnd) {
  if (!periodStart && !periodEnd) return null;
  const range = {};
  if (periodStart) range[Op.gte] = periodStart;
  if (periodEnd) range[Op.lte] = periodEnd;
  return range;
}

function dateTimeRange(periodStart, periodEnd) {
  if (!periodStart && !periodEnd) return null;
  const range = {};
  if (periodStart) range[Op.gte] = new Date(`${periodStart}T00:00:00`);
  if (periodEnd) range[Op.lte] = new Date(`${periodEnd}T23:59:59.999`);
  return range;
}

// Consulta base de sepultamentos — reutilizada por 'sepultamentos' e 'orgao_municipal'
async function findBurials(tenantId, { periodStart, periodEnd, cemeteryId }) {
  const where = { tenantId };
  if (cemeteryId) where.cemeteryId = cemeteryId;
  const range = dateOnlyRange(periodStart, periodEnd);
  if (range) where.burialDate = range;

  return Burial.findAll({
    where,
    order: [['burialDate', 'ASC']],
    include: [
      { model: Deceased, as: 'deceased', paranoid: false },
      { model: Grave, as: 'grave', attributes: ['code'], paranoid: false },
      { model: Cemetery, as: 'cemetery', attributes: ['name'], paranoid: false },
      { model: Person, as: 'declarant', attributes: ['fullName'], paranoid: false },
      { model: User, as: 'registeredBy', attributes: ['name'], paranoid: false },
    ],
  });
}

const exporters = {
  async sepultamentos(tenantId, params) {
    const burials = await findBurials(tenantId, params);
    return burials.map((b) => ({
      burialDate: b.burialDate,
      deceasedName: b.deceased?.fullName || null,
      deceasedCpf: b.deceased?.cpf || null,
      graveCode: b.grave?.code || null,
      cemeteryName: b.cemetery?.name || null,
      status: b.status,
    }));
  },

  async exumacoes(tenantId, { periodStart, periodEnd, cemeteryId }) {
    const where = { tenantId };
    if (cemeteryId) where.cemeteryId = cemeteryId;
    const range = dateOnlyRange(periodStart, periodEnd);
    if (range) where.requestDate = range;

    const list = await Exhumation.findAll({
      where,
      order: [['requestDate', 'ASC']],
      include: [
        { model: Deceased, as: 'deceased', attributes: ['fullName'], paranoid: false },
        { model: Grave, as: 'grave', attributes: ['code'], paranoid: false },
      ],
    });
    return list.map((e) => ({
      requestDate: e.requestDate,
      performedAt: e.performedAt,
      deceasedName: e.deceased?.fullName || null,
      originGraveCode: e.grave?.code || null,
      destinationType: e.destinationType,
      status: e.status,
    }));
  },

  async financeiro(tenantId, { periodStart, periodEnd, cemeteryId }) {
    const where = { tenantId };
    const range = dateTimeRange(periodStart, periodEnd);
    if (range) where.paidAt = range;

    const billingInclude = {
      model: Billing, as: 'billing',
      attributes: ['description', 'referencePeriod', 'cemeteryId'],
      include: [{ model: Person, as: 'payer', attributes: ['fullName'], paranoid: false }],
    };
    if (cemeteryId) {
      billingInclude.where = { cemeteryId };
      billingInclude.required = true;
    }

    const list = await Payment.findAll({
      where, order: [['paidAt', 'ASC']], include: [billingInclude],
    });
    return list.map((p) => ({
      paidAt: p.paidAt,
      amountPaid: p.amountPaid,
      method: p.method,
      payerName: p.billing?.payer?.fullName || null,
      billingDescription: p.billing?.description || null,
      referencePeriod: p.billing?.referencePeriod || null,
    }));
  },

  async inadimplencia(tenantId, { periodStart, periodEnd, cemeteryId }) {
    const where = { tenantId, status: 'em_atraso' };
    if (cemeteryId) where.cemeteryId = cemeteryId;
    const range = dateOnlyRange(periodStart, periodEnd);
    if (range) where.dueDate = range;

    const list = await Billing.findAll({
      where,
      order: [['dueDate', 'ASC']],
      include: [
        { model: Person, as: 'payer', attributes: ['fullName', 'cpf'], paranoid: false },
        { model: Grave, as: 'grave', attributes: ['code'], paranoid: false },
      ],
    });
    const today = Date.now();
    return list.map((b) => ({
      payerName: b.payer?.fullName || null,
      payerCpf: b.payer?.cpf || null,
      graveCode: b.grave?.code || null,
      dueDate: b.dueDate,
      totalAmount: b.totalAmount,
      daysOverdue: Math.max(0, Math.floor((today - new Date(`${b.dueDate}T00:00:00`)) / 86400000)),
    }));
  },

  async ocupacao(tenantId, { cemeteryId }) {
    const where = { tenantId };
    if (cemeteryId) where.cemeteryId = cemeteryId;

    const graves = await Grave.findAll({
      where,
      order: [['code', 'ASC']],
      include: [
        { model: GraveStatus, as: 'status', attributes: ['name', 'slug'] },
        { model: Cemetery, as: 'cemetery', attributes: ['name'] },
        {
          model: Lot, as: 'lot', attributes: ['code'],
          include: [{
            model: Street, as: 'street', attributes: ['id'],
            include: [{ model: Block, as: 'block' }],
          }],
        },
      ],
    });
    return graves.map((g) => {
      const block = g.lot?.street?.block;
      return {
        cemeteryName: g.cemetery?.name || null,
        block: block ? (block.name || block.code || null) : null,
        lotCode: g.lot?.code || null,
        graveCode: g.code,
        unitType: g.unitType,
        status: g.status?.name || null,
        statusSlug: g.status?.slug || null,
      };
    });
  },

  // Padrão cartório: sepultados com óbito no período + dados civis/certidão
  async cartorio(tenantId, { periodStart, periodEnd, cemeteryId }) {
    const where = { tenantId };
    const range = dateOnlyRange(periodStart, periodEnd);
    if (range) where.deathDate = range;

    const graveInclude = {
      model: Grave, as: 'currentGrave', attributes: ['code', 'cemeteryId'], paranoid: false,
      include: [{ model: Cemetery, as: 'cemetery', attributes: ['name'], paranoid: false }],
    };
    if (cemeteryId) {
      graveInclude.where = { cemeteryId };
      graveInclude.required = true;
    }

    const list = await Deceased.findAll({
      where, order: [['deathDate', 'ASC']], include: [graveInclude],
    });
    return list.map((d) => ({
      fullName: d.fullName,
      cpf: d.cpf,
      birthDate: d.birthDate,
      deathDate: d.deathDate,
      deathCertificateNumber: d.deathCertificateNumber,
      deathCertificateRegistry: d.deathCertificateRegistry,
      motherName: d.motherName,
      fatherName: d.fatherName,
      graveCode: d.currentGrave?.code || null,
      cemeteryName: d.currentGrave?.cemetery?.name || null,
    }));
  },

  // Padrão órgão municipal: sepultamentos com autorização e declarante
  async orgao_municipal(tenantId, params) {
    const burials = await findBurials(tenantId, params);
    return burials.map((b) => ({
      burialDate: b.burialDate,
      burialTime: b.burialTime,
      deceasedName: b.deceased?.fullName || null,
      deceasedCpf: b.deceased?.cpf || null,
      deathDate: b.deceased?.deathDate || null,
      deathCertificateNumber: b.deceased?.deathCertificateNumber || null,
      graveCode: b.grave?.code || null,
      cemeteryName: b.cemetery?.name || null,
      authorizationNumber: b.authorizationNumber,
      declarantName: b.declarant?.fullName || null,
      funeralHome: b.funeralHome,
      registeredBy: b.registeredBy?.name || null,
      status: b.status,
    }));
  },
};

module.exports = { exporters };
