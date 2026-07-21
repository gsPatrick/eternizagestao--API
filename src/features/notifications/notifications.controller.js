'use strict';

const AppError = require('../../utils/app-error');
const catchAsync = require('../../utils/catch-async');
const { ok, created } = require('../../utils/http-response');
const { requireFields } = require('../../utils/validation');
const { getTenantId } = require('../../utils/request-helpers');
const service = require('./notifications.service');
const automations = require('./automations.service');

const list = catchAsync(async (req, res) => {
  const { rows, meta } = await service.list(getTenantId(req), req.query);
  return ok(res, rows, meta);
});

// Estado REAL das automações (jobs agendados, cron, agendador ligado/desligado).
// Somente leitura: não existe endpoint para ligar/desligar nem editar template.
const listAutomations = catchAsync(async (req, res) => {
  return ok(res, await automations.getState());
});

const getById = catchAsync(async (req, res) => {
  return ok(res, await service.getById(getTenantId(req), req.params.id));
});

// Notificação AVULSA (manual) — admin/operador.
// body: { personId? | contact, channel, message, subject?, referenceType? }
const create = catchAsync(async (req, res) => {
  const { personId, contact, channel = 'whatsapp', message, subject, referenceType } = req.body;
  requireFields(req.body, ['message']);
  if (!personId && !contact) {
    throw AppError.badRequest('Informe personId ou contact.', 'MISSING_RECIPIENT');
  }
  const notification = await service.notify({
    tenantId: getTenantId(req),
    personId,
    contact,
    channel,
    notificationType: 'avulsa',
    subject,
    message,
    template: 'generic',
    vars: { titulo: subject || 'Mensagem', mensagem: message },
    referenceType,
  });
  return created(res, notification);
});

// Disparo em LOTE (bulk) — admin.
// body: { recipients:[{personId|contact, channel}], notificationType, message?/vars?, subject?, template? }
//       OU { segment:'inadimplentes', notificationType?, message?, subject?, vars? }
const bulk = catchAsync(async (req, res) => {
  const tenantId = getTenantId(req);
  const {
    recipients,
    segment,
    notificationType = 'avulsa',
    channel,
    message,
    subject,
    vars,
    template,
  } = req.body;

  if (segment) {
    const result = await service.notifySegment(tenantId, segment, {
      notificationType: req.body.notificationType, // opcional; segmento tem default
      channel,
      message,
      subject,
      vars,
      template,
    });
    return created(res, result);
  }

  if (!Array.isArray(recipients) || recipients.length === 0) {
    throw AppError.badRequest('Informe recipients[] ou segment.', 'MISSING_RECIPIENTS');
  }

  const inputs = recipients.map((r) => ({
    tenantId,
    personId: r.personId,
    contact: r.contact,
    channel: r.channel || channel || 'whatsapp',
    notificationType,
    subject,
    message,
    template: template || 'generic',
    vars: vars || { titulo: subject || 'Mensagem', mensagem: message },
  }));
  const result = await service.notifyMany(inputs);
  return created(res, result);
});

// Reenvio de uma notificação em falha — admin/operador.
const retry = catchAsync(async (req, res) => {
  return ok(res, await service.retry(getTenantId(req), req.params.id));
});

// Disparo manual de teste (admin) — valida configuração do provider/contato.
const test = catchAsync(async (req, res) => {
  requireFields(req.body, ['personId', 'message']);
  const notification = await service.notifyPerson({
    tenantId: getTenantId(req),
    personId: req.body.personId,
    notificationType: 'outro',
    message: req.body.message,
  });
  if (!notification) {
    throw AppError.badRequest(
      'Não foi possível gerar a notificação — verifique se a pessoa existe.',
      'NOTIFICATION_NOT_CREATED'
    );
  }
  return created(res, notification);
});

module.exports = { list, listAutomations, getById, create, bulk, retry, test };
