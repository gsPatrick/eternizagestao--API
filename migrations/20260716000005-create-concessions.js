'use strict';

/**
 * Concessões e histórico de proprietários:
 *  - concessions: vínculo legal pessoa ↔ sepultura (tipo, vigência, status).
 *    O histórico de proprietários é a sequência de concessões da sepultura.
 *  - concession_transfers: registro formal de cada transferência
 *    (venda, doação, herança com vínculo familiar, decisão judicial...).
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

    await queryInterface.createTable('concessions', {
      id,
      tenant_id: fk('tenants'),
      grave_id: fk('graves'),
      // concessionário/proprietário responsável legal
      person_id: fk('people'),
      concession_type: {
        type: Sequelize.ENUM('perpetua', 'temporaria'),
        allowNull: false,
      },
      contract_number: { type: Sequelize.STRING(50), allowNull: true },
      start_date: { type: Sequelize.DATEONLY, allowNull: false },
      // NULL para concessão perpétua
      end_date: { type: Sequelize.DATEONLY, allowNull: true },
      status: {
        type: Sequelize.ENUM('ativa', 'vencida', 'transferida', 'encerrada', 'cancelada'),
        allowNull: false,
        defaultValue: 'ativa',
      },
      acquisition_method: {
        type: Sequelize.ENUM('emissao', 'transferencia', 'heranca', 'regularizacao', 'outro'),
        allowNull: false,
        defaultValue: 'emissao',
      },
      value: { type: Sequelize.DECIMAL(12, 2), allowNull: true },
      notes: { type: Sequelize.TEXT, allowNull: true },
      ...timestamps,
      deleted_at: { type: Sequelize.DATE, allowNull: true },
    });
    await queryInterface.addIndex('concessions', ['grave_id'], { name: 'concessions_grave_id_idx' });
    await queryInterface.addIndex('concessions', ['person_id'], { name: 'concessions_person_id_idx' });
    await queryInterface.addIndex('concessions', ['tenant_id', 'status'], {
      name: 'concessions_tenant_id_status_idx',
    });

    await queryInterface.createTable('concession_transfers', {
      id,
      tenant_id: fk('tenants'),
      grave_id: fk('graves'),
      from_concession_id: fk('concessions'),
      to_concession_id: fk('concessions'),
      from_person_id: fk('people', true),
      to_person_id: fk('people', true),
      transfer_reason: {
        type: Sequelize.ENUM('venda', 'doacao', 'heranca', 'decisao_judicial', 'regularizacao', 'outro'),
        allowNull: false,
      },
      // grau de parentesco quando a transferência for por herança/vínculo familiar
      family_relationship: { type: Sequelize.STRING(50), allowNull: true },
      transfer_date: { type: Sequelize.DATEONLY, allowNull: false },
      registered_by_user_id: fk('users', true),
      notes: { type: Sequelize.TEXT, allowNull: true },
      ...timestamps,
    });
    await queryInterface.addIndex('concession_transfers', ['grave_id'], {
      name: 'concession_transfers_grave_id_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('concession_transfers');
    await queryInterface.dropTable('concessions');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_concessions_concession_type";');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_concessions_status";');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_concessions_acquisition_method";');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_concession_transfers_transfer_reason";');
  },
};
