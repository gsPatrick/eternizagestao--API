'use strict';

/**
 * WEBHOOK do Evolution API (WhatsApp) — POR INSTÂNCIA/CIDADE.
 * Montado ANTES dos routers autenticados (não tem auth: o Evolution não assina).
 * Validação: pelo instanceName conhecido (o service confere contra o tenant).
 *
 * POST /v1/webhooks/evolution/:instance
 *   - `connection.update` → atualiza o status do tenant (conectado/desconectado).
 *   - qualquer outro evento → ignorado com 200 (Evolution não reentrega).
 *
 * SEMPRE responde 200: um 4xx/5xx faria o Evolution reenfileirar o evento.
 */
const { Router } = require('express');
const service = require('./tenants.service');

const router = Router();

router.post('/:instance', async (req, res) => {
  try {
    const result = await service.handleEvolutionWebhook(req.params.instance, req.body || {});
    return res.status(200).json(result);
  } catch (err) {
    // Nunca propaga erro para o Evolution (evita tempestade de reentregas).
    console.error('[webhook:evolution] erro ao processar evento:', err.message);
    return res.status(200).json({ ok: true, ignored: true, reason: 'erro_interno' });
  }
});

module.exports = router;
