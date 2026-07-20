'use strict';

/**
 * Exumações e Ossário:
 *  - ossuaries: estruturas de depósito de ossos por cemitério.
 *  - ossuary_niches: nichos/gavetas individuais do ossário.
 *  - exhumations: fluxo completo (solicitação → autorização → agendamento →
 *    realização) com destino dos restos mortais.
 *  - remains_deposits: rastreabilidade do depósito de restos mortais em nichos
 *    (de onde veio, onde está, para onde foi).
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

    await queryInterface.createTable('ossuaries', {
      id,
      tenant_id: fk('tenants'),
      cemetery_id: fk('cemeteries'),
      name: { type: Sequelize.STRING(150), allowNull: false },
      code: { type: Sequelize.STRING(30), allowNull: true },
      description: { type: Sequelize.TEXT, allowNull: true },
      latitude: { type: Sequelize.DECIMAL(10, 7), allowNull: true },
      longitude: { type: Sequelize.DECIMAL(10, 7), allowNull: true },
      geo_polygon: { type: Sequelize.JSONB, allowNull: true },
      active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      ...timestamps,
      deleted_at: { type: Sequelize.DATE, allowNull: true },
    });
    await queryInterface.addIndex('ossuaries', ['cemetery_id'], { name: 'ossuaries_cemetery_id_idx' });

    await queryInterface.createTable('ossuary_niches', {
      id,
      tenant_id: fk('tenants'),
      ossuary_id: fk('ossuaries', false, 'CASCADE'),
      code: { type: Sequelize.STRING(30), allowNull: false },
      row_label: { type: Sequelize.STRING(20), allowNull: true },
      column_label: { type: Sequelize.STRING(20), allowNull: true },
      status: {
        type: Sequelize.ENUM('livre', 'ocupado', 'reservado', 'em_manutencao'),
        allowNull: false,
        defaultValue: 'livre',
      },
      notes: { type: Sequelize.TEXT, allowNull: true },
      ...timestamps,
      deleted_at: { type: Sequelize.DATE, allowNull: true },
    });
    await queryInterface.addIndex('ossuary_niches', ['ossuary_id', 'code'], {
      unique: true,
      name: 'ossuary_niches_ossuary_id_code_unique',
    });

    await queryInterface.createTable('exhumations', {
      id,
      tenant_id: fk('tenants'),
      cemetery_id: fk('cemeteries'),
      // sepultura de origem dos restos mortais
      grave_id: fk('graves'),
      burial_id: fk('burials', true),
      deceased_id: fk('deceased'),
      // responsável legal solicitante
      requested_by_person_id: fk('people', true),
      request_date: { type: Sequelize.DATEONLY, allowNull: true },
      reason: { type: Sequelize.TEXT, allowNull: true },
      authorization_number: { type: Sequelize.STRING(60), allowNull: true },
      authorized_by_user_id: fk('users', true),
      authorized_at: { type: Sequelize.DATE, allowNull: true },
      scheduled_date: { type: Sequelize.DATEONLY, allowNull: true },
      performed_at: { type: Sequelize.DATE, allowNull: true },
      // profissional/equipe que executou o procedimento
      performed_by: { type: Sequelize.STRING(150), allowNull: true },
      status: {
        type: Sequelize.ENUM('solicitada', 'autorizada', 'agendada', 'realizada', 'cancelada'),
        allowNull: false,
        defaultValue: 'solicitada',
      },
      destination_type: {
        type: Sequelize.ENUM('ossario', 'outro_jazigo', 'cremacao', 'translado_externo', 'outro'),
        allowNull: true,
      },
      destination_grave_id: fk('graves', true),
      destination_ossuary_niche_id: fk('ossuary_niches', true),
      destination_details: { type: Sequelize.TEXT, allowNull: true },
      registered_by_user_id: fk('users', true),
      notes: { type: Sequelize.TEXT, allowNull: true },
      ...timestamps,
    });
    await queryInterface.addIndex('exhumations', ['grave_id'], { name: 'exhumations_grave_id_idx' });
    await queryInterface.addIndex('exhumations', ['deceased_id'], { name: 'exhumations_deceased_id_idx' });
    await queryInterface.addIndex('exhumations', ['tenant_id', 'status'], {
      name: 'exhumations_tenant_id_status_idx',
    });

    await queryInterface.createTable('remains_deposits', {
      id,
      tenant_id: fk('tenants'),
      deceased_id: fk('deceased'),
      exhumation_id: fk('exhumations', true),
      ossuary_niche_id: fk('ossuary_niches'),
      // rastreabilidade: sepultura de onde os restos vieram
      origin_grave_id: fk('graves', true),
      deposited_at: { type: Sequelize.DATE, allowNull: false },
      removed_at: { type: Sequelize.DATE, allowNull: true },
      removal_reason: { type: Sequelize.STRING(255), allowNull: true },
      // destino após a retirada (novo nicho, translado, cremação...)
      removal_destination: { type: Sequelize.STRING(255), allowNull: true },
      status: {
        type: Sequelize.ENUM('depositado', 'transferido', 'retirado'),
        allowNull: false,
        defaultValue: 'depositado',
      },
      registered_by_user_id: fk('users', true),
      notes: { type: Sequelize.TEXT, allowNull: true },
      ...timestamps,
    });
    await queryInterface.addIndex('remains_deposits', ['ossuary_niche_id'], {
      name: 'remains_deposits_ossuary_niche_id_idx',
    });
    await queryInterface.addIndex('remains_deposits', ['deceased_id'], {
      name: 'remains_deposits_deceased_id_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('remains_deposits');
    await queryInterface.dropTable('exhumations');
    await queryInterface.dropTable('ossuary_niches');
    await queryInterface.dropTable('ossuaries');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_remains_deposits_status";');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_exhumations_status";');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_exhumations_destination_type";');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_ossuary_niches_status";');
  },
};
