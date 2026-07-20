'use strict';

/**
 * Estado de onboarding da cidade (tenant). Quando o super_admin cria a cidade
 * já configurando toda a marca (modo 'completo'), o tenant nasce 'concluido';
 * quando delega a configuração ao admin da cidade (modo 'delegado'), nasce
 * 'pendente' até o admin preencher marca/órgão gestor.
 *
 * Default 'concluido' de propósito: tenants JÁ existentes (criados antes deste
 * módulo) passam a valer como concluídos, sem back-fill.
 *
 * Coluna adicionada em `tenants` (NOT NULL, default 'concluido'):
 *  - onboarding_status: ENUM('pendente','concluido')
 *
 * Idempotente por coluna (só adiciona se ainda não existir). DOWN remove a
 * coluna e o tipo ENUM gerado pelo Postgres.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('tenants');
    if (!table.onboarding_status) {
      await queryInterface.addColumn('tenants', 'onboarding_status', {
        type: Sequelize.ENUM('pendente', 'concluido'),
        allowNull: false,
        defaultValue: 'concluido',
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('tenants');
    if (table.onboarding_status) {
      await queryInterface.removeColumn('tenants', 'onboarding_status');
    }
    // Postgres não dropa o tipo ENUM junto da coluna.
    await queryInterface.sequelize.query(
      'DROP TYPE IF EXISTS "enum_tenants_onboarding_status";'
    );
  },
};
