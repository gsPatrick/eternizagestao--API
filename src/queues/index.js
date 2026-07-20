'use strict';

/**
 * Camada de filas — abstração `enqueue()` com FALLBACK síncrono.
 *
 * Objetivo: tirar trabalho pesado do request (geração de exportações,
 * efetivação de importações) para escalar. Redis/BullMQ são OPCIONAIS:
 * sem eles, o handler roda síncrono ali mesmo e o comportamento fica
 * idêntico ao de hoje — nada exige infra extra para o app funcionar.
 *
 * ---------------------------------------------------------------------------
 * Interface pública
 * ---------------------------------------------------------------------------
 *   enqueue(queueName, jobName, payload, handler) -> Promise<{ enqueued }>
 *     - Registra `handler` no registry por (queueName, jobName).
 *     - Com Redis + bullmq: enfileira o job na Queue BullMQ e retorna rápido
 *       ({ enqueued: true }). O processamento acontece no worker separado.
 *     - Sem Redis/bullmq (ou falha ao enfileirar): executa `await handler(payload)`
 *       de forma síncrona aqui mesmo ({ enqueued: false }).
 *
 *   registerHandler(queueName, jobName, handler)
 *     - Registra um handler SEM enfileirar. Os services chamam isto no load do
 *       módulo para que o worker (processo separado) resolva o handler ao
 *       consumir o job. O handler é SEMPRE o próprio service — nunca duplica regra.
 *
 *   getHandler(queueName, jobName) -> handler | undefined
 *   getQueueNames() -> string[]        (nomes de fila com handler registrado)
 *   getQueue(queueName) -> Queue|null  (cria/reusa Queue BullMQ; null sem Redis)
 *   startWorker(queueName, opts) -> Worker|null  (usado pelo worker.js)
 *   isEnabled() -> boolean             (true só com bullmq + Redis disponíveis)
 * ---------------------------------------------------------------------------
 */

// Contrato defensivo: config/redis pode não existir ainda em outro ambiente.
let getRedis;
try {
  ({ getRedis } = require('../config/redis'));
} catch {
  /* config de redis ausente — degrada para fallback síncrono */
}

// bullmq é dep opcional; pode não estar instalada.
let bullmq;
try {
  bullmq = require('bullmq');
} catch {
  /* dep opcional ausente — degrada para fallback síncrono */
}

// registry: { [queueName]: { [jobName]: handler } }
const handlers = {};
// cache de Queue BullMQ por nome
const queues = {};
// conexão ioredis dedicada ao BullMQ (resolvida uma vez)
let bullConnection;

function registerHandler(queueName, jobName, handler) {
  if (typeof handler !== 'function') return;
  if (!handlers[queueName]) handlers[queueName] = {};
  handlers[queueName][jobName] = handler;
}

function getHandler(queueName, jobName) {
  return handlers[queueName] && handlers[queueName][jobName];
}

function getQueueNames() {
  return Object.keys(handlers);
}

function redisClient() {
  if (typeof getRedis !== 'function') return null;
  try {
    return getRedis();
  } catch {
    return null;
  }
}

// A fila só está "ligada" com bullmq instalado E um cliente Redis disponível.
function isEnabled() {
  return Boolean(bullmq && redisClient());
}

/**
 * Conexão ioredis dedicada ao BullMQ. Não reusa o singleton de config/redis:
 * aquele usa maxRetriesPerRequest finito (bom p/ rate-limit), mas o BullMQ
 * exige `maxRetriesPerRequest: null` para os comandos bloqueantes. Criamos uma
 * conexão própria a partir da mesma REDIS_URL.
 */
function bullmqConnection() {
  if (bullConnection !== undefined) return bullConnection;
  if (!bullmq || !redisClient()) {
    bullConnection = null;
    return bullConnection;
  }
  let IORedis;
  try {
    IORedis = require('ioredis');
  } catch {
    bullConnection = null;
    return bullConnection;
  }
  try {
    bullConnection = new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: null });
    bullConnection.on('error', () => {
      /* silencioso: enqueue cai para o fallback síncrono se a conexão falhar */
    });
  } catch {
    bullConnection = null;
  }
  return bullConnection;
}

