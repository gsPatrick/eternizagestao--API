'use strict';

/**
 * Índices únicos PARCIAIS (integridade correta a escala):
 *
 *  1) Unicidade de super_admins/statuses de sistema (tenant_id NULL): o unique
 *     composto existente não impede duplicatas quando tenant_id é NULL, pois em
 *     Postgres NULL nunca é igual a NULL. Índices parciais WHERE tenant_id IS NULL
 *     resolvem isso, mantendo o unique composto original intacto.
 *
 *  2) Soft-delete: os uniques "cheios" impediriam recadastro de um código/CPF cujo
 *     registro original foi apenas marcado como deleted_at. Trocamos por índices
 *     únicos parciais WHERE deleted_at IS NULL — a unicidade passa a valer apenas
 *     entre os registros vivos.
 *
 * NOTA: family_portal_accounts NÃO possui coluna deleted_at (ver migration 04),
 * portanto seus uniques permanecem "cheios" — não há soft-delete a considerar ali.
 */
module.exports = {
  async up(queryInterface) {
    // (1) Uniques parciais para registros de sistema (tenant_id NULL)
    // mantém users_tenant_id_email_unique e grave_statuses_tenant_id_slug_unique
    await queryInterface.sequelize.query(
      'CREATE UNIQUE INDEX users_email_platform_unique ON users (email) WHERE tenant_id IS NULL;'
    );
    await queryInterface.sequelize.query(
      'CREATE UNIQUE INDEX grave_statuses_slug_system_unique ON grave_statuses (slug) WHERE tenant_id IS NULL;'
    );

    // (2) Soft-delete: remove uniques "cheios" e recria como parciais WHERE deleted_at IS NULL
    // people (tenant_id, cpf)
    await queryInterface.sequelize.query('DROP INDEX IF EXISTS people_tenant_id_cpf_unique;');
    await queryInterface.sequelize.query(
      'CREATE UNIQUE INDEX people_tenant_id_cpf_active_unique ON people (tenant_id, cpf) WHERE deleted_at IS NULL;'
    );

    // graves (cemetery_id, code)
    await queryInterface.sequelize.query('DROP INDEX IF EXISTS graves_cemetery_id_code_unique;');
    await queryInterface.sequelize.query(
      'CREATE UNIQUE INDEX graves_cemetery_id_code_active_unique ON graves (cemetery_id, code) WHERE deleted_at IS NULL;'
    );

    // blocks (cemetery_id, code)
    await queryInterface.sequelize.query('DROP INDEX IF EXISTS blocks_cemetery_id_code_unique;');
    await queryInterface.sequelize.query(
      'CREATE UNIQUE INDEX blocks_cemetery_id_code_active_unique ON blocks (cemetery_id, code) WHERE deleted_at IS NULL;'
    );

    // streets (block_id, code)
    await queryInterface.sequelize.query('DROP INDEX IF EXISTS streets_block_id_code_unique;');
    await queryInterface.sequelize.query(
      'CREATE UNIQUE INDEX streets_block_id_code_active_unique ON streets (block_id, code) WHERE deleted_at IS NULL;'
    );

    // lots (street_id, code)
    await queryInterface.sequelize.query('DROP INDEX IF EXISTS lots_street_id_code_unique;');
    await queryInterface.sequelize.query(
      'CREATE UNIQUE INDEX lots_street_id_code_active_unique ON lots (street_id, code) WHERE deleted_at IS NULL;'
    );

    // ossuary_niches (ossuary_id, code)
    await queryInterface.sequelize.query('DROP INDEX IF EXISTS ossuary_niches_ossuary_id_code_unique;');
    await queryInterface.sequelize.query(
      'CREATE UNIQUE INDEX ossuary_niches_ossuary_id_code_active_unique ON ossuary_niches (ossuary_id, code) WHERE deleted_at IS NULL;'
    );
  },

  async down(queryInterface) {
    // reverte soft-delete: remove parciais e recria uniques "cheios" originais
    await queryInterface.sequelize.query('DROP INDEX IF EXISTS ossuary_niches_ossuary_id_code_active_unique;');
    await queryInterface.sequelize.query(
      'CREATE UNIQUE INDEX ossuary_niches_ossuary_id_code_unique ON ossuary_niches (ossuary_id, code);'
    );

    await queryInterface.sequelize.query('DROP INDEX IF EXISTS lots_street_id_code_active_unique;');
    await queryInterface.sequelize.query(
      'CREATE UNIQUE INDEX lots_street_id_code_unique ON lots (street_id, code);'
    );

    await queryInterface.sequelize.query('DROP INDEX IF EXISTS streets_block_id_code_active_unique;');
    await queryInterface.sequelize.query(
      'CREATE UNIQUE INDEX streets_block_id_code_unique ON streets (block_id, code);'
    );

    await queryInterface.sequelize.query('DROP INDEX IF EXISTS blocks_cemetery_id_code_active_unique;');
    await queryInterface.sequelize.query(
      'CREATE UNIQUE INDEX blocks_cemetery_id_code_unique ON blocks (cemetery_id, code);'
    );

    await queryInterface.sequelize.query('DROP INDEX IF EXISTS graves_cemetery_id_code_active_unique;');
    await queryInterface.sequelize.query(
      'CREATE UNIQUE INDEX graves_cemetery_id_code_unique ON graves (cemetery_id, code);'
    );

    await queryInterface.sequelize.query('DROP INDEX IF EXISTS people_tenant_id_cpf_active_unique;');
    await queryInterface.sequelize.query(
      'CREATE UNIQUE INDEX people_tenant_id_cpf_unique ON people (tenant_id, cpf);'
    );

    // reverte uniques parciais de sistema
    await queryInterface.sequelize.query('DROP INDEX IF EXISTS grave_statuses_slug_system_unique;');
    await queryInterface.sequelize.query('DROP INDEX IF EXISTS users_email_platform_unique;');
  },
};
