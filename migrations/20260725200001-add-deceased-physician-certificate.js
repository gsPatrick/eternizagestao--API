'use strict';

/**
 * Sepultado (deceased): médico responsável + arquivo (PDF) da declaração/certidão
 * de óbito anexada no cadastro (pedido do cliente). Ambas nullable. Idempotente.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('deceased');
    if (!table.attending_physician) {
      await queryInterface.addColumn('deceased', 'attending_physician', {
        type: Sequelize.STRING(150),
        allowNull: true,
      });
    }
    if (!table.death_certificate_file_url) {
      await queryInterface.addColumn('deceased', 'death_certificate_file_url', {
        type: Sequelize.STRING(500),
        allowNull: true,
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('deceased');
    if (table.attending_physician) await queryInterface.removeColumn('deceased', 'attending_physician');
    if (table.death_certificate_file_url) await queryInterface.removeColumn('deceased', 'death_certificate_file_url');
  },
};
