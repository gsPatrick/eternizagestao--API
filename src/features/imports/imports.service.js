'use strict';

/**
 * Migração de legado: lote (ImportBatch) → validação linha a linha
 * (ImportRecord) → efetivação. A efetivação usa UMA TRANSAÇÃO POR RECORD:
 * um registro problemático é marcado como inválido e o lote SEGUE — nunca
 * aborta a importação inteira.
 */
const AppError = require('../../utils/app-error');
const { getPagination, buildPageMeta } = require('../../utils/pagination');
const {
  validators, normalizeCpf, normalizeScope, BILLING_STATUS_MAP,
} = require('./imports.validators');
const graveStatuses = require('../grave-statuses/grave-statuses.service');
const { computeTotal } = require('../billings/billings.helper');
const {
  sequelize, ImportBatch, ImportRecord, Person, Deceased, Burial, Grave, Lot, Cemetery, User,
  Concession, Billing, Payment,
} = require('../../models');
const { enqueue, registerHandler } = require('../../queues');
const { todayISO } = require('../../utils/date-local');

const SUPPORTED_SCOPES = Object.keys(validators); // proprietarios, sepultados, sepulturas

const QUEUE = 'imports';
const JOB = 'commit';

function pickDefined(row, fields) {
  const out = {};
  for (const f of fields) {
    if (row[f] !== undefined && row[f] !== null && row[f] !== '') out[f] = row[f];
  }
  return out;
}

async function getBatch(tenantId, id) {
  const batch = await ImportBatch.findOne({ where: { id, tenantId } });
  if (!batch) throw AppError.notFound('Lote de importação não encontrado.');
  return batch;
}

// ---- Criação do lote + linhas ----
async function createBatch(tenantId, { sourceName, fileName, entityScope: rawScope, rows }, userId) {
  // Alias de nomenclatura na entrada (ex.: `pessoas` → `proprietarios`) — o
  // valor canônico é o que fica persistido no lote.
  const entityScope = normalizeScope(rawScope);
  if (!SUPPORTED_SCOPES.includes(entityScope)) {
    throw AppError.badRequest(
      `entityScope inválido. Suportados: ${SUPPORTED_SCOPES.join(', ')}`,
      'INVALID_ENTITY_SCOPE'
    );
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    throw AppError.badRequest('rows deve ser um array não vazio.', 'EMPTY_ROWS');
  }

  return sequelize.transaction(async (transaction) => {
    const batch = await ImportBatch.create(
      {
        tenantId,
        sourceName: sourceName || null,
        fileName: fileName || null,
        entityScope,
        status: 'pendente',
        totalRecords: rows.length,
        createdByUserId: userId,
      },
      { transaction }
    );

    await ImportRecord.bulkCreate(
      rows.map((row, index) => ({
        tenantId,
        importBatchId: batch.id,
        rowNumber: index + 1,
        rawData: row,
        status: 'pendente',
      })),
      { transaction }
    );
    return batch;
  });
}

// Contexto pré-carregado para validação sem query por linha
async function buildValidationContext(tenantId, entityScope) {
  const ctx = {};
  if (entityScope === 'sepulturas') {
    const lots = await Lot.findAll({ where: { tenantId }, attributes: ['id'], raw: true });
    ctx.lotIds = new Set(lots.map((l) => String(l.id)));
  }
  // Concessões e cobranças resolvem FKs por CPF (Person) e código (Grave):
  // pré-carrega os sets do tenant para validar sem uma query por linha.
  if (entityScope === 'concessoes' || entityScope === 'cobrancas') {
    const [people, graves] = await Promise.all([
      Person.findAll({ where: { tenantId }, attributes: ['cpf'], raw: true }),
      Grave.findAll({ where: { tenantId }, attributes: ['code'], raw: true }),
    ]);
    ctx.personCpfs = new Set(people.map((p) => normalizeCpf(p.cpf)).filter(Boolean));
    ctx.graveCodes = new Set(graves.map((g) => String(g.code)));
  }
  return ctx;
}

