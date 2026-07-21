'use strict';

/**
 * "Registro" do sepultado: o NÚMERO do registro no cartório (livro/folha/termo),
 * que no formulário do cliente vem ao lado do Cartório e é DIFERENTE do número
 * do atestado de óbito (`death_certificate_number`, emitido pelo médico).
 *
 * Idempotente: só cria a coluna se ainda não existir.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('deceased');
    if (!table.registry_number) {
      await queryInterface.addColumn('deceased', 'registry_number', {
        type: Sequelize.STRING(120),
        allowNull: true,
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('deceased');
    if (table.registry_number) await queryInterface.removeColumn('deceased', 'registry_number');
  },
};
