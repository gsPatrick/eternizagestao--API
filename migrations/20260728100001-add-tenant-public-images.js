'use strict';

/**
 * Imagens da PÁGINA PÚBLICA por cidade: hero e rodapé. Permitem que cada
 * prefeitura tenha a própria arte, diferente da do portal Eterniza (que segue
 * usando a arte padrão da plataforma quando estes campos estão vazios).
 *
 * Idempotente por coluna.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('tenants');
    if (!table.hero_image_url) {
      await queryInterface.addColumn('tenants', 'hero_image_url', {
        type: Sequelize.STRING(500), allowNull: true,
      });
    }
    if (!table.footer_image_url) {
      await queryInterface.addColumn('tenants', 'footer_image_url', {
        type: Sequelize.STRING(500), allowNull: true,
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('tenants');
    if (table.hero_image_url) await queryInterface.removeColumn('tenants', 'hero_image_url');
    if (table.footer_image_url) await queryInterface.removeColumn('tenants', 'footer_image_url');
  },
};
