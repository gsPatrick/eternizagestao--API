'use strict';

/**
 * Identidade visual (cores da marca) e dados do órgão gestor do cemitério.
 * Alimentam o modal de Configurações da tela de detalhe do cemitério e o
 * cabeçalho dos documentos oficiais (certidões, autorizações, recibos).
 *
 * Colunas adicionadas em `cemeteries` (todas opcionais / nullable):
 *  - brand_primary_color / brand_secondary_color: cores hex (#RRGGBB)
 *  - manager_name: nome do órgão gestor
 *  - manager_document: CNPJ do órgão
 *  - manager_phone / manager_email: contato do órgão
 *
 * Idempotente por coluna (só adiciona se ainda não existir). DOWN remove as
 * colunas adicionadas.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('cemeteries');
    const addColumn = async (name, spec) => {
      if (!table[name]) await queryInterface.addColumn('cemeteries', name, spec);
    };

    await addColumn('brand_primary_color', { type: Sequelize.STRING(7), allowNull: true });
    await addColumn('brand_secondary_color', { type: Sequelize.STRING(7), allowNull: true });
    await addColumn('manager_name', { type: Sequelize.STRING(150), allowNull: true });
    await addColumn('manager_document', { type: Sequelize.STRING(20), allowNull: true });
    await addColumn('manager_phone', { type: Sequelize.STRING(20), allowNull: true });
    await addColumn('manager_email', { type: Sequelize.STRING(150), allowNull: true });
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('cemeteries');
    const dropColumn = async (name) => {
      if (table[name]) await queryInterface.removeColumn('cemeteries', name);
    };

    await dropColumn('brand_primary_color');
    await dropColumn('brand_secondary_color');
    await dropColumn('manager_name');
    await dropColumn('manager_document');
    await dropColumn('manager_phone');
    await dropColumn('manager_email');
  },
};
