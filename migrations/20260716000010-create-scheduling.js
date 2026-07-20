'use strict';

/**
 * Agendamentos:
 *  - chapels: capelas / salas de velório por cemitério.
 *  - schedules: agenda de velórios, sepultamentos e exumações.
 *    A detecção de conflito de horário é feita pelo service consultando
 *    sobreposição de intervalos nos índices (chapel/grave + starts_at/ends_at).
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

    await queryInterface.createTable('chapels', {
      id,
      tenant_id: fk('tenants'),
      cemetery_id: fk('cemeteries'),
      name: { type: Sequelize.STRING(100), allowNull: false },
      code: { type: Sequelize.STRING(30), allowNull: true },
      capacity: { type: Sequelize.INTEGER, allowNull: true },
      active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      notes: { type: Sequelize.TEXT, allowNull: true },
      ...timestamps,
      deleted_at: { type: Sequelize.DATE, allowNull: true },
    });
    await queryInterface.addIndex('chapels', ['cemetery_id'], { name: 'chapels_cemetery_id_idx' });

    await queryInterface.createTable('schedules', {
      id,
      tenant_id: fk('tenants'),
      cemetery_id: fk('cemeteries'),
      chapel_id: fk('chapels', true),
      grave_id: fk('graves', true),
      deceased_id: fk('deceased', true),
      exhumation_id: fk('exhumations', true),
      // contato/responsável pelo evento
      responsible_person_id: fk('people', true),
      schedule_type: {
        type: Sequelize.ENUM('velorio', 'sepultamento', 'exumacao', 'visita_tecnica', 'outro'),
        allowNull: false,
      },
      title: { type: Sequelize.STRING(200), allowNull: true },
      starts_at: { type: Sequelize.DATE, allowNull: false },
      ends_at: { type: Sequelize.DATE, allowNull: false },
      status: {
        type: Sequelize.ENUM('agendado', 'confirmado', 'em_andamento', 'concluido', 'cancelado'),
        allowNull: false,
        defaultValue: 'agendado',
      },
      created_by_user_id: fk('users', true),
      notes: { type: Sequelize.TEXT, allowNull: true },
      ...timestamps,
    });
    await queryInterface.addIndex('schedules', ['chapel_id', 'starts_at', 'ends_at'], {
      name: 'schedules_chapel_interval_idx',
    });
    await queryInterface.addIndex('schedules', ['grave_id', 'starts_at'], {
      name: 'schedules_grave_starts_at_idx',
    });
    await queryInterface.addIndex('schedules', ['cemetery_id', 'starts_at'], {
      name: 'schedules_cemetery_starts_at_idx',
    });
    await queryInterface.addIndex('schedules', ['tenant_id', 'status'], {
      name: 'schedules_tenant_id_status_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('schedules');
    await queryInterface.dropTable('chapels');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_schedules_schedule_type";');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_schedules_status";');
  },
};
