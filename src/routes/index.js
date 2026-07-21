'use strict';

// ÚNICO agregador de rotas da API. Nenhum endpoint "solto" fora das features,
// exceto health/ping (probes de orquestração).
const { Router } = require('express');
const { contextMiddleware } = require('../middlewares/request-context');

const router = Router();

/* -------------------------------------------------------------------------
 * CONTEXTO POR-REQUEST (AsyncLocalStorage) — SEMPRE PRIMEIRO.
 * Abre um store isolado para o request; assim auth → tenant-resolver →
 * controllers → services → hooks globais do Sequelize compartilham o ATOR da
 * ação (ver src/middlewares/request-context.js). O motor de auditoria depende
 * deste escopo estar aberto antes de qualquer processamento.
 * ------------------------------------------------------------------------- */
router.use(contextMiddleware);

const startedAt = new Date();

router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'eterniza-gestao-api',
    uptimeSeconds: Math.floor(process.uptime()),
    startedAt: startedAt.toISOString(),
  });
});

router.get('/v1/ping', (req, res) => {
  res.json({ pong: true, timestamp: new Date().toISOString() });
});

/* -------------------------------------------------------------------------
 * ROTAS SEM AUTH ADMINISTRATIVA — SEMPRE ANTES dos routers autenticados.
 * Routers montados em '/v1' aplicam router.use(auth) a tudo que passa por
 * eles; webhooks/público/portal precisam ser resolvidos antes.
 * ------------------------------------------------------------------------- */
router.use('/v1/webhooks/payment-gateway', require('../features/payments/payments.webhook.routes'));
router.use('/v1/webhooks/asaas', require('../features/payments/payments.asaas-webhook.routes'));
router.use('/v1/webhooks/signature', require('../features/document-signatures/signatures.webhook.routes'));
router.use('/v1/webhooks/evolution', require('../features/tenants/evolution-webhook.routes'));
router.use('/v1/public', require('../features/public-tenants/public-tenants.routes'));
router.use('/v1/public', require('../features/public-search/public-search.routes'));
router.use('/v1/public', require('../features/public-map/public-map.routes'));
router.use('/v1/portal', require('../features/family-portal/family-portal.routes'));
// Recuperação de senha (painel e portal): quem esqueceu a senha não tem sessão.
router.use('/v1/password-resets', require('../features/password-resets/password-resets.routes'));

/* -------------------------------------------------------------------------
 * Fase 0 — Fundação
 * ------------------------------------------------------------------------- */
router.use('/v1/sessions', require('../features/sessions/sessions.routes'));
router.use('/v1/tenants', require('../features/tenants/tenants.routes'));
router.use('/v1/tenant', require('../features/tenants/onboarding.routes'));
router.use('/v1/tenant', require('../features/tenants/integrations.routes'));
router.use('/v1/users', require('../features/users/users.routes'));

/* -------------------------------------------------------------------------
 * Fase 1 — Estrutura física e cadastros-base
 * ------------------------------------------------------------------------- */
router.use('/v1/cemeteries', require('../features/cemeteries/cemeteries.routes'));
router.use('/v1', require('../features/cemetery-structure/cemetery-structure.routes'));
router.use('/v1/grave-statuses', require('../features/grave-statuses/grave-statuses.routes'));
// Cadastros de referência "Básico" (por cidade): cartórios, funerárias, instituições
router.use('/v1/cartorios', require('../features/cartorios/cartorios.routes'));
router.use('/v1/funerarias', require('../features/funerarias/funerarias.routes'));
router.use('/v1/institutions', require('../features/institutions/institutions.routes'));
router.use('/v1/graves', require('../features/graves/graves.routes'));
router.use('/v1/people', require('../features/people/people.routes'));
router.use('/v1', require('../features/map/map.routes'));

/* -------------------------------------------------------------------------
 * Fase 2 — Operação do cemitério
 * ------------------------------------------------------------------------- */
router.use('/v1', require('../features/concessions/concessions.routes'));
router.use('/v1/deceased', require('../features/deceased/deceased.routes'));
router.use('/v1', require('../features/burials/burials.routes'));
router.use('/v1', require('../features/exhumations/exhumations.routes'));
router.use('/v1', require('../features/ossuaries/ossuaries.routes'));
router.use('/v1', require('../features/grave-maintenances/grave-maintenances.routes'));
router.use('/v1', require('../features/grave-timeline/grave-timeline.routes'));
router.use('/v1/attachments', require('../features/attachments/attachments.routes'));

/* -------------------------------------------------------------------------
 * Fase 3 — Financeiro
 * ------------------------------------------------------------------------- */
router.use('/v1/fee-types', require('../features/fee-types/fee-types.routes'));
router.use('/v1/maintenance-fees', require('../features/maintenance-fees/maintenance-fees.routes'));
router.use('/v1/billings', require('../features/billings/billings.routes'));
router.use('/v1', require('../features/payments/payments.routes'));
router.use('/v1/delinquency', require('../features/delinquency/delinquency.routes'));

/* -------------------------------------------------------------------------
 * Fase 4 — Agenda e documentos oficiais
 * ------------------------------------------------------------------------- */
router.use('/v1', require('../features/chapels/chapels.routes'));
router.use('/v1', require('../features/schedules/schedules.routes'));
router.use('/v1/document-templates', require('../features/document-templates/document-templates.routes'));
router.use('/v1/documents', require('../features/documents/documents.routes'));
router.use('/v1', require('../features/document-signatures/document-signatures.routes'));

/* -------------------------------------------------------------------------
 * Fase 5 — Comunicação (portais públicos/portal da família montados no topo)
 * ------------------------------------------------------------------------- */
router.use('/v1/notifications', require('../features/notifications/notifications.routes'));

/* -------------------------------------------------------------------------
 * Fase 6 — Gestão, dados e integrações
 * ------------------------------------------------------------------------- */
router.use('/v1/dashboard', require('../features/dashboard/dashboard.routes'));
router.use('/v1/reports', require('../features/reports/reports.routes'));
router.use('/v1/imports', require('../features/imports/imports.routes'));
router.use('/v1/data-exports', require('../features/data-exports/data-exports.routes'));
router.use('/v1/audit-logs', require('../features/audit-logs/audit-logs.routes'));

module.exports = router;
