'use strict';

/**
 * Flag de "trocar senha no primeiro acesso". O admin da cidade é criado com uma
 * SENHA TEMPORÁRIA (enviada no e-mail de convite); ao entrar pela 1ª vez o
 * sistema OBRIGA a definir uma senha própria. Idempotente.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('users');
    if (!table.must_change_password) {
      await queryInterface.addColumn('users', 'must_change_password', {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('users');
    if (table.must_change_password) {
      await queryInterface.removeColumn('users', 'must_change_password');
    }
  },
};
