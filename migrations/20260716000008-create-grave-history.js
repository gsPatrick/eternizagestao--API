'use strict';

/**
 * Histórico do jazigo:
 *  - grave_events: linha do tempo IMUTÁVEL de cada sepultura (sepultamentos,
 *    exumações, reformas, transferências, cobranças, pagamentos, documentos...).
 *    Referência polimórfica (reference_type/reference_id) aponta para a entidade
 *    de origem do evento sem criar ciclos de FK.
 *  - grave_maintenances: reformas e alterações físicas da sepultura.
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

    await queryInterface.createTable('grave_events', {
      id,
      tenant_id: fk('tenants'),
      grave_id: fk('graves'),
      event_type: {
        type: Sequelize.ENUM(
          'sepultamento',
          'exumacao',
          'reforma',
          'manutencao',
          'transferencia_propriedade',
          'concessao',
          'cobranca',
          'pagamento',
          'bloqueio',
          'desbloqueio',
          'alteracao_status',
          'deposito_ossario',
          'documento_emitido',
          'agendamento',
          'outro'
        ),
        allowNull: false,
      },
      title: { type: Sequelize.STRING(200), allowNull: false },
      description: { type: Sequelize.TEXT, allowNull: true },
      // referência polimórfica à entidade de origem (burial, exhumation, billing...)
      reference_type: { type: Sequelize.STRING(60), allowNull: true },
      reference_id: { type: Sequelize.UUID, allowNull: true },
      metadata: { type: Sequelize.JSONB, allowNull: true },
      occurred_at: { type: Sequelize.DATE, allowNull: false },
      registered_by_user_id: fk('users', true),
      ...timestamps,
    });
    await queryInterface.addIndex('grave_events', ['grave_id', 'occurred_at'], {
      name: 'grave_events_grave_id_occurred_at_idx',
    });
    await queryInterface.addIndex('grave_events', ['reference_type', 'reference_id'], {
      name: 'grave_events_reference_idx',
    });
    await queryInterface.addIndex('grave_events', ['tenant_id', 'event_type'], {
      name: 'grave_events_tenant_id_event_type_idx',
    });

    await queryInterface.createTable('grave_maintenances', {
      id,
      tenant_id: fk('tenants'),
      grave_id: fk('graves'),
      maintenance_type: {
        type: Sequelize.ENUM('reforma', 'construcao', 'limpeza', 'pintura', 'reparo', 'outro'),
        allowNull: false,
      },
      description: { type: Sequelize.TEXT, allowNull: true },
      requested_by_person_id: fk('people', true),
      status: {
        type: Sequelize.ENUM('solicitada', 'autorizada', 'em_andamento', 'concluida', 'cancelada'),
        allowNull: false,
        defaultValue: 'solicitada',
      },
      start_date: { type: Sequelize.DATEONLY, allowNull: true },
      end_date: { type: Sequelize.DATEONLY, allowNull: true },
      cost: { type: Sequelize.DECIMAL(12, 2), allowNull: true },
      // executor da obra (empresa/profissional)
      performed_by: { type: Sequelize.STRING(150), allowNull: true },
      registered_by_user_id: fk('users', true),
      notes: { type: Sequelize.TEXT, allowNull: true },
      ...timestamps,
    });
    await queryInterface.addIndex('grave_maintenances', ['grave_id'], {
      name: 'grave_maintenances_grave_id_idx',
    });
    await queryInterface.addIndex('grave_maintenances', ['tenant_id', 'status'], {
      name: 'grave_maintenances_tenant_id_status_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('grave_maintenances');
    await queryInterface.dropTable('grave_events');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_grave_events_event_type";');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_grave_maintenances_maintenance_type";');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_grave_maintenances_status";');
  },
};
