'use strict';

/**
 * Módulo financeiro:
 *  - fee_types: catálogo de taxas do tenant (manutenção, serviços...).
 *  - maintenance_fees: taxa aplicada a um jazigo, vinculada ao proprietário pagador.
 *  - billings: cobranças (boleto/PIX via gateway), com suporte a 2ª via.
 *  - payments: baixas (manuais ou automáticas) com recibo.
 *  - payment_gateway_events: webhooks crus do gateway (auditoria da baixa automática).
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const timestamps = {
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
    };
    const id = {
      type: Sequelize.UUID,
      primaryKey: true,
      defaultValue: Sequelize.literal('gen_random_uuid()'),
    };
    const fk = (table, allowNull = false, onDelete = 'RESTRICT') => ({
      type: Sequelize.UUID,
      allowNull,
      references: { model: table, key: 'id' },
      onUpdate: 'CASCADE',
      onDelete,
    });

    await queryInterface.createTable('fee_types', {
      id,
      tenant_id: fk('tenants'),
      name: { type: Sequelize.STRING(100), allowNull: false },
      description: { type: Sequelize.TEXT, allowNull: true },
      default_amount: { type: Sequelize.DECIMAL(12, 2), allowNull: true },
      periodicity: {
        type: Sequelize.ENUM('mensal', 'trimestral', 'semestral', 'anual', 'unica'),
        allowNull: false,
        defaultValue: 'anual',
      },
      active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      ...timestamps,
      deleted_at: { type: Sequelize.DATE, allowNull: true },
    });
    await queryInterface.addIndex('fee_types', ['tenant_id'], { name: 'fee_types_tenant_id_idx' });

    await queryInterface.createTable('maintenance_fees', {
      id,
      tenant_id: fk('tenants'),
      grave_id: fk('graves'),
      fee_type_id: fk('fee_types'),
      concession_id: fk('concessions', true),
      // proprietário responsável pelo pagamento
      payer_person_id: fk('people'),
      amount: { type: Sequelize.DECIMAL(12, 2), allowNull: false },
      periodicity: {
        type: Sequelize.ENUM('mensal', 'trimestral', 'semestral', 'anual', 'unica'),
        allowNull: false,
      },
      // dia (e mês, quando anual) de vencimento das cobranças geradas
      due_day: { type: Sequelize.INTEGER, allowNull: true },
      due_month: { type: Sequelize.INTEGER, allowNull: true },
      next_due_date: { type: Sequelize.DATEONLY, allowNull: true },
      last_adjusted_at: { type: Sequelize.DATEONLY, allowNull: true },
      adjustment_notes: { type: Sequelize.STRING(255), allowNull: true },
      status: {
        type: Sequelize.ENUM('ativa', 'suspensa', 'encerrada'),
        allowNull: false,
        defaultValue: 'ativa',
      },
      notes: { type: Sequelize.TEXT, allowNull: true },
      ...timestamps,
      deleted_at: { type: Sequelize.DATE, allowNull: true },
    });
    await queryInterface.addIndex('maintenance_fees', ['grave_id'], { name: 'maintenance_fees_grave_id_idx' });
    await queryInterface.addIndex('maintenance_fees', ['payer_person_id'], {
      name: 'maintenance_fees_payer_person_id_idx',
    });
    await queryInterface.addIndex('maintenance_fees', ['tenant_id', 'status', 'next_due_date'], {
      name: 'maintenance_fees_generation_idx',
    });

    await queryInterface.createTable('billings', {
      id,
      tenant_id: fk('tenants'),
      cemetery_id: fk('cemeteries', true),
      grave_id: fk('graves', true),
      maintenance_fee_id: fk('maintenance_fees', true),
      payer_person_id: fk('people'),
      origin: {
        type: Sequelize.ENUM('taxa_manutencao', 'servico', 'avulsa'),
        allowNull: false,
        defaultValue: 'taxa_manutencao',
      },
      description: { type: Sequelize.STRING(255), allowNull: true },
      // competência da cobrança (ex.: '2026-07' ou '2026')
      reference_period: { type: Sequelize.STRING(7), allowNull: true },
      amount: { type: Sequelize.DECIMAL(12, 2), allowNull: false },
      discount_amount: { type: Sequelize.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
      fine_amount: { type: Sequelize.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
      interest_amount: { type: Sequelize.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
      total_amount: { type: Sequelize.DECIMAL(12, 2), allowNull: false },
      due_date: { type: Sequelize.DATEONLY, allowNull: false },
      status: {
        type: Sequelize.ENUM('pendente', 'pago', 'em_atraso', 'cancelado', 'estornado'),
        allowNull: false,
        defaultValue: 'pendente',
      },
      // integração com o gateway de pagamento
      gateway_provider: { type: Sequelize.STRING(50), allowNull: true },
      gateway_charge_id: { type: Sequelize.STRING(100), allowNull: true },
      boleto_barcode: { type: Sequelize.STRING(60), allowNull: true },
      boleto_digitable_line: { type: Sequelize.STRING(60), allowNull: true },
      boleto_url: { type: Sequelize.STRING(500), allowNull: true },
      pix_qr_code: { type: Sequelize.TEXT, allowNull: true },
      pix_copy_paste: { type: Sequelize.TEXT, allowNull: true },
      pix_expires_at: { type: Sequelize.DATE, allowNull: true },
      // 2ª via: nova cobrança aponta para a original
      original_billing_id: fk('billings', true),
      reissue_count: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      canceled_at: { type: Sequelize.DATE, allowNull: true },
      notes: { type: Sequelize.TEXT, allowNull: true },
      ...timestamps,
    });
    await queryInterface.addIndex('billings', ['tenant_id', 'status', 'due_date'], {
      name: 'billings_tenant_status_due_date_idx',
    });
    await queryInterface.addIndex('billings', ['payer_person_id'], { name: 'billings_payer_person_id_idx' });
    await queryInterface.addIndex('billings', ['grave_id'], { name: 'billings_grave_id_idx' });
    await queryInterface.addIndex('billings', ['gateway_charge_id'], { name: 'billings_gateway_charge_id_idx' });

    await queryInterface.createTable('payments', {
      id,
      tenant_id: fk('tenants'),
      billing_id: fk('billings'),
      paid_at: { type: Sequelize.DATE, allowNull: false },
      amount_paid: { type: Sequelize.DECIMAL(12, 2), allowNull: false },
      method: {
        type: Sequelize.ENUM(
          'pix',
          'boleto',
          'dinheiro',
          'cartao_credito',
          'cartao_debito',
          'transferencia',
          'outro'
        ),
        allowNull: false,
      },
      gateway_transaction_id: { type: Sequelize.STRING(100), allowNull: true },
      // recibo emitido e vinculado ao histórico do jazigo
      receipt_number: { type: Sequelize.STRING(30), allowNull: true },
      // TRUE => baixa automática via webhook do gateway
      is_automatic: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      reconciled: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      reconciled_at: { type: Sequelize.DATE, allowNull: true },
      // NULL quando a baixa foi automática
      registered_by_user_id: fk('users', true),
      notes: { type: Sequelize.TEXT, allowNull: true },
      ...timestamps,
    });
    await queryInterface.addIndex('payments', ['billing_id'], { name: 'payments_billing_id_idx' });
    await queryInterface.addIndex('payments', ['tenant_id', 'paid_at'], {
      name: 'payments_tenant_id_paid_at_idx',
    });

    await queryInterface.createTable('payment_gateway_events', {
      id,
      tenant_id: fk('tenants', true),
      provider: { type: Sequelize.STRING(50), allowNull: false },
      event_type: { type: Sequelize.STRING(100), allowNull: true },
      gateway_charge_id: { type: Sequelize.STRING(100), allowNull: true },
      billing_id: fk('billings', true),
      // payload bruto recebido do gateway — nunca alterar
      payload: { type: Sequelize.JSONB, allowNull: false },
      status: {
        type: Sequelize.ENUM('recebido', 'processado', 'ignorado', 'erro'),
        allowNull: false,
        defaultValue: 'recebido',
      },
      error_message: { type: Sequelize.TEXT, allowNull: true },
      processed_at: { type: Sequelize.DATE, allowNull: true },
      ...timestamps,
    });
    await queryInterface.addIndex('payment_gateway_events', ['gateway_charge_id'], {
      name: 'payment_gateway_events_charge_id_idx',
    });
    await queryInterface.addIndex('payment_gateway_events', ['status'], {
      name: 'payment_gateway_events_status_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('payment_gateway_events');
    await queryInterface.dropTable('payments');
    await queryInterface.dropTable('billings');
    await queryInterface.dropTable('maintenance_fees');
    await queryInterface.dropTable('fee_types');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_payment_gateway_events_status";');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_payments_method";');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_billings_status";');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_billings_origin";');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_maintenance_fees_status";');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_maintenance_fees_periodicity";');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_fee_types_periodicity";');
  },
};
