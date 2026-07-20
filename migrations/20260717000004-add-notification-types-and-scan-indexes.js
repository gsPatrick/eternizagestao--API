'use strict';

/**
 * Novos tipos de notificação (automações que faltavam) + índices de varredura.
 *
 * ENUM:
 *  - Adiciona ao tipo `enum_notifications_notification_type` os valores
 *    'cobranca_vencida', 'documento_emitido' e 'avulsa'.
 *  - Nome do enum confirmado na migration original 20260716000012-create-support-tables
 *    (Sequelize nomeia como enum_<tabela>_<coluna>).
 *
 *  IMPORTANTE: no Postgres, `ALTER TYPE ... ADD VALUE` NÃO pode rodar dentro de um
 *  bloco de transação. Por isso esta migration NÃO abre transação — os comandos são
 *  emitidos direto via queryInterface.sequelize.query. O `ADD VALUE IF NOT EXISTS`
 *  torna a operação idempotente (Postgres >= 12).
 *
 * ÍNDICES (só criados se ainda não existirem — IF NOT EXISTS):
 *  - notifications (scheduled_for) parcial: acelera o agendador que busca envios
 *    agendados ainda pendentes/enfileirados. (o índice (tenant_id, status) já existe
 *    na migration original, então NÃO é recriado aqui.)
 *  - billings (due_date) parcial WHERE status = 'pendente': acelera a varredura que
 *    marca cobranças vencidas (pendente -> em_atraso). O composto
 *    (tenant_id, status, due_date) já existe, mas lidera por tenant_id; este parcial
 *    serve a varredura global por vencimento. Colunas confirmadas na migration 000009.
 *
 * DOWN: remover valor de um ENUM no Postgres é inseguro/complexo (exige recriar o
 * tipo e reescrever todas as colunas que o usam) e pode falhar se algum registro já
 * usar o valor. Portanto o down é NO-OP para os valores do enum (apenas remove os
 * índices criados aqui). Documentado de propósito para não quebrar o rollback.
 */
module.exports = {
  async up(queryInterface) {
    // ENUM: novos tipos de notificação (fora de transação — ver comentário acima)
    await queryInterface.sequelize.query(
      `ALTER TYPE "enum_notifications_notification_type" ADD VALUE IF NOT EXISTS 'cobranca_vencida';`
    );
    await queryInterface.sequelize.query(
      `ALTER TYPE "enum_notifications_notification_type" ADD VALUE IF NOT EXISTS 'documento_emitido';`
    );
    await queryInterface.sequelize.query(
      `ALTER TYPE "enum_notifications_notification_type" ADD VALUE IF NOT EXISTS 'avulsa';`
    );

    // Índice: agendador de notificações (envios agendados ainda não concluídos)
    await queryInterface.sequelize.query(`
      CREATE INDEX IF NOT EXISTS notifications_scheduled_for_idx
        ON notifications (scheduled_for)
        WHERE scheduled_for IS NOT NULL
          AND status IN ('pendente', 'enfileirada');
    `);

    // Índice: varredura de cobranças vencidas (pendente -> em_atraso)
    await queryInterface.sequelize.query(`
      CREATE INDEX IF NOT EXISTS billings_overdue_scan_idx
        ON billings (due_date)
        WHERE status = 'pendente';
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query('DROP INDEX IF EXISTS billings_overdue_scan_idx;');
    await queryInterface.sequelize.query('DROP INDEX IF EXISTS notifications_scheduled_for_idx;');
    // NO-OP proposital: valores de ENUM ('cobranca_vencida', 'documento_emitido',
    // 'avulsa') NÃO são removidos — remoção de valor de enum no Postgres é insegura.
  },
};
