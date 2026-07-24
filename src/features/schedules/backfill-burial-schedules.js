'use strict';

/**
 * BACKFILL dos eventos de agenda a partir dos SEPULTAMENTOS já cadastrados.
 *
 * A criação automática do evento (cadastrar sepultado → aparece na agenda)
 * passou a existir agora; os sepultamentos anteriores não têm evento. Este
 * backfill cria os que faltam, para a agenda — interna e pública — refletir
 * tudo que já está no sistema, sem o operador reabrir cada registro.
 *
 * Só considera sepultamentos ATIVOS com data no FUTURO: a agenda pública mostra
 * o que está por vir, e criar evento passado para milhares de sepultamentos
 * antigos só poluiria o histórico sem utilidade. Idempotente — reaproveita o
 * mesmo ensureBurialSchedule do fluxo normal, que não duplica.
 *
 * Roda no boot (app.js), best-effort, e é desligável com
 * BURIAL_AGENDA_BACKFILL=false.
 */

const { Op } = require('sequelize');
const { Burial } = require('../../models');
const { ensureBurialSchedule } = require('../burials/burials.service');
const { todayISO } = require('../../utils/date-local');

const BATCH = Number(process.env.BURIAL_AGENDA_BACKFILL_BATCH || 500);

async function backfillBurialSchedules() {
  // Sepultamentos ativos cuja data é hoje ou no futuro (a agenda é do que vem).
  const hoje = todayISO();
  const burials = await Burial.findAll({
    where: {
      status: 'ativo',
      burialDate: { [Op.gte]: hoje },
    },
    order: [['burialDate', 'ASC']],
    limit: BATCH,
  });
  if (!burials.length) return { candidatos: 0, criados: 0, falhas: 0 };

  let criados = 0;
  let falhas = 0;
  for (const burial of burials) {
    try {
      // ensureBurialSchedule cria OU atualiza; nas próximas execuções encontra
      // o evento e só confirma, então o custo é baixo e não há duplicação.
      // eslint-disable-next-line no-await-in-loop
      const ev = await ensureBurialSchedule(burial.tenantId, burial, null);
      if (ev) criados += 1;
    } catch (err) {
      falhas += 1;
      console.error(`[backfill-agenda] sepultamento ${burial.id}: ${err.message}`);
    }
  }
  return { candidatos: burials.length, criados, falhas };
}

module.exports = { backfillBurialSchedules };