// ---- Validação linha a linha ----
async function validateBatch(tenantId, id) {
  const batch = await getBatch(tenantId, id);
  if (!['pendente', 'erro'].includes(batch.status)) {
    throw AppError.conflict(
      `Lote com status '${batch.status}' não pode ser validado.`,
      'INVALID_BATCH_STATUS'
    );
  }

  const validateRow = validators[batch.entityScope];
  if (!validateRow) {
    throw AppError.badRequest('Escopo do lote não possui validador.', 'INVALID_ENTITY_SCOPE');
  }

  const ctx = await buildValidationContext(tenantId, batch.entityScope);
  const records = await ImportRecord.findAll({
    where: { tenantId, importBatchId: batch.id },
    order: [['rowNumber', 'ASC']],
  });

  let validCount = 0;
  let invalidCount = 0;
  const errorSummary = [];

  for (const record of records) {
    const { valid, errors } = validateRow(record.rawData || {}, ctx);
    if (valid) {
      validCount += 1;
      await record.update({ status: 'valido', validationErrors: null });
    } else {
      invalidCount += 1;
      await record.update({ status: 'invalido', validationErrors: errors });
      if (errorSummary.length < 20) {
        errorSummary.push(`Linha ${record.rowNumber}: ${errors.join('; ')}`);
      }
    }
  }

  return batch.update({
    status: 'validado',
    validRecords: validCount,
    invalidRecords: invalidCount,
    errorSummary,
  });
}

/* -------------------------------------------------------------------------
 * Efetivação por escopo — cada função cria a entidade dentro da transação
 * do record e retorna { entityType, entityId }.
 * ------------------------------------------------------------------------- */

const PERSON_FIELDS = [
  'fullName', 'rg', 'birthDate', 'gender', 'email', 'phonePrimary', 'phoneSecondary',
  'whatsapp', 'addressStreet', 'addressNumber', 'addressComplement', 'addressDistrict',
  'addressCity', 'addressState', 'addressZipcode', 'notes',
];

const DECEASED_FIELDS = [
  'fullName', 'rg', 'birthDate', 'deathDate', 'deathTime', 'gender', 'motherName',
  'fatherName', 'birthplace', 'causeOfDeath', 'deathCertificateNumber',
  'deathCertificateRegistry', 'notes',
];

async function importProprietario(tenantId, row, userId, transaction) {
  const data = pickDefined(row, PERSON_FIELDS);
  const cpf = normalizeCpf(row.cpf);
  const person = await Person.create(
    { tenantId, ...data, cpf: cpf || null },
    { transaction }
  );
  return { entityType: 'Person', entityId: person.id };
}

async function importSepultado(tenantId, row, userId, transaction) {
  const data = pickDefined(row, DECEASED_FIELDS);
  const cpf = normalizeCpf(row.cpf);
  const deceased = await Deceased.create(
    { tenantId, ...data, cpf: cpf || null },
    { transaction }
  );

  // Vínculo opcional com a sepultura atual (por código) + burial de legado
  if (row.graveCode) {
    const grave = await Grave.findOne({ where: { tenantId, code: row.graveCode }, transaction });
    if (!grave) throw new Error(`Sepultura de código '${row.graveCode}' não encontrada`);

    await deceased.update({ currentGraveId: grave.id }, { transaction });
    await Burial.create(
      {
        tenantId,
        cemeteryId: grave.cemeteryId,
        graveId: grave.id,
        deceasedId: deceased.id,
        burialDate: row.burialDate || row.deathDate || todayISO(),
        status: 'ativo',
        registeredByUserId: userId,
        notes: 'Importação de legado',
      },
      { transaction }
    );
  }
  return { entityType: 'Deceased', entityId: deceased.id };
}

async function importSepultura(tenantId, row, userId, transaction) {
  const lot = await Lot.findOne({ where: { id: row.lotId, tenantId }, transaction });
  if (!lot) throw new Error(`Lote '${row.lotId}' não encontrado no tenant`);

  const status = await graveStatuses.resolve(tenantId, { slug: row.status || 'livre' });

  const grave = await Grave.create(
    {
      tenantId,
      cemeteryId: lot.cemeteryId,
      lotId: lot.id,
      code: row.code,
      unitType: row.unitType || 'cova',
      statusId: status.id,
      ...pickDefined(row, ['capacity', 'latitude', 'longitude', 'areaM2', 'notes']),
    },
    { transaction }
  );
  return { entityType: 'Grave', entityId: grave.id };
}

