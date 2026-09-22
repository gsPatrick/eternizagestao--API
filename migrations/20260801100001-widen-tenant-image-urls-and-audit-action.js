'use strict';

/**
 * ENDURECIMENTO a partir de erros reais de produção (22001 — value too long).
 *
 * 1) tenants.logo_url / hero_image_url / footer_image_url: VARCHAR(500) era
 *    apertado para "<tenantId>/tenant/<uuid>-<nome original longo>.jpg" +
 *    eventual query string. O PATCH de onboarding estourava a coluna e o erro
 *    subia como 500 não tratado. Viram TEXT (sem custo no Postgres).
 *
 * 2) audit_logs.action / entity_type: VARCHAR(60). A rede de segurança da
 *    auditoria grava "MÉTODO /caminho" em `action`, e qualquer rota com UUID
 *    passa de 60 — o registro de auditoria era PERDIDO. Vão para VARCHAR(255).
 *
 * Reversível: o down volta aos tipos originais, truncando o que exceder para
 * o ALTER não falhar.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const tenants = await queryInterface.describeTable('tenants');
    for (const col of ['logo_url', 'hero_image_url', 'footer_image_url']) {
      if (tenants[col]) {
        await queryInterface.changeColumn('tenants', col, {
          type: Sequelize.TEXT, allowNull: true,
        });
      }
    }

    const audit = await queryInterface.describeTable('audit_logs');
    if (audit.action) {
      await queryInterface.changeColumn('audit_logs', 'action', {
        type: Sequelize.STRING(255), allowNull: false,
      });
    }
    if (audit.entity_type) {
      await queryInterface.changeColumn('audit_logs', 'entity_type', {
        type: Sequelize.STRING(255), allowNull: true,
      });
    }
  },

  async down(queryInterface, Sequelize) {
    // Trunca antes de estreitar, senão o ALTER falha com 22001.
    await queryInterface.sequelize.query(`
      UPDATE "tenants" SET
        "logo_url" = LEFT("logo_url", 500),
        "hero_image_url" = LEFT("hero_image_url", 500),
        "footer_image_url" = LEFT("footer_image_url", 500)
    `);
    for (const col of ['logo_url', 'hero_image_url', 'footer_image_url']) {
      await queryInterface.changeColumn('tenants', col, {
        type: Sequelize.STRING(500), allowNull: true,
      });
    }

    await queryInterface.sequelize.query(`
      UPDATE "audit_logs" SET
        "action" = LEFT("action", 60),
        "entity_type" = LEFT("entity_type", 60)
    `);
    await queryInterface.changeColumn('audit_logs', 'action', {
      type: Sequelize.STRING(60), allowNull: false,
    });
    await queryInterface.changeColumn('audit_logs', 'entity_type', {
      type: Sequelize.STRING(60), allowNull: true,
    });
  },
};
