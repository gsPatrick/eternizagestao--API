'use strict';

/**
 * Novos escopos de importação de legado: 'concessoes' (contratos/vínculos com
 * jazigos) e 'cobrancas' (débitos/pagamentos históricos do sistema antigo).
 *
 * ENUM:
 *  - Adiciona ao tipo `enum_import_batches_entity_scope` os valores
 *    'concessoes' e 'cobrancas'.
 *  - Nome do enum confirmado na migration original 20260716000012-create-support-tables
 *    (Sequelize nomeia como enum_<tabela>_<coluna>).
 *
 *  IMPORTANTE: no Postgres, `ALTER TYPE ... ADD VALUE` NÃO pode rodar dentro de um
 *  bloco de transação. Por isso esta migration NÃO abre transação — os comandos são
 *  emitidos direto via queryInterface.sequelize.query. O `ADD VALUE IF NOT EXISTS`
 *  torna a operação idempotente (Postgres >= 12).
 *
 * DOWN: remover valor de um ENUM no Postgres é inseguro/complexo (exige recriar o
 * tipo e reescrever todas as colunas que o usam) e pode falhar se algum registro já
 * usar o valor. Portanto o down é NO-OP proposital. Documentado para não quebrar o
 * rollback.
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(
      `ALTER TYPE "enum_import_batches_entity_scope" ADD VALUE IF NOT EXISTS 'concessoes';`
    );
    await queryInterface.sequelize.query(
      `ALTER TYPE "enum_import_batches_entity_scope" ADD VALUE IF NOT EXISTS 'cobrancas';`
    );
  },

  async down() {
    // NO-OP proposital: valores de ENUM ('concessoes', 'cobrancas') NÃO são
    // removidos — remoção de valor de enum no Postgres é insegura.
  },
};