async function importConcessao(tenantId, row, userId, transaction) {
  const cpf = normalizeCpf(row.cpf);
  const person = await Person.findOne({ where: { tenantId, cpf }, transaction });
  if (!person) throw new Error(`Concessionário com CPF '${row.cpf}' não encontrado`);

  const grave = await Grave.findOne({ where: { tenantId, code: row.graveCode }, transaction });
  if (!grave) throw new Error(`Sepultura de código '${row.graveCode}' não encontrada`);

  const concession = await Concession.create(
    {
      tenantId,
      graveId: grave.id,
      personId: person.id,
      concessionType: row.concessionType,
      contractNumber: row.contractNumber || null,
      startDate: row.startDate,
      endDate: row.endDate || null, // NULL para perpétua / contrato sem término
      value: row.value !== undefined && row.value !== null && row.value !== '' ? row.value : null,
      status: 'ativa',
      acquisitionMethod: 'regularizacao', // vínculo de legado regularizado na migração
      notes: row.notes || 'Importação de legado',
    },
    { transaction }
  );
  return { entityType: 'Concession', entityId: concession.id };
}

async function importCobranca(tenantId, row, userId, transaction) {
  const cpf = normalizeCpf(row.cpf);
  const payer = await Person.findOne({ where: { tenantId, cpf }, transaction });
  if (!payer) throw new Error(`Pagador com CPF '${row.cpf}' não encontrado`);

  // Sepultura é opcional na cobrança histórica.
  let grave = null;
  if (row.graveCode) {
    grave = await Grave.findOne({ where: { tenantId, code: row.graveCode }, transaction });
    if (!grave) throw new Error(`Sepultura de código '${row.graveCode}' não encontrada`);
  }

  const status = BILLING_STATUS_MAP[row.status] || 'pendente';
  const totalAmount = computeTotal({ amount: row.amount });

  // Dado histórico: sem numeração sequencial (code não existe na Billing) —
  // apenas inserimos o registro legado com o status informado.
  const billing = await Billing.create(
    {
      tenantId,
      cemeteryId: grave ? grave.cemeteryId : null,
      graveId: grave ? grave.id : null,
      payerPersonId: payer.id,
      origin: 'avulsa', // débito de legado sem vínculo com taxa de manutenção
      description: row.description || null,
      referencePeriod: row.referencePeriod || null,
      amount: row.amount,
      totalAmount,
      dueDate: row.dueDate,
      status,
      notes: 'Importação de legado',
    },
    { transaction }
  );

  // Cobrança paga com data de pagamento → cria a baixa (Payment) correspondente,
  // seguindo o padrão do projeto (método 'outro' p/ baixa manual de legado).
  if (status === 'pago' && row.paymentDate) {
    await Payment.create(
      {
        tenantId,
        billingId: billing.id,
        paidAt: row.paymentDate,
        amountPaid: totalAmount,
        method: 'outro',
        isAutomatic: false,
        registeredByUserId: userId,
        notes: 'Importação de legado',
      },
      { transaction }
    );
  }
  return { entityType: 'Billing', entityId: billing.id };
}

const importers = {
  proprietarios: importProprietario,
  sepultados: importSepultado,
  sepulturas: importSepultura,
  concessoes: importConcessao,
  cobrancas: importCobranca,
};

/**
 * Handler da efetivação — o trabalho pesado (N transações, uma por record)
 * tirado do request. Recarrega o lote e processa registro a registro,
 * atualizando contadores/status. Preserva a resiliência: registro ruim vira
 * inválido e o lote SEGUE. Rodado pelo worker (com Redis) ou síncrono no
 * request (fallback). Regra idêntica à de antes — só mudou onde ela roda.
 */
