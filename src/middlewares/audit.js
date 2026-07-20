'use strict';

/**
 * REDE DE SEGURANÇA da auditoria.
 *
 * O motor principal são os hooks globais do Sequelize (CRUD com before/after)
 * + os services que registram ações SEMÂNTICAS via audit.service.record().
 * Ambos marcam a request como auditada (getActor().__audited = true).
 *
 * Este middleware roda no 'finish' da resposta e SÓ grava um registro grosso
 * (método + rota) quando:
 *   - a resposta teve sucesso (status < 400),
 *   - o método é mutante (não GET/OPTIONS/HEAD),
 *   - e NINGUÉM auditou a request (!getActor().__audited).
 *
 * Assim nada escapa, sem duplicar quando os hooks/semânticos já registraram.
 * Nunca bloqueia o request nem derruba a API.
 */
const { record } = require('../features/audit-logs/audit.service');
const { getActor } = require('./request-context');

module.exports = (req, res, next) => {
  if (req.method === 'GET' || req.method === 'OPTIONS' || req.method === 'HEAD') {
    return next();
  }

  res.on('finish', () => {
    if (res.statusCode >= 400) return; // só mutações que deram certo
    if (getActor().__audited) return; // já auditado por hook/semântica → não duplica

    // caminho sem ids para agrupar ações iguais: /v1/graves/:id → entity 'graves'
    const parts = req.originalUrl.split('?')[0].split('/').filter(Boolean);
    const entityType = parts.find((p, i) => i > 0 && !/^v\d+$/.test(p) && p !== 'api') || 'unknown';

    record({
      action: `${req.method} ${req.originalUrl.split('?')[0]}`,
      entityType,
      entityId: null,
      // overrides explícitos: o finish pode rodar sem os campos do ALS populados
      tenantId: req.tenant?.id || getActor().tenantId || null,
      userId: req.user?.id || getActor().userId || null,
      portalAccountId: req.portalAccount?.id || getActor().portalAccountId || null,
      ipAddress: req.ip,
      userAgent: (req.headers['user-agent'] || '').slice(0, 255),
    });
  });

  return next();
};
