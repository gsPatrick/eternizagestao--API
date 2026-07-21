'use strict';

/**
 * Referência de MIGRAÇÃO do sistema antigo (SICART) na sepultura: como a
 * quadra e o lote eram nomeados antes. Texto livre, só para consulta/rastreio
 * (o formulário do cliente tinha "Quadra anterior" e "Lote anterior").
 *
 * Idempotente: só cria cada coluna se ainda não existir.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('graves');
    if (!table.previous_block) {
      await queryInterface.addColumn('graves', 'previous_block', {
        type: Sequelize.STRING(120),
        allowNull: true,
      });
    }
    if (!table.previous_lot) {
      await queryInterface.addColumn('graves', 'previous_lot', {
        type: Sequelize.STRING(120),
        allowNull: true,
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('graves');
    if (table.previous_block) await queryInterface.removeColumn('graves', 'previous_block');
    if (table.previous_lot) await queryInterface.removeColumn('graves', 'previous_lot');
  },
};
