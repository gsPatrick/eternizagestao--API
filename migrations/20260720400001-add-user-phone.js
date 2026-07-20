'use strict';

/**
 * Telefone do usuário administrativo (contato). Coluna opcional / nullable
 * em `users` — o painel já tem o campo no formulário de convite/edição.
 *
 * Idempotente por coluna (só adiciona se ainda não existir). DOWN remove a
 * coluna adicionada.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('users');
    if (!table.phone) {
      await queryInterface.addColumn('users', 'phone', {
        type: Sequelize.STRING(20),
        allowNull: true,
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('users');
    if (table.phone) {
      await queryInterface.removeColumn('users', 'phone');
    }
  },
};
