'use strict';

/**
 * Funerária responsável (nome) no cadastro do sepultado — escolhida da lista de
 * Básico › Funerárias (dropdown), pedido do cliente. Texto (nome) para casar com
 * o restante do cadastro e com o campo `funeral_home` do sepultamento.
 *
 * Idempotente: só cria a coluna se ainda não existir.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('deceased');
    if (!table.funeral_home) {
      await queryInterface.addColumn('deceased', 'funeral_home', {
        type: Sequelize.STRING(150),
        allowNull: true,
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('deceased');
    if (table.funeral_home) await queryInterface.removeColumn('deceased', 'funeral_home');
  },
};
