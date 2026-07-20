'use strict';

const catchAsync = require('../../utils/catch-async');
const { ok, created } = require('../../utils/http-response');
const { requireFields, requireOneOf, pick } = require('../../utils/validation');
const { getTenantId, getUserId } = require('../../utils/request-helpers');
const service = require('./documents.service');

const list = catchAsync(async (req, res) => {
  const { rows, meta } = await service.list(getTenantId(req), req.query);
  // fileUrl → URL assinada (o visualizador recebe a URL pronta).
  return ok(res, rows.map(service.toResponse), meta);
});

const getById = catchAsync(async (req, res) => {
  return ok(res, service.toResponse(await service.getById(getTenantId(req), req.params.id)));
});

// Baixa o PDF oficial — gera/cacheia se ainda não existir. Responde
// application/pdf (nunca 500 por falta de Chromium: cai no fallback).
const downloadPdf = catchAsync(async (req, res) => {
  const { buffer, document } = await service.getOrCreatePdf(getTenantId(req), req.params.id);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${document.documentType}-${document.formattedNumber.replace('/', '-')}.pdf"`);
  return res.send(buffer);
});

const issue = catchAsync(async (req, res) => {
  requireFields(req.body, ['documentType']);
  requireOneOf(req.body.documentType, service.DOCUMENT_TYPES, 'documentType');
  const body = pick(req.body, [
    'documentType', 'data', 'templateId', 'referenceType', 'referenceId',
    'graveId', 'deceasedId', 'personId', 'graveCode', 'notes',
  ]);
  return created(res, service.toResponse(await service.issueFromRequest(getTenantId(req), body, getUserId(req))));
});

const reissue = catchAsync(async (req, res) => {
  return created(res, service.toResponse(await service.reissue(getTenantId(req), req.params.id, getUserId(req))));
});

const cancel = catchAsync(async (req, res) => {
  return ok(res, await service.cancel(getTenantId(req), req.params.id, req.body.reason));
});

// Texto legal por cidade (certidão/autorização) — usado nos modelos oficiais.
const getSettings = catchAsync(async (req, res) => {
  return ok(res, await service.getSettings(getTenantId(req)));
});

const updateSettings = catchAsync(async (req, res) => {
  const body = pick(req.body, ['legalCertidao', 'legalAutorizacao']);
  return ok(res, await service.updateSettings(getTenantId(req), body));
});

module.exports = { list, getById, downloadPdf, issue, reissue, cancel, getSettings, updateSettings };
