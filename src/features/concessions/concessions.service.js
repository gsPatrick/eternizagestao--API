'use strict';

const { Op } = require('sequelize');
const AppError = require('../../utils/app-error');
const { getPagination, buildPageMeta } = require('../../utils/pagination');
const graveEvents = require('../grave-timeline/grave-event.recorder');
const graveStatuses = require('../grave-statuses/grave-statuses.service');
const {
  sequelize, Concession, ConcessionTransfer, Grave, GraveStatus, Lot, Street, Block,
  Person, MaintenanceFee, FeeType,
} = require('../../models');

const CREATE_FIELDS = [
  'personId', 'responsiblePersonId', 'concessionType', 'contractNumber', 'startDate', 'endDate', 'value', 'notes',
];

const today = () => new Date().toISOString().slice(0, 10);

// Data-limite (hoje + N meses) em ISO date — janela de "a vencer".
function inMonths(months) {
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

async function issue(tenantId, graveId, data, userId) {
  return sequelize.transaction(async (transaction) => {
    const grave = await Grave.findOne({ where: { id: graveId, tenantId }, transaction });
    if (!grave) throw AppError.notFound('Sepultura não encontrada.');

    const active = await Concession.findOne({
      where: { tenantId, graveId, status: 'ativa' }, transaction,
    });
    if (active) {
      throw AppError.conflict('Sepultura já possui concessão ativa.', 'ACTIVE_CONCESSION_EXISTS');
    }

    const person = await Person.findOne({ where: { id: data.personId, tenantId }, transaction });
    if (!person) throw AppError.notFound('Pessoa não encontrada.');

    // responsável legal (opcional) — se informado, precisa existir no tenant
    if (data.responsiblePersonId) {
      const responsible = await Person.findOne({
        where: { id: data.responsiblePersonId, tenantId }, transaction,
      });
      if (!responsible) throw AppError.notFound('Responsável não encontrado.');
    }

    const concession = await Concession.create(
      {
        ...data,
        tenantId,
        graveId,
        startDate: data.startDate || today(),
        status: 'ativa',
        acquisitionMethod: 'emissao',
      },
      { transaction }
    );

    // Concessão perpétua consolida o jazigo no status "em perpetuidade"
    if (concession.concessionType === 'perpetua') {
      const status = await graveStatuses.resolve(tenantId, { slug: 'em_perpetuidade' });
      await grave.update({ statusId: status.id }, { transaction });
    }

    await graveEvents.record(
      {
        tenantId, graveId, eventType: 'concessao',
        title: `Concessão emitida para ${person.fullName}`,
        referenceType: 'concession', referenceId: concession.id,
        metadata: { concessionType: concession.concessionType, personId: person.id },
        userId,
      },
      { transaction }
    );
    return concession;
  });
}

async function listByGrave(tenantId, graveId) {
  const grave = await Grave.findOne({ where: { id: graveId, tenantId } });
  if (!grave) throw AppError.notFound('Sepultura não encontrada.');
  return Concession.findAll({
    where: { tenantId, graveId },
    include: [
      { model: Person, as: 'person' },
      { model: Person, as: 'responsible' },
    ],
    order: [['startDate', 'DESC']],
  });
}

async function list(tenantId, query) {
  const { page, perPage, limit, offset } = getPagination(query, { defaultPerPage: 30 });
  const where = { tenantId };
  if (query.personId) where.personId = query.personId;
  if (query.type) where.concessionType = query.type;

  // status: valor direto OU o pseudo-status 'a_vencer' (temporárias ativas cujo
  // vencimento cai nos próximos 12 meses).
  if (query.status === 'a_vencer') {
    where.status = 'ativa';
    where.concessionType = 'temporaria';
    where.endDate = { [Op.gte]: today(), [Op.lte]: inMonths(12) };
  } else if (query.status) {
    where.status = query.status;
  }

  // busca por concessionário (nome/CPF), número do contrato ou código do jazigo
  if (query.search) {
    const like = `%${query.search}%`;
    where[Op.or] = [
      { contractNumber: { [Op.iLike]: like } },
      { '$person.full_name$': { [Op.iLike]: like } },
      { '$person.cpf$': { [Op.iLike]: like } },
      { '$grave.code$': { [Op.iLike]: like } },
    ];
  }

  const { rows, count } = await Concession.findAndCountAll({
    where, limit, offset,
    order: [['startDate', 'DESC']],
    include: [
      { model: Person, as: 'person' },
      { model: Person, as: 'responsible' },
      { model: Grave, as: 'grave', attributes: ['id', 'code'] },
    ],
    subQuery: false,
    distinct: true,
  });
  return { rows, meta: buildPageMeta(count, page, perPage) };
}

// Contadores para os cartões/estatísticas e chips de situação da listagem.
async function summary(tenantId) {
  const [active, perpetual, expiring, expired, statusRows] = await Promise.all([
    Concession.count({ where: { tenantId, status: 'ativa' } }),
    Concession.count({ where: { tenantId, status: 'ativa', concessionType: 'perpetua' } }),
    Concession.count({
      where: {
        tenantId, status: 'ativa', concessionType: 'temporaria',
        endDate: { [Op.gte]: today(), [Op.lte]: inMonths(12) },
      },
    }),
    Concession.count({ where: { tenantId, status: 'vencida' } }),
    Concession.findAll({
      where: { tenantId },
      attributes: ['status', [sequelize.fn('COUNT', sequelize.col('id')), 'total']],
      group: ['status'],
      raw: true,
    }),
  ]);

  // Contagem por situação (chips) + total geral de contratos do tenant.
  const byStatus = { ativa: 0, vencida: 0, transferida: 0, encerrada: 0, cancelada: 0 };
  let total = 0;
  statusRows.forEach((row) => {
    const n = Number(row.total);
    byStatus[row.status] = n;
    total += n;
  });

  return { active, perpetual, expiring, expired, total, byStatus };
}

async function getById(tenantId, id, { transaction } = {}) {
  const concession = await Concession.findOne({
    where: { id, tenantId },
    include: [
      { model: Person, as: 'person' },
      { model: Person, as: 'responsible' },
      {
        model: Grave, as: 'grave',
        include: [
          { model: GraveStatus, as: 'status' },
          {
            model: Lot, as: 'lot',
            include: [{ model: Street, as: 'street', include: [{ model: Block, as: 'block' }] }],
          },
        ],
      },
      {
        model: MaintenanceFee, as: 'maintenanceFees',
        // atributos enxutos p/ o card de "Taxa vinculada" (evita depender de
        // colunas fora do escopo desta feature, como o histórico de reajustes)
        attributes: ['id', 'concessionId', 'amount', 'periodicity', 'nextDueDate', 'status'],
        required: false,
        include: [{ model: FeeType, as: 'feeType', attributes: ['id', 'name', 'periodicity'] }],
      },
    ],
    transaction,
  });
  if (!concession) throw AppError.notFound('Concessão não encontrada.');
  return concession;
}

// Detalhe + histórico de transferências do jazigo (proprietários anteriores).
async function getDetail(tenantId, id) {
  const concession = await getById(tenantId, id);
  const transfers = await ConcessionTransfer.findAll({
    where: { tenantId, graveId: concession.graveId },
    include: [
      { model: Person, as: 'fromPerson', attributes: ['id', 'fullName', 'cpf'] },
      { model: Person, as: 'toPerson', attributes: ['id', 'fullName', 'cpf'] },
    ],
    order: [['transferDate', 'DESC']],
  });
  return { ...concession.toJSON(), transfers };
}

// Renovação: estende a vigência de uma concessão temporária ativa.
async function renew(tenantId, id, data, userId) {
  return sequelize.transaction(async (transaction) => {
    const concession = await Concession.findOne({ where: { id, tenantId }, transaction });
    if (!concession) throw AppError.notFound('Concessão não encontrada.');
    if (concession.concessionType !== 'temporaria') {
      throw AppError.conflict('Apenas concessões temporárias são renováveis.', 'CONCESSION_NOT_RENEWABLE');
    }
    if (!['ativa', 'vencida'].includes(concession.status)) {
      throw AppError.conflict(`Concessão com status '${concession.status}' não pode ser renovada.`, 'CONCESSION_NOT_RENEWABLE');
    }
    if (!data.endDate) throw AppError.badRequest('Informe a nova data de vencimento (endDate).', 'MISSING_END_DATE');
    if (data.endDate <= (concession.endDate || today())) {
      throw AppError.badRequest('A nova vigência deve ser posterior à vigência atual.', 'INVALID_END_DATE');
    }

    await concession.update({ endDate: data.endDate, status: 'ativa' }, { transaction });

    await graveEvents.record(
      {
        tenantId, graveId: concession.graveId, eventType: 'concessao',
        title: `Concessão renovada — nova vigência até ${data.endDate}`,
        referenceType: 'concession', referenceId: concession.id,
        userId,
      },
      { transaction }
    );
    return concession;
  });
}

async function transfer(tenantId, id, data, userId) {
  return sequelize.transaction(async (transaction) => {
    const from = await Concession.findOne({ where: { id, tenantId }, transaction });
    if (!from) throw AppError.notFound('Concessão não encontrada.');
    if (from.status !== 'ativa') {
      throw AppError.conflict('Apenas concessões ativas podem ser transferidas.', 'CONCESSION_NOT_ACTIVE');
    }

    const toPerson = await Person.findOne({ where: { id: data.toPersonId, tenantId }, transaction });
    if (!toPerson) throw AppError.notFound('Pessoa destino não encontrada.');

    const transferDate = data.transferDate || today();
    await from.update({ status: 'transferida' }, { transaction });

    const to = await Concession.create(
      {
        tenantId,
        graveId: from.graveId,
        personId: toPerson.id,
        concessionType: data.concessionType || from.concessionType,
        startDate: transferDate,
        // sem override explícito, a nova concessão herda o vencimento da origem
        endDate: data.endDate !== undefined ? data.endDate : from.endDate,
        status: 'ativa',
        acquisitionMethod: data.transferReason === 'heranca' ? 'heranca' : 'transferencia',
        notes: data.notes || null,
      },
      { transaction }
    );

    const record = await ConcessionTransfer.create(
      {
        tenantId,
        graveId: from.graveId,
        fromConcessionId: from.id,
        toConcessionId: to.id,
        fromPersonId: from.personId,
        toPersonId: toPerson.id,
        transferReason: data.transferReason,
        familyRelationship: data.familyRelationship || null,
        transferDate,
        registeredByUserId: userId,
        notes: data.notes || null,
      },
      { transaction }
    );

    await graveEvents.record(
      {
        tenantId, graveId: from.graveId, eventType: 'transferencia_propriedade',
        title: `Transferência de propriedade para ${toPerson.fullName}`,
        description: data.notes || null,
        referenceType: 'concession_transfer', referenceId: record.id,
        metadata: { transferReason: data.transferReason, fromPersonId: from.personId, toPersonId: toPerson.id },
        userId,
      },
      { transaction }
    );
    return { concession: to, transfer: record };
  });
}

async function terminate(tenantId, id, userId) {
  return sequelize.transaction(async (transaction) => {
    const concession = await Concession.findOne({ where: { id, tenantId }, transaction });
    if (!concession) throw AppError.notFound('Concessão não encontrada.');
    // encerrar só faz sentido para concessões ainda vigentes (ativa/vencida)
    if (!['ativa', 'vencida'].includes(concession.status)) {
      throw AppError.conflict(`Concessão com status '${concession.status}' não pode ser encerrada.`, 'CONCESSION_NOT_TERMINABLE');
    }
    await concession.update({ status: 'encerrada' }, { transaction });

    await graveEvents.record(
      {
        tenantId, graveId: concession.graveId, eventType: 'concessao',
        title: 'Concessão encerrada',
        referenceType: 'concession', referenceId: concession.id,
        userId,
      },
      { transaction }
    );
    return concession;
  });
}

module.exports = {
  issue, listByGrave, list, summary, getById, getDetail,
  transfer, renew, terminate, CREATE_FIELDS,
};
