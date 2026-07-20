'use strict';

const AppError = require('../../utils/app-error');
const catchAsync = require('../../utils/catch-async');
const { ok } = require('../../utils/http-response');
const { getTenantId } = require('../../utils/request-helpers');
const { toCsv } = require('../../utils/to-csv');
const { brandingVars } = require('../../utils/tenant-branding');
const { toXlsx, toPdf } = require('./reports.formats');
const service = require('./reports.service');

// Rótulos pt-BR dos relatórios para o título do PDF/planilha.
const REPORT_TITLES = {
  occupancy: 'Ocupação por quadra',
  burials: 'Sepultamentos no período',
  exhumations: 'Exumações no período',
  revenue: 'Receita no período',
  delinquency: 'Inadimplência',
  concessions: 'Concessões',
  schedules: 'Agenda',
  billingsSummary: 'Cobranças emitidas × pagas',
  expiringConcessions: 'Concessões a vencer',
  deceasedByLocation: 'Sepultados por localização',
  transfers: 'Transferências de titularidade',
};

// Mimetype dos formatos binários (buffer) gerados nativamente em reports.formats.
const BINARY_MIME = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
};
const SUPPORTED = ['json', 'csv', 'xlsx', 'pdf'];

// Handler genérico: todo relatório aceita ?from=&to=&cemeteryId=&format=json|csv|xlsx|pdf
const report = (reportName) => catchAsync(async (req, res) => {
  const { from, to, cemeteryId, scheduleType } = req.query;
  const format = String(req.query.format || 'json').toLowerCase();
  if (!SUPPORTED.includes(format)) {
    throw AppError.badRequest(
      `Formato inválido. Disponível: ${SUPPORTED.join(', ')}`,
      'UNSUPPORTED_FORMAT'
    );
  }

  const { rows, meta } = await service[reportName](getTenantId(req), {
    from, to, cemeteryId, scheduleType,
  });

  if (format === 'csv') {
    return res.type('text/csv').send(toCsv(rows));
  }
  if (format === 'xlsx' || format === 'pdf') {
    // Marca do órgão gestor no topo do PDF (nome/cidade + período).
    const brand = brandingVars(req.tenant);
    const title = REPORT_TITLES[reportName] || reportName;
    const org = [brand.orgao_nome, brand.orgao_cidade].filter(Boolean).join(' · ');
    const period = (from || to)
      ? `Período: ${from || '...'} a ${to || '...'}`
      : 'Período completo';
    // Nome do arquivo inclui o subdomínio da cidade quando disponível.
    const filePrefix = brand.subdomain ? `${brand.subdomain}-` : '';

    // Geração nativa (sem libs) → Buffer binário; res.send(Buffer) já ajusta
    // Content-Length e não reserializa. Content-Disposition força o download.
    const buffer = format === 'xlsx'
      ? toXlsx(rows, { sheetName: reportName })
      : toPdf(rows, { title, subtitle: period, org });
    return res
      .type(BINARY_MIME[format])
      .set('Content-Disposition', `attachment; filename="${filePrefix}${reportName}.${format}"`)
      .send(buffer);
  }
  return ok(res, rows, meta);
});

module.exports = {
  occupancy: report('occupancy'),
  burials: report('burials'),
  exhumations: report('exhumations'),
  revenue: report('revenue'),
  delinquency: report('delinquency'),
  concessions: report('concessions'),
  schedules: report('schedules'),
  billingsSummary: report('billingsSummary'),
  expiringConcessions: report('expiringConcessions'),
  deceasedByLocation: report('deceasedByLocation'),
  transfers: report('transfers'),
};
