'use strict';

const AppError = require('../../utils/app-error');
const { Burial, Grave, GraveStatus } = require('../../models');
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

  const activeBurials = await Burial.count({
    where: { tenantId, graveId: grave.id, status: 'ativo' }, transaction,
  });
  if (activeBurials >= grave.capacity) {
    throw new AppError('Sepultura sem capacidade disponível.', 422, 'GRAVE_FULL');
  }

  return { activeBurials };
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

  const capacity = g.capacity || 1;
  const active = await Burial.count({
    where: { tenantId, graveId: g.id, status: 'ativo' }, transaction,
  });

  const alvo = active >= capacity ? 'ocupada' : 'livre';
  if (currentSlug === alvo) return; // já está certo

  const status = await graveStatuses.resolve(tenantId, { slug: alvo });
  await g.update({ statusId: status.id }, { transaction });
}

module.exports = { assertGraveAcceptsBurial, syncGraveOccupancy };