async function processCommit({ tenantId, batchId, userId }) {
  const batch = await ImportBatch.findOne({ where: { id: batchId, tenantId } });
  if (!batch) return;

  const importer = importers[batch.entityScope];
  if (!importer) {
    await batch
      .update({ status: 'erro', errorSummary: ['Escopo do lote não possui efetivador.'] })
      .catch(() => {});
    return;
  }

  const records = await ImportRecord.findAll({
    where: { tenantId, importBatchId: batch.id, status: 'valido' },
    order: [['rowNumber', 'ASC']],
  });

  let imported = 0;
  let failed = 0;

  for (const record of records) {
    try {
      await sequelize.transaction(async (transaction) => {
        const { entityType, entityId } = await importer(
          tenantId, record.rawData || {}, userId, transaction
        );
        await record.update(
          { status: 'importado', createdEntityType: entityType, createdEntityId: entityId },
          { transaction }
        );
      });
      imported += 1;
    } catch (err) {
      failed += 1;
      await record
        .update({ status: 'invalido', validationErrors: [err.message] })
        .catch(() => {});
    }
  }

  await batch.update({
    status: 'importado',
    importedRecords: imported,
    validRecords: batch.validRecords - failed,
    invalidRecords: batch.invalidRecords + failed,
    finishedAt: new Date(),
  });
}
registerHandler(QUEUE, JOB, processCommit);

// ---- Efetivação: transação individual por record — erro não aborta o lote ----
async function commitBatch(tenantId, id, userId) {
  const batch = await getBatch(tenantId, id);
  if (batch.status !== 'validado') {
    throw AppError.conflict(
      `Lote com status '${batch.status}' não pode ser efetivado — valide antes.`,
      'INVALID_BATCH_STATUS'
    );
  }

  const importer = importers[batch.entityScope];
  if (!importer) {
    throw AppError.badRequest('Escopo do lote não possui efetivador.', 'INVALID_ENTITY_SCOPE');
  }

  // Lote entra em `processando` e a efetivação é enfileirada (retorna rápido com
  // Redis). Sem Redis, roda síncrono aqui mesmo — então recarregamos para
  // devolver o status/contadores finais, idêntico ao comportamento anterior.
  await batch.update({ status: 'processando', startedAt: batch.startedAt || new Date() });

  const { enqueued } = await enqueue(
    QUEUE,
    JOB,
    { tenantId, batchId: batch.id, userId },
    processCommit
  );
  if (!enqueued) await batch.reload();

  return batch;
}

// ---- Consultas ----
async function list(tenantId, query) {
  const { page, perPage, limit, offset } = getPagination(query, { defaultPerPage: 20 });
  const where = { tenantId };
  if (query.status) where.status = query.status;
  if (query.entityScope) where.entityScope = query.entityScope;

  const { rows, count } = await ImportBatch.findAndCountAll({
    where, limit, offset,
    order: [['createdAt', 'DESC']],
    include: [{ model: User, as: 'createdBy', attributes: ['id', 'name'] }],
  });
  return { rows, meta: buildPageMeta(count, page, perPage) };
}

async function getById(tenantId, id) {
  const batch = await ImportBatch.findOne({
    where: { id, tenantId },
    include: [
      { model: User, as: 'createdBy', attributes: ['id', 'name'] },
      { model: Cemetery, as: 'cemetery', attributes: ['id', 'name'] },
    ],
  });
  if (!batch) throw AppError.notFound('Lote de importação não encontrado.');

  // contagem de records por status (visão de acompanhamento)
  const counts = await ImportRecord.findAll({
    where: { tenantId, importBatchId: batch.id },
    attributes: ['status', [sequelize.fn('COUNT', sequelize.col('id')), 'count']],
    group: ['status'],
    raw: true,
  });
  const recordCounts = {};
  for (const c of counts) recordCounts[c.status] = parseInt(c.count, 10);

  return { ...batch.toJSON(), recordCounts };
}

async function listRecords(tenantId, batchId, query) {
  await getBatch(tenantId, batchId);
  const { page, perPage, limit, offset } = getPagination(query, { defaultPerPage: 50 });
  const where = { tenantId, importBatchId: batchId };
  if (query.status) where.status = query.status;

  const { rows, count } = await ImportRecord.findAndCountAll({
    where, limit, offset, order: [['rowNumber', 'ASC']],
  });
  return { rows, meta: buildPageMeta(count, page, perPage) };
}

async function cancel(tenantId, id) {
  const batch = await getBatch(tenantId, id);
  if (batch.status === 'importado') {
    throw AppError.conflict('Lote já importado não pode ser cancelado.', 'BATCH_ALREADY_IMPORTED');
  }
  return batch.update({ status: 'cancelado', finishedAt: new Date() });
}

module.exports = {
  createBatch, validateBatch, commitBatch, list, getById, listRecords, cancel, SUPPORTED_SCOPES,
};
