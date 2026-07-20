'use strict';

/**
 * Constraints de concorrência — protegem invariantes que o service checa em runtime
 * mas que corridas (duas requisições simultâneas) conseguem furar. O banco passa a
 * ser a autoridade final:
 *
 *  - schedules: exclusão de sobreposição de horário para a MESMA capela e para a
 *    MESMA sepultura (ignorando cancelado/concluído). Impede double-booking.
 *  - payments: no máximo UMA baixa automática (webhook) por cobrança.
 *  - payment_gateway_events: idempotência de webhook (provider+charge+event_type).
 *  - billings: não duplicar cobrança do mesmo período para a mesma taxa.
 *  - remains_deposits: no máximo UM resto ativo (depositado) por nicho.
 *
 * Exige btree_gist para combinar igualdade (uuid) com range (&&) num EXCLUDE.
 * Colunas confirmadas nas migrations 000009 (financeiro), 000010 (scheduling)
 * e 000007 (ossuary/exhumations).
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query('CREATE EXTENSION IF NOT EXISTS btree_gist;');

    // schedules: sem sobreposição por capela
    await queryInterface.sequelize.query(`
      ALTER TABLE schedules
        ADD CONSTRAINT schedules_chapel_no_overlap
        EXCLUDE USING gist (
          chapel_id WITH =,
          tstzrange(starts_at, ends_at) WITH &&
        )
        WHERE (status NOT IN ('cancelado', 'concluido') AND chapel_id IS NOT NULL);
    `);

    // schedules: sem sobreposição por sepultura
    await queryInterface.sequelize.query(`
      ALTER TABLE schedules
        ADD CONSTRAINT schedules_grave_no_overlap
        EXCLUDE USING gist (
          grave_id WITH =,
          tstzrange(starts_at, ends_at) WITH &&
        )
        WHERE (status NOT IN ('cancelado', 'concluido') AND grave_id IS NOT NULL);
    `);

    // payments: uma única baixa automática por cobrança
    await queryInterface.sequelize.query(
      'CREATE UNIQUE INDEX payments_billing_id_automatic_unique ON payments (billing_id) WHERE is_automatic = true;'
    );

    // payment_gateway_events: idempotência de webhook
    // (só faz sentido quando há charge/event identificáveis)
    await queryInterface.sequelize.query(`
      CREATE UNIQUE INDEX payment_gateway_events_idempotency_unique
        ON payment_gateway_events (provider, gateway_charge_id, event_type)
        WHERE gateway_charge_id IS NOT NULL AND event_type IS NOT NULL;
    `);

    // billings: não duplicar cobrança da mesma taxa no mesmo período
    await queryInterface.sequelize.query(`
      CREATE UNIQUE INDEX billings_fee_period_active_unique
        ON billings (maintenance_fee_id, reference_period)
        WHERE status <> 'cancelado'
          AND maintenance_fee_id IS NOT NULL
          AND reference_period IS NOT NULL;
    `);

    // remains_deposits: um resto ativo (depositado) por nicho
    await queryInterface.sequelize.query(
      "CREATE UNIQUE INDEX remains_deposits_active_niche_unique ON remains_deposits (ossuary_niche_id) WHERE status = 'depositado';"
    );
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query('DROP INDEX IF EXISTS remains_deposits_active_niche_unique;');
    await queryInterface.sequelize.query('DROP INDEX IF EXISTS billings_fee_period_active_unique;');
    await queryInterface.sequelize.query('DROP INDEX IF EXISTS payment_gateway_events_idempotency_unique;');
    await queryInterface.sequelize.query('DROP INDEX IF EXISTS payments_billing_id_automatic_unique;');
    await queryInterface.sequelize.query(
      'ALTER TABLE schedules DROP CONSTRAINT IF EXISTS schedules_grave_no_overlap;'
    );
    await queryInterface.sequelize.query(
      'ALTER TABLE schedules DROP CONSTRAINT IF EXISTS schedules_chapel_no_overlap;'
    );
    // btree_gist é deixada instalada de propósito (outras constraints podem depender dela)
  },
};
