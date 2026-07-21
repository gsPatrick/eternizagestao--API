'use strict';

/**
 * Responsável pela sepultura no cadastro do sepultado — pessoa DISTINTA do
 * proprietário (concessão). Comum em disputas familiares: um é o dono, outro
 * responde pelo sepultado. FK para people (SET NULL se a pessoa for removida).
 *
 * Idempotente: só cria a coluna se ainda não existir.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('deceased');
    if (!table.responsible_person_id) {
      await queryInterface.addColumn('deceased', 'responsible_person_id', {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'people', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('deceased');
    if (table.responsible_person_id) {
      await queryInterface.removeColumn('deceased', 'responsible_person_id');
    }
  },
};
