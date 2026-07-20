'use strict';

/**
 * Worker BullMQ — processo SEPARADO do servidor HTTP.
 *
 *   Rodar:  npm run worker   (ou: node src/queues/worker.js)
 *
 * Sobe um Worker por fila registrada e delega cada job ao handler do registry,
 * que é o MESMO service da feature — nada de regra de negócio duplicada aqui.
 *
 * Só faz sentido com Redis + bullmq disponíveis. Sem eles, o app já processa
 * tudo de forma síncrona no request (fallback em src/queues/index.js), então
 * este processo encerra avisando que não é necessário.
 */

// Carrega variáveis de ambiente (REDIS_URL, credenciais de DB) como o app faz.
try {
  require('dotenv').config();
} catch {
  /* dotenv opcional — ambiente pode já ter as variáveis exportadas */
}

// Importa os services para POPULAR o registry de handlers no load do módulo.
// (Cada service chama registerHandler no topo — ver arquivos das features.)
require('../features/data-exports/data-exports.service');
require('../features/imports/imports.service');
const notifications = require('../features/notifications/notifications.service');

const queues = require('./index');

function start() {
  if (!queues.isEnabled()) {
    console.error(
      '[worker] Redis/bullmq indisponível — sem fila o app processa síncrono no request. ' +
        'Worker não é necessário. Encerrando.'
    );
    process.exit(0);
    return;
  }

  const names = queues.getQueueNames();
  if (names.length === 0) {
    console.error('[worker] Nenhuma fila com handler registrado. Encerrando.');
    process.exit(0);
    return;
  }

  const workers = names.map((name) => queues.startWorker(name)).filter(Boolean);
  console.log(`[worker] processando filas: ${names.join(', ')}`);

  // Liga as automações por tempo (repeatable jobs). Só têm efeito real com
  // Redis — sem ele os handlers já ficam registrados, mas não há cron.
  notifications
    .startSchedulers()
    .then((r) => console.log(`[worker] agendamentos ativos: ${r.scheduled.join(', ')}`))
    .catch((err) => console.error('[worker] falha ao iniciar agendamentos:', err.message));

  async function shutdown(signal) {
    console.log(`[worker] ${signal} recebido — encerrando workers...`);
    await Promise.all(workers.map((w) => w.close().catch(() => {})));
    process.exit(0);
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

start();