function getQueue(queueName) {
  if (!isEnabled()) return null;
  if (queues[queueName]) return queues[queueName];
  const connection = bullmqConnection();
  if (!connection) return null;
  const queue = new bullmq.Queue(queueName, { connection });
  queue.on('error', () => {
    /* silencioso: erros de conexão não derrubam o app */
  });
  queues[queueName] = queue;
  return queue;
}

const DEFAULT_JOB_OPTS = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 2000 },
  removeOnComplete: 1000,
  removeOnFail: 5000,
};

async function enqueue(queueName, jobName, payload, handler) {
  if (handler) registerHandler(queueName, jobName, handler);

  const queue = getQueue(queueName);
  if (queue) {
    try {
      await queue.add(jobName, payload, DEFAULT_JOB_OPTS);
      return { enqueued: true };
    } catch (err) {
      // Falha ao enfileirar (Redis caiu, etc.) não pode derrubar o request:
      // degrada para execução síncrona logo abaixo.
      console.error(
        `[queues] falha ao enfileirar ${queueName}/${jobName}, executando síncrono:`,
        err.message
      );
    }
  }

  // Fallback síncrono — comportamento idêntico ao de antes das filas.
  const fn = handler || getHandler(queueName, jobName);
  if (typeof fn !== 'function') {
    throw new Error(`Nenhum handler registrado para ${queueName}/${jobName}`);
  }
  await fn(payload);
  return { enqueued: false };
}

/**
 * Agenda um job REPETÍVEL (cron) via BullMQ `repeat`.
 *
 *   scheduleRepeatable(queueName, jobName, cronPattern, handler)
 *     - Registra `handler` no registry (igual a registerHandler) — SEMPRE.
 *     - Com Redis + bullmq: adiciona um repeatable job à Queue com um jobId
 *       estável (`repeat:<jobName>`), de modo idempotente — chamar de novo não
 *       duplica o agendamento. O disparo real acontece no worker.
 *     - Sem Redis/bullmq: NÃO há cron (nada de setInterval no processo web);
 *       apenas o handler fica registrado. Documentado: o agendamento por tempo
 *       só roda com Redis + worker ativo. Retorna { scheduled:false }.
 */
async function scheduleRepeatable(queueName, jobName, cronPattern, handler) {
  if (handler) registerHandler(queueName, jobName, handler);

  const queue = getQueue(queueName);
  if (!queue) return { scheduled: false };

  try {
    await queue.add(
      jobName,
      {},
      {
        repeat: { pattern: cronPattern },
        jobId: `repeat:${jobName}`,
        removeOnComplete: 100,
        removeOnFail: 100,
      }
    );
    return { scheduled: true };
  } catch (err) {
    console.error(
      `[queues] falha ao agendar ${queueName}/${jobName} (${cronPattern}):`,
      err.message
    );
    return { scheduled: false };
  }
}

/**
 * Sobe um Worker BullMQ para `queueName`. Chamado pelo worker.js (processo
 * separado). O processor resolve o handler pelo registry e o executa —
 * o handler É o service da feature. Retorna null se não houver Redis/bullmq.
 */
function startWorker(queueName, opts = {}) {
  if (!isEnabled()) return null;
  const connection = bullmqConnection();
  if (!connection) return null;

  const worker = new bullmq.Worker(
    queueName,
    async (job) => {
      const fn = getHandler(queueName, job.name);
      if (typeof fn !== 'function') {
        throw new Error(`Nenhum handler registrado para ${queueName}/${job.name}`);
      }
      return fn(job.data);
    },
    { connection, concurrency: opts.concurrency || 5 }
  );

  worker.on('failed', (job, err) => {
    console.error(`[worker] ${queueName}/${job && job.name} falhou:`, err && err.message);
  });

  return worker;
}

module.exports = {
  enqueue,
  scheduleRepeatable,
  registerHandler,
  getHandler,
  getQueueNames,
  getQueue,
  startWorker,
  isEnabled,
};
