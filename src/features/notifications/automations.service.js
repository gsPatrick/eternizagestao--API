'use strict';

/**
 * ESTADO REAL das automações de notificação.
 *
 * Esta feature NÃO cria automação nenhuma: ela apenas RELATA o que de fato
 * existe no código e na infraestrutura. Nada aqui é ilustrativo.
 *
 * O que existe hoje (ver notifications.service.js):
 *   - scan-vencidos     (cron NOTIF_CRON_VENCIDOS, default '0 9 * * *')
 *   - scan-vencimentos  (cron NOTIF_CRON_VENCIMENTOS, default '30 9 * * *')
 *
 * Como os agendamentos funcionam de verdade:
 *   - São jobs REPETÍVEIS do BullMQ, agendados por `startSchedulers()`.
 *   - `startSchedulers()` só é chamado pelo processo `npm run worker`.
 *   - Sem Redis (REDIS_URL ausente / ioredis ou bullmq não instalados) não há
 *     fila: o worker encerra na hora e NENHUM aviso automático é disparado.
 *     Este é o caso real de muitas instalações — e o cliente precisa saber.
 *
 * Sobre "última execução": só é reportada quando o BullMQ tem o registro
 * (jobs concluídos ficam retidos por `removeOnComplete`). Se não houver
 * registro confiável, o campo é OMITIDO — nunca fabricado.
 */

const { getQueue, isEnabled } = require('../../queues');
const { QUEUE } = require('./notifications.service');

// Chaves dos jobs — iguais às constantes usadas no notifications.service.
const JOB_SCAN_VENCIDOS = 'scan-vencidos';
const JOB_SCAN_VENCIMENTOS = 'scan-vencimentos';

// Antecedência padrão do scan de vencimentos (payload.days || 5 no service).
const VENCIMENTO_DIAS = 5;

/**
 * Catálogo estático — descreve, em linguagem de operador, o que cada job faz.
 * O cron vem do ambiente exatamente como o service o lê (mesmos defaults).
 */
function catalog() {
  return [
    {
      key: JOB_SCAN_VENCIDOS,
      name: 'Aviso de cobrança vencida',
      description:
        'Varre todas as cobranças já vencidas e envia um aviso ao pagador que ainda ' +
        'não foi notificado no dia. Respeita o silêncio e a janela de horário da cidade.',
      cron: process.env.NOTIF_CRON_VENCIDOS || '0 9 * * *',
      channels: ['whatsapp', 'email'],
      notificationType: 'cobranca_vencida',
    },
    {
      key: JOB_SCAN_VENCIMENTOS,
      name: 'Lembrete de taxa a vencer',
      description:
        `Varre as taxas de manutenção ativas que vencem nos próximos ${VENCIMENTO_DIAS} dias ` +
        'e avisa o pagador com antecedência. Respeita o silêncio e a janela de horário da cidade.',
      cron: process.env.NOTIF_CRON_VENCIMENTOS || '30 9 * * *',
      channels: ['whatsapp', 'email'],
      notificationType: 'vencimento_taxa',
      daysBefore: VENCIMENTO_DIAS,
    },
  ];
}

/**
 * Motivo pelo qual o agendador está desligado. Diagnóstico honesto: distingue
 * "falta a variável REDIS_URL" de "a dependência não está instalada".
 */
function disabledReason() {
  if (!process.env.REDIS_URL) return 'REDIS_URL não configurada';
  try {
    require('bullmq');
  } catch {
    return 'dependência bullmq não instalada';
  }
  try {
    require('ioredis');
  } catch {
    return 'dependência ioredis não instalada';
  }
  return 'não foi possível conectar ao Redis';
}

/**
 * Agendamentos repetíveis registrados no BullMQ, indexados por nome do job.
 * Retorna Map<jobName, { pattern, next }>. Vazio se a fila não responder.
 */
async function repeatablesByName(queue) {
  const out = new Map();
  if (!queue) return out;

  let rows = [];
  try {
    // bullmq >= 5.x: getJobSchedulers é a API atual; getRepeatableJobs é o legado.
    if (typeof queue.getJobSchedulers === 'function') {
      rows = await queue.getJobSchedulers();
    } else if (typeof queue.getRepeatableJobs === 'function') {
      rows = await queue.getRepeatableJobs();
    }
  } catch {
    return out; // Redis fora do ar no meio do request — não derruba a tela.
  }

  for (const r of rows || []) {
    if (!r || !r.name) continue;
    out.set(r.name, {
      cron: r.pattern || null,
      // `next` é o timestamp do próximo disparo calculado pelo próprio BullMQ.
      nextRunAt: r.next ? new Date(Number(r.next)).toISOString() : null,
    });
  }
  return out;
}

