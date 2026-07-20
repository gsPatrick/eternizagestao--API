'use strict';

/**
 * Exportação de arquivos padronizados (cartório, órgão municipal, gestão).
 * O request cria o registro DataExport com status `processando` e ENFILEIRA a
 * geração (fila BullMQ). A geração real acontece no handler `generateExport`
 * — via worker quando há Redis, ou síncrona no próprio request quando não há
 * (fallback). O registro rastreia o ciclo processando → concluido|erro.
 */
const AppError = require('../../utils/app-error');
const { getPagination, buildPageMeta } = require('../../utils/pagination');
const { toCsv } = require('../../utils/to-csv');
const storage = require('../../providers/storage');
const { brandingVars } = require('../../utils/tenant-branding');
const { exporters } = require('./data-exports.exporters');
const { DataExport, User, Cemetery, Tenant } = require('../../models');
const { enqueue, registerHandler } = require('../../queues');
const audit = require('../audit-logs/audit.service');

const QUEUE = 'data-exports';
const JOB = 'generate';

// Formatos com geração real hoje. O enum do model também aceita pdf/xlsx/xml,
// mas a geração desses fica para um provider futuro (render/planilha) — até lá
// respondemos 400 UNSUPPORTED_FORMAT.
const SUPPORTED_FORMATS = {
  csv: 'text/csv',
  json: 'application/json',
};

/**
 * Handler da geração — trabalho pesado tirado do request. Recebe { tenantId,
 * exportId }, recarrega o registro e gera/persiste o arquivo, atualizando o
 * status. A REGRA de exportação é a mesma de antes; só mudou onde ela roda.
 * Rodado pelo worker (com Redis) ou síncrono no request (fallback).
 */
// Bloco de identificação do órgão gestor no topo da remessa (cartório/órgão
// municipal saem com cabeçalho institucional). No CSV vira linhas de comentário
// no topo; no JSON, um bloco `_identificacao` antes de `dados`.
function identificationLines(brand, dataExport) {
  const periodo = dataExport.periodStart || dataExport.periodEnd
    ? `${dataExport.periodStart || '...'} a ${dataExport.periodEnd || '...'}`
    : 'período completo';
  return [
    ['orgao_gestor', brand.orgao_nome],
    ['cnpj', brand.orgao_cnpj],
    ['cidade', brand.orgao_cidade],
    ['contato', [brand.orgao_telefone, brand.orgao_email].filter(Boolean).join(' · ')],
    ['tipo_remessa', dataExport.exportType],
    ['periodo', periodo],
    ['protocolo', dataExport.id],
    ['gerado_em', new Date().toISOString()],
  ].filter(([, v]) => v !== null && v !== undefined && v !== '');
}

function buildExportContent(format, rows, brand, dataExport) {
  const idLines = identificationLines(brand, dataExport);
  if (format === 'json') {
    const _identificacao = Object.fromEntries(idLines);
    return JSON.stringify({ _identificacao, dados: rows }, null, 2);
  }
  // CSV: cabeçalho de identificação (linhas "# chave: valor") + linha em branco.
  const header = idLines.map(([k, v]) => `# ${k}: ${String(v).replace(/[\r\n]+/g, ' ')}`);
  return [...header, '', toCsv(rows)].join('\n');
}

async function generateExport({ tenantId, exportId }) {
  const dataExport = await DataExport.findOne({ where: { id: exportId, tenantId } });
  if (!dataExport) return;

  const { exportType, format, periodStart, periodEnd, cemeteryId } = dataExport;
  try {
    const rows = await exporters[exportType](tenantId, { periodStart, periodEnd, cemeteryId });
    const tenant = await Tenant.findByPk(tenantId);
    const brand = brandingVars(tenant);
    const content = buildExportContent(format, rows, brand, dataExport);

    // Nome do arquivo inclui o subdomínio da cidade quando disponível.
    const prefix = brand.subdomain ? `${brand.subdomain}-` : '';
    const saved = await storage.saveFile({
      tenantId,
      fileName: `${prefix}${exportType}-${Date.now()}.${format}`,
      content: Buffer.from(content, 'utf8'),
      mimeType: SUPPORTED_FORMATS[format],
    });

    await dataExport.update({
      status: 'concluido',
      fileUrl: saved.fileUrl,
      generatedAt: new Date(),
    });
  } catch (err) {
    // Falha na geração não derruba o job — o registro carrega o erro.
    await dataExport
      .update({ status: 'erro', errorMessage: err.message })
      .catch(() => {});
  }
}
registerHandler(QUEUE, JOB, generateExport);

async function create(tenantId, data, userId) {
  const { exportType, format = 'csv', periodStart, periodEnd, cemeteryId, parameters } = data;

  if (!exporters[exportType]) {
    throw AppError.badRequest(
      `exportType inválido. Suportados: ${Object.keys(exporters).join(', ')}`,
      'INVALID_EXPORT_TYPE'
    );
  }
  if (!SUPPORTED_FORMATS[format]) {
    throw AppError.badRequest('Disponível: csv, json', 'UNSUPPORTED_FORMAT');
  }

  const dataExport = await DataExport.create({
    tenantId,
    cemeteryId: cemeteryId || null,
    exportType,
    format,
    periodStart: periodStart || null,
    periodEnd: periodEnd || null,
    parameters: parameters || null,
    status: 'processando',
    requestedByUserId: userId,
  }, { skipAudit: true }); // hook global logaria 'criacao' — logamos o semântico abaixo

  // Evento semântico registrado no momento da SOLICITAÇÃO (ação do usuário),
  // independente da geração ser síncrona ou assíncrona (fila).
  audit.record({
    action: 'exportacao',
    entityType: 'Exportação',
    entityId: dataExport.id,
    description: `Exportação de ${exportType} (${format})`,
  });

  // Enfileira a geração (retorna rápido com Redis). Sem Redis, roda síncrono
  // aqui mesmo — e então recarregamos para devolver o status final (como antes).
  const { enqueued } = await enqueue(
    QUEUE,
    JOB,
    { tenantId, exportId: dataExport.id },
    generateExport
  );
  if (!enqueued) await dataExport.reload();

  return dataExport;
}

async function list(tenantId, query) {
  const { page, perPage, limit, offset } = getPagination(query, { defaultPerPage: 20 });
  const where = { tenantId };
  if (query.exportType) where.exportType = query.exportType;
  if (query.status) where.status = query.status;

  const { rows, count } = await DataExport.findAndCountAll({
    where, limit, offset,
    order: [['createdAt', 'DESC']],
    include: [{ model: User, as: 'requestedBy', attributes: ['id', 'name'] }],
  });
  return { rows, meta: buildPageMeta(count, page, perPage) };
}

async function getById(tenantId, id) {
  const dataExport = await DataExport.findOne({
    where: { id, tenantId },
    include: [
      { model: User, as: 'requestedBy', attributes: ['id', 'name'] },
      { model: Cemetery, as: 'cemetery', attributes: ['id', 'name'] },
    ],
  });
  if (!dataExport) throw AppError.notFound('Exportação não encontrada.');
  return dataExport;
}

// Serializa uma exportação para a resposta HTTP trocando o fileUrl cru pela URL
// ASSINADA (o download recebe a URL pronta, sem depender de storage aberto).
function toResponse(dataExport) {
  if (!dataExport) return dataExport;
  const json = typeof dataExport.toJSON === 'function' ? dataExport.toJSON() : { ...dataExport };
  if (json.fileUrl) json.fileUrl = storage.signedUrl(json.fileUrl);
  return json;
}

module.exports = { create, list, getById, toResponse };
