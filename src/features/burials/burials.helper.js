'use strict';

const AppError = require('../../utils/app-error');
const { Burial, Deceased, Grave, GraveStatus } = require('../../models');

// Capacidade padrão quando o cadastro não informa: jazigo/túmulo de família
// recebe vários sepultamentos (3–4 gavetas internas); cova e gaveta, um.
const DEFAULT_CAPACITY_BY_TYPE = { jazigo: 4, tumulo: 4, outro: 1, cova: 1, gaveta: 1 };

function defaultCapacityFor(unitType) {
  return DEFAULT_CAPACITY_BY_TYPE[unitType] || 1;
}

/**
 * Sepultamentos ATIVOS que realmente ocupam o jazigo. Ignora os de sepultados
 * EXCLUÍDOS: antes da correção da exclusão, apagar um sepultado deixava o
 * sepultamento "ativo" para trás — e esse fantasma seguia contando lotação,
 * fazendo o jazigo recusar sepultamentos ("sem capacidade") sem ninguém dentro.
 */
function countActiveBurials({ tenantId, graveId, transaction }) {
  return Burial.count({
    where: { tenantId, graveId, status: 'ativo' },
    include: [{ model: Deceased, as: 'deceased', attributes: [], required: true }],
    transaction,
  });
}

/**
 * Capacidade EFETIVA do jazigo. Um bloco/jazigo com gavetas cadastradas cabe,
 * no mínimo, uma por gaveta — mesmo que o campo `capacity` tenha ficado no
 * padrão 1 (o painel nunca enviava capacidade, então TODO jazigo nascia com 1
 * e recusava o 2º sepultamento: o "sem capacidade" que voltava para o cliente).
 */
async function effectiveCapacity({ grave, tenantId, transaction }) {
  const base = Number(grave.capacity) || defaultCapacityFor(grave.unitType);
  if (grave.unitType === 'gaveta' || grave.parentGraveId) return base;
  const drawers = await Grave.count({ where: { tenantId, parentGraveId: grave.id }, transaction });
  return Math.max(base, drawers);
}
const graveStatuses = require('../grave-statuses/grave-statuses.service');

/**
 * Validações compartilhadas de "este jazigo pode receber um sepultamento?".
 * Usado tanto pelo sepultamento direto (burials.create) quanto pelo translado de
 * exumação para outro jazigo (exhumations.perform). Checa, na ordem:
 *   1. bloqueio do jazigo (isBlocked)
 *   2. status que permite sepultamento (status.allowsBurial)
 *   3. lotação/capacidade (nº de sepultamentos ativos < capacity)
 * Lança AppError 422 na primeira violação.
 *
 * IMPORTANTE: NÃO exige concessão ativa. Muitas sepulturas não têm o responsável
 * localizado (posse é opcional no cadastro), então sepultar não pode depender de
 * concessão. O param `skipConcession` é mantido só por compatibilidade de chamada.
 *
 * @param {object} params
 * @param {object} params.grave        instância de Grave já com `status` (GraveStatus) incluído
 * @param {string} params.tenantId
 * @param {object} [params.transaction] transação Sequelize em curso
 * @returns {Promise<{ activeBurials: number }>} contagem de sepultamentos ativos (antes deste)
 */
async function assertGraveAcceptsBurial({ grave, tenantId, transaction } = {}) {
  if (!grave) throw AppError.notFound('Sepultura não encontrada.');

  if (grave.isBlocked) {
    throw new AppError(`Sepultura bloqueada: ${grave.blockedReason || 'sem motivo informado'}.`, 422, 'GRAVE_BLOCKED');
  }
  // "ocupada" NÃO é um bloqueio real de sepultamento: é o rótulo automático de
  // "lotado". Quem decide se ainda cabe alguém é a CAPACIDADE (jazigo com gavetas
  // permite vários), logo abaixo. Tratar "ocupada" como proibição fazia um jazigo
  // com gaveta livre — ou um jazigo que ficou "ocupada" preso após uma exclusão —
  // recusar todo sepultamento novo (o erro que o cliente via voltar). Os demais
  // status sem allowsBurial (interditada, em_manutencao, aguardando_regularizacao)
  // continuam sendo bloqueio de verdade.
  if (!grave.status?.allowsBurial && grave.status?.slug !== 'ocupada') {
    throw new AppError(`Status '${grave.status?.name}' não permite sepultamento.`, 422, 'STATUS_FORBIDS_BURIAL');
  }

  const activeBurials = await countActiveBurials({ tenantId, graveId: grave.id, transaction });
  const capacity = await effectiveCapacity({ grave, tenantId, transaction });
  if (activeBurials >= capacity) {
    throw new AppError(
      `Sepultura sem capacidade disponível (${activeBurials} de ${capacity} ocupada(s)). `
      + 'Se o jazigo comporta mais sepultamentos, ajuste a capacidade no cadastro da sepultura.',
      422,
      'GRAVE_FULL'
    );
  }

  return { activeBurials, capacity };
}

/**
 * Recalcula o status de ocupação do jazigo a partir dos sepultamentos ATIVOS.
 *
 * Chamado sempre que um sepultamento é criado OU encerrado (sepultar, exumar,
 * transladar, EXCLUIR o sepultado). Antes, a exclusão de um sepultado encerrava
 * o sepultamento mas deixava o jazigo preso em "ocupada" — e o próximo
 * sepultamento era recusado. Agora a ocupação sempre reflete a realidade:
 *   - ativos >= capacidade → "ocupada"
 *   - ativos  < capacidade → "livre"
 *
 * Só mexe na dupla automática livre↔ocupada. Status decididos manualmente
 * (interditada, em_manutencao, em_perpetuidade, reservada) são preservados —
 * não é papel da ocupação sobrescrever uma interdição.
 *
 * @param {object} params
 * @param {object} [params.grave]  instância de Grave (com `status`) já carregada
 * @param {string} [params.graveId] alternativa: id do jazigo a carregar
 * @param {string} params.tenantId
 * @param {object} [params.transaction]
 * @param {string[]} [params.reclaimFrom] status manuais que TAMBÉM devem ser
 *   recalculados (ex.: 'em_perpetuidade' ao encerrar a concessão que o pôs assim).
 */
async function syncGraveOccupancy({ grave, graveId, tenantId, transaction, reclaimFrom = [] } = {}) {
  const g = grave || (graveId
    ? await Grave.findOne({
      where: { id: graveId, tenantId },
      include: [{ model: GraveStatus, as: 'status' }],
      transaction,
    })
    : null);
  if (!g) return;

  const currentSlug = g.status?.slug;
  const AUTO = new Set(['livre', 'ocupada', ...reclaimFrom]);
  if (currentSlug && !AUTO.has(currentSlug)) return; // status manual: não mexe

  const capacity = await effectiveCapacity({ grave: g, tenantId, transaction });
  const active = await countActiveBurials({ tenantId, graveId: g.id, transaction });

  const alvo = active >= capacity ? 'ocupada' : 'livre';
  if (currentSlug === alvo) return; // já está certo

  const status = await graveStatuses.resolve(tenantId, { slug: alvo });
  await g.update({ statusId: status.id }, { transaction });
}

module.exports = {
  assertGraveAcceptsBurial,
  syncGraveOccupancy,
  effectiveCapacity,
  countActiveBurials,
  defaultCapacityFor,
};
