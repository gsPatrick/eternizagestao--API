'use strict';

/**
 * Campos de registro civil do sepultado presentes no sistema antigo (SICART):
 * estado civil, cor/raça, título de eleitor e local do falecimento.
 * Todos texto livre/opcional. Idempotente por coluna.
 */
const COLUMNS = {
  marital_status: 'STRING(40)',
  skin_color: 'STRING(30)',
  voter_id: 'STRING(30)',
  death_place: 'STRING(200)',
};

module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('deceased');
    const types = {
      marital_status: Sequelize.STRING(40),
      skin_color: Sequelize.STRING(30),
      voter_id: Sequelize.STRING(30),
      death_place: Sequelize.STRING(200),
    };
    for (const col of Object.keys(COLUMNS)) {
      if (!table[col]) {
        await queryInterface.addColumn('deceased', col, { type: types[col], allowNull: true });
      }
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('deceased');
    for (const col of Object.keys(COLUMNS)) {
      if (table[col]) await queryInterface.removeColumn('deceased', col);
    }
  },
};
