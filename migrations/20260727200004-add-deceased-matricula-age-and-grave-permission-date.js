'use strict';

/**
 * Últimos campos do sistema antigo (SICART) para completar os formulários:
 *  - deceased.registration_number (Matrícula) e deceased.age (Idade)
 *  - graves.carneira_permission_date (Data da permissão de carneira)
 * Todos opcionais. Idempotente por coluna.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const dec = await queryInterface.describeTable('deceased');
    if (!dec.registration_number) {
      await queryInterface.addColumn('deceased', 'registration_number', {
        type: Sequelize.STRING(60), allowNull: true,
      });
    }
    if (!dec.age) {
      await queryInterface.addColumn('deceased', 'age', {
        type: Sequelize.STRING(30), allowNull: true,
      });
    }
    const gr = await queryInterface.describeTable('graves');
    if (!gr.carneira_permission_date) {
      await queryInterface.addColumn('graves', 'carneira_permission_date', {
        type: Sequelize.DATEONLY, allowNull: true,
      });
    }
  },

  async down(queryInterface) {
    const dec = await queryInterface.describeTable('deceased');
    if (dec.registration_number) await queryInterface.removeColumn('deceased', 'registration_number');
    if (dec.age) await queryInterface.removeColumn('deceased', 'age');
    const gr = await queryInterface.describeTable('graves');
    if (gr.carneira_permission_date) await queryInterface.removeColumn('graves', 'carneira_permission_date');
  },
};
