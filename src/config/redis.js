'use strict';

/**
 * Cliente Redis singleton (ioredis) compartilhado por rate-limit e filas (BullMQ).
 *
 * Filosofia: Redis é OPCIONAL. Sem REDIS_URL, ou sem a dep ioredis instalada,
 * getRedis() retorna null e os consumidores degradam com elegância
 * (ex.: rate-limit cai para o algoritmo em memória). NUNCA derruba o app.
 */

let client; // singleton: undefined = ainda não tentou; null = indisponível
let warned = false;

function getRedis() {
  // já resolvido (cliente ou null definitivo)
  if (client !== undefined) return client;

  if (!process.env.REDIS_URL) {
    client = null;
    return client;
  }

  let Redis;
  try {
    Redis = require('ioredis');
  } catch {
    // dep opcional ausente — segue sem Redis
    client = null;
    return client;
  }

  try {
    client = new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 2,
      enableOfflineQueue: false,
      lazyConnect: false,
    });
    // Nunca deixar um erro de conexão virar exceção não tratada que derruba o app.
    client.on('error', (err) => {
      if (!warned) {
        warned = true;
        console.error('[redis] indisponível, degradando para fallback:', err.message);
      }
    });
  } catch (err) {
    console.error('[redis] falha ao inicializar cliente:', err.message);
    client = null;
  }

  return client;
}

module.exports = { getRedis };