/**
 * Última execução REAL de cada job, lida dos jobs concluídos/falhos retidos
 * pelo BullMQ (removeOnComplete/removeOnFail). Map<jobName, {...}>.
 * Sem registro retido, o job simplesmente não aparece no Map — e o campo some
 * da resposta, em vez de virar uma data inventada.
 */
async function lastRunsByName(queue) {
  const out = new Map();
  if (!queue) return out;

  let jobs = [];
  try {
    jobs = await queue.getJobs(['completed', 'failed'], 0, 200, false);
  } catch {
    return out;
  }

  for (const job of jobs || []) {
    if (!job || !job.name || !job.finishedOn) continue;
    const prev = out.get(job.name);
    if (prev && prev.finishedOn >= job.finishedOn) continue;
    const result = job.returnvalue && typeof job.returnvalue === 'object' ? job.returnvalue : null;
    out.set(job.name, {
      finishedOn: job.finishedOn,
      lastRunAt: new Date(job.finishedOn).toISOString(),
      lastRunStatus: job.failedReason ? 'falha' : 'sucesso',
      // Resultado do scan: quantos registros foram varridos e quantos geraram aviso.
      lastRunScanned: result && typeof result.scanned === 'number' ? result.scanned : null,
      lastRunNotified: result && typeof result.notified === 'number' ? result.notified : null,
      lastRunError: job.failedReason || null,
    });
  }
  return out;
}

/**
 * Retrato das automações. Não recebe tenantId: os jobs são globais (varrem
 * todas as cidades) e o estado do agendador é da instalação, não do tenant.
 *
 * Shape:
 *   {
 *     scheduler: {
 *       enabled, reason, queue, worker, requires:[...],
 *       howToEnable   // instrução em linguagem de operador quando desligado
 *     },
 *     automations: [{
 *       key, name, description, cron, channels, notificationType, daysBefore?,
 *       scheduled,         // o cron está REGISTRADO na fila agora?
 *       nextRunAt?,        // ISO — só quando o BullMQ informa
 *       lastRunAt?, lastRunStatus?, lastRunScanned?, lastRunNotified?, lastRunError?
 *     }]
 *   }
 */
async function getState() {
  const enabled = isEnabled();
  const queue = enabled ? getQueue(QUEUE) : null;

  const [repeatables, lastRuns] = await Promise.all([
    repeatablesByName(queue),
    lastRunsByName(queue),
  ]);

  const automations = catalog().map((item) => {
    const rep = repeatables.get(item.key);
    const last = lastRuns.get(item.key);

    const row = {
      ...item,
      // Cron REGISTRADO na fila tem precedência sobre o do ambiente: é o que
      // de fato vai disparar. Sem fila, resta o do ambiente.
      cron: (rep && rep.cron) || item.cron,
      scheduled: Boolean(rep),
    };

    if (rep && rep.nextRunAt) row.nextRunAt = rep.nextRunAt;

    if (last) {
      row.lastRunAt = last.lastRunAt;
      row.lastRunStatus = last.lastRunStatus;
      if (last.lastRunScanned !== null) row.lastRunScanned = last.lastRunScanned;
      if (last.lastRunNotified !== null) row.lastRunNotified = last.lastRunNotified;
      if (last.lastRunError) row.lastRunError = last.lastRunError;
    }

    return row;
  });

  const scheduler = {
    enabled,
    queue: QUEUE,
    // Mesmo com Redis, o cron só é registrado pelo processo worker.
    worker: 'npm run worker',
    requires: ['REDIS_URL', 'serviço worker em execução'],
    reason: enabled ? null : disabledReason(),
  };

  if (!enabled) {
    scheduler.howToEnable =
      'Configure REDIS_URL e mantenha o serviço worker (npm run worker) em execução. ' +
      'Enquanto isso não for feito, nenhum aviso automático de vencimento ou ' +
      'inadimplência é disparado — só os envios manuais funcionam.';
  } else if (!automations.some((a) => a.scheduled)) {
    // Redis existe, mas ninguém registrou o cron: o worker nunca subiu.
    scheduler.howToEnable =
      'O Redis está disponível, mas nenhum agendamento está registrado na fila. ' +
      'Suba o serviço worker (npm run worker) para ativar as automações.';
  }

  return { scheduler, automations };
}

module.exports = { getState };
