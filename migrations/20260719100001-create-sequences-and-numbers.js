'use strict';

/**
 * Numeração sequencial concorrência-safe para Cobranças (COB-2026-XXXX) e
 * Processos de Exumação (0044/2026).
 *
 *  - Cria a tabela genérica `sequences` (tenant_id, scope, year, last_number) +
 *    índice único (tenant_id, scope, year) — o numerador travado (FOR UPDATE)
 *    vive aqui.
 *  - Adiciona `billings.code` e `exhumations.process_number` (STRING, nullable)
 *    cada um com índice único PARCIAL (tenant_id, <col>) WHERE <col> IS NOT NULL —
 *    registros antigos sem número não colidem; a unicidade vale só onde há número.
 *
 * Idempotente: só cria tabela/coluna/índice se ainda não existirem.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    // 1) Tabela genérica de sequências
    const tables = await queryInterface.showAllTables();
    const hasSequences = tables.map((t) => (typeof t === 'string' ? t : t.tableName)).includes('sequences');
    if (!hasSequences) {
      await queryInterface.createTable('sequences', {
        id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
        tenant_id: { type: Sequelize.UUID, allowNull: false },
        scope: { type: Sequelize.STRING, allowNull: false },
        year: { type: Sequelize.INTEGER, allowNull: false },
        // incrementado com SELECT ... FOR UPDATE dentro de transação
        last_number: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
        created_at: { type: Sequelize.DATE, allowNull: false },
        updated_at: { type: Sequelize.DATE, allowNull: false },
      });
    }
    await queryInterface.sequelize.query(
      'CREATE UNIQUE INDEX IF NOT EXISTS sequences_unique ON sequences (tenant_id, scope, year);'
    );

    // 2) billings.code
    const billings = await queryInterface.describeTable('billings');
    if (!billings.code) {
      await queryInterface.addColumn('billings', 'code', { type: Sequelize.STRING, allowNull: true });
    }
    await queryInterface.sequelize.query(
      'CREATE UNIQUE INDEX IF NOT EXISTS billings_tenant_code_unique ON billings (tenant_id, code) WHERE code IS NOT NULL;'
    );

    // 3) exhumations.process_number
    const exhumations = await queryInterface.describeTable('exhumations');
    if (!exhumations.process_number) {
      await queryInterface.addColumn('exhumations', 'process_number', { type: Sequelize.STRING, allowNull: true });
    }
    await queryInterface.sequelize.query(
      'CREATE UNIQUE INDEX IF NOT EXISTS exhumations_tenant_process_number_unique ON exhumations (tenant_id, process_number) WHERE process_number IS NOT NULL;'
    );
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query('DROP INDEX IF EXISTS exhumations_tenant_process_number_unique;');
    const exhumations = await queryInterface.describeTable('exhumations');
    if (exhumations.process_number) {
      await queryInterface.removeColumn('exhumations', 'process_number');
    }

    await queryInterface.sequelize.query('DROP INDEX IF EXISTS billings_tenant_code_unique;');
    const billings = await queryInterface.describeTable('billings');
    if (billings.code) {
      await queryInterface.removeColumn('billings', 'code');
    }

    await queryInterface.sequelize.query('DROP INDEX IF EXISTS sequences_unique;');
    await queryInterface.dropTable('sequences');
  },
};
