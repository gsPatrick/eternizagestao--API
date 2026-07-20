'use strict';

const AppError = require('../utils/app-error');
const { getRedis } = require('../config/redis');

/**
 * Rate limit para rotas públicas e webhooks.
 *
 * Store distribuído (Redis) OPCIONAL: se REDIS_URL existir e o ioredis estiver
 * disponível, contamos por chave `keyPrefix:ip` com INCR + EXPIRE (compartilhado
 * entre TODAS as réplicas atrás do load balancer). Sem Redis — ou se ele cair —
 * degradamos para o algoritmo em memória (por instância). NUNCA derruba o app.
 *
 * Assinatura preservada: rateLimit({ windowMs, max, keyPrefix }) — outros
 * arquivos importam exatamente assim.
 */
function rateLimit({ windowMs = 60_000, max = 60, keyPrefix = 'rl' } = {}) {
  const hits = new Map();

  // limpeza periódica para não crescer indefinidamente (store em memória)
  setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [key, arr] of hits) {
      const recent = arr.filter((t) => t > cutoff);
      if (recent.length) hits.set(key, recent);
      else hits.delete(key);
    }
  }, windowMs).unref();

  const windowSec = Math.max(1, Math.ceil(windowMs / 1000));

  // Contagem em memória (fallback). Retorna o total na janela atual.
  function countInMemory(key) {
    const now = Date.now();
    const cutoff = now - windowMs;
    const recent = (hits.get(key) || []).filter((t) => t > cutoff);
    recent.push(now);
    hits.set(key, recent);
    return recent.length;
  }

  // Contagem distribuída via Redis: INCR + EXPIRE na primeira ocorrência.
  // Lança em qualquer falha para o chamador cair no fallback em memória.
  async function countInRedis(redis, key) {
    const count = await redis.incr(key);
    if (count === 1) {
      await redis.expire(key, windowSec);
    }
    return count;
  }

  return (req, res, next) => {
    const key = `${keyPrefix}:${req.ip}`;
    const redis = getRedis();

    const over = () =>
      next(
        new AppError('Muitas requisições. Tente novamente em instantes.', 429, 'RATE_LIMITED')
      );

    if (redis) {
      countInRedis(redis, key)
        .then((count) => {
          if (count > max) return over();
          return next();
        })
        .catch(() => {
          // Redis caiu/indisponível: degrada para memória sem derrubar o app.
          if (countInMemory(key) > max) return over();
          return next();
        });
      return;
    }

    if (countInMemory(key) > max) return over();
    return next();
  };
}

module.exports = rateLimit;
