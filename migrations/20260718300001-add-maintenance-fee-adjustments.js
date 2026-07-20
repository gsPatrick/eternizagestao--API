'use strict';

/**
 * Histórico de reajustes por taxa de manutenção (tela de Taxas).
 *
 * Adiciona `maintenance_fees.adjustments` (JSONB, default '[]') — cada reajuste
 * (individual ou em lote) empilha { date, from, to, reason }. Alimenta o painel
 * "Histórico de reajustes" no detalhe da taxa e o reajuste em lote por tipo.
 *
 * Idempotente: só cria a coluna se ainda não existir.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('maintenance_fees');
    if (!table.adjustments) {
      await queryInterface.addColumn('maintenance_fees', 'adjustments', {
        type: Sequelize.JSONB,
        allowNull: false,
        defaultValue: [],
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('maintenance_fees');
    if (table.adjustments) {
      await queryInterface.removeColumn('maintenance_fees', 'adjustments');
    }
  },
};
