'use strict';

/**
 * Campos oficiais da sepultura exigidos pelos MODELOS de documento do cliente
 * (certidão de perpetuidade / autorização de sepultamento):
 *
 *  - utilizacao          : STRING  — regime de uso (ex.: 'Perpétuo' / 'Temporário')
 *  - tomb_type           : STRING  — "Tipo do túmulo" (ex.: Campas ou jazigos-perpétuos,
 *                                    Carneiras de adultos, Bloco de gaveta, Lápides no chão/cavas)
 *  - carneira_permission : STRING  — "Permissão de carneira" (texto livre: Sim/Não/descrição)
 *
 * "Observação" reaproveita a coluna já existente `notes` (TEXT) — não há coluna
 * nova para isso. Idempotente por coluna. DOWN remove as colunas adicionadas.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('graves');
    const addColumn = async (name, spec) => {
      if (!table[name]) await queryInterface.addColumn('graves', name, spec);
    };

    await addColumn('utilizacao', { type: Sequelize.STRING(50), allowNull: true });
    await addColumn('tomb_type', { type: Sequelize.STRING(120), allowNull: true });
    await addColumn('carneira_permission', { type: Sequelize.STRING(120), allowNull: true });
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('graves');
    const dropColumn = async (name) => {
      if (table[name]) await queryInterface.removeColumn('graves', name);
    };

    await dropColumn('utilizacao');
    await dropColumn('tomb_type');
    await dropColumn('carneira_permission');
  },
};
