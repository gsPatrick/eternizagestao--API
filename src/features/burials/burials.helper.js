'use strict';

const AppError = require('../../utils/app-error');
const { Burial } = require('../../models');

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
  if (!grave.status?.allowsBurial) {
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

module.exports = { assertGraveAcceptsBurial };
