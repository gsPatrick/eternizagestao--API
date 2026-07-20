'use strict';

const AppError = require('../../utils/app-error');
const { Burial, Concession } = require('../../models');

/**
 * Validações compartilhadas de "este jazigo pode receber um sepultamento?".
 * Usado tanto pelo sepultamento direto (burials.create) quanto pelo translado de
 * exumação para outro jazigo (exhumations.perform). Checa, na ordem:
 *   1. bloqueio do jazigo (isBlocked)
 *   2. status que permite sepultamento (status.allowsBurial)
 *   3. lotação/capacidade (nº de sepultamentos ativos < capacity)
 *   4. concessão ativa (a menos que skipConcession)
 * Lança AppError 422 na primeira violação.
 *
 * @param {object} params
 * @param {object} params.grave        instância de Grave já com `status` (GraveStatus) incluído
 * @param {string} params.tenantId
 * @param {object} [params.transaction] transação Sequelize em curso
 * @param {boolean} [params.skipConcession=false] pula a exigência de concessão ativa
 * @returns {Promise<{ activeBurials: number }>} contagem de sepultamentos ativos (antes deste)
 */
async function assertGraveAcceptsBurial({ grave, tenantId, transaction, skipConcession = false } = {}) {
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

  if (!skipConcession) {
    const concession = await Concession.findOne({
      where: { tenantId, graveId: grave.id, status: 'ativa' }, transaction,
    });
    if (!concession) {
      throw new AppError('Sepultura sem concessão ativa.', 422, 'NO_ACTIVE_CONCESSION');
    }
  }

  return { activeBurials };
}

module.exports = { assertGraveAcceptsBurial };
