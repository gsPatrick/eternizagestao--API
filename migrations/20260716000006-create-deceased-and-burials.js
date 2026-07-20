'use strict';

/**
 * Sepultados:
 *  - deceased: pessoa falecida, com dados civis completos e localização atual
 *    (sepultura, ossário, transladado ou cremado). Foto e certidões via attachments.
 *  - burials: evento de sepultamento (histórico) ligando sepultado ↔ sepultura.
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

    await queryInterface.createTable('deceased', {
      id,
      tenant_id: fk('tenants'),
      full_name: { type: Sequelize.STRING(150), allowNull: false },
      // campos civis opcionais: dados de legado costumam vir incompletos
      cpf: { type: Sequelize.STRING(14), allowNull: true },
      rg: { type: Sequelize.STRING(20), allowNull: true },
      birth_date: { type: Sequelize.DATEONLY, allowNull: true },
      death_date: { type: Sequelize.DATEONLY, allowNull: true },
      death_time: { type: Sequelize.TIME, allowNull: true },
      gender: { type: Sequelize.STRING(30), allowNull: true },
      mother_name: { type: Sequelize.STRING(150), allowNull: true },
      father_name: { type: Sequelize.STRING(150), allowNull: true },
      birthplace: { type: Sequelize.STRING(150), allowNull: true },
      cause_of_death: { type: Sequelize.STRING(255), allowNull: true },
      death_certificate_number: { type: Sequelize.STRING(60), allowNull: true },
      // cartório de registro da certidão de óbito
      death_certificate_registry: { type: Sequelize.STRING(150), allowNull: true },
      photo_url: { type: Sequelize.STRING(500), allowNull: true },
      // localização atual — atualizada pelos fluxos de sepultamento/exumação
      current_grave_id: fk('graves', true),
      current_location_type: {
        type: Sequelize.ENUM('sepultado', 'ossario', 'transladado', 'cremado', 'desconhecido'),
        allowNull: false,
        defaultValue: 'sepultado',
      },
      notes: { type: Sequelize.TEXT, allowNull: true },
      ...timestamps,
      deleted_at: { type: Sequelize.DATE, allowNull: true },
    });
    await queryInterface.addIndex('deceased', ['tenant_id', 'full_name'], {
      name: 'deceased_tenant_id_full_name_idx',
    });
    await queryInterface.addIndex('deceased', ['tenant_id', 'cpf'], { name: 'deceased_tenant_id_cpf_idx' });
    await queryInterface.addIndex('deceased', ['current_grave_id'], { name: 'deceased_current_grave_id_idx' });

    await queryInterface.createTable('burials', {
      id,
      tenant_id: fk('tenants'),
      cemetery_id: fk('cemeteries'),
      grave_id: fk('graves'),
      deceased_id: fk('deceased'),
      burial_date: { type: Sequelize.DATEONLY, allowNull: false },
      burial_time: { type: Sequelize.TIME, allowNull: true },
      // responsável/declarante pelo sepultamento
      declarant_person_id: fk('people', true),
      funeral_home: { type: Sequelize.STRING(150), allowNull: true },
      // nº da autorização de sepultamento emitida (documents.formatted_number)
      authorization_number: { type: Sequelize.STRING(60), allowNull: true },
      status: {
        type: Sequelize.ENUM('ativo', 'exumado', 'transladado'),
        allowNull: false,
        defaultValue: 'ativo',
      },
      registered_by_user_id: fk('users', true),
      notes: { type: Sequelize.TEXT, allowNull: true },
      ...timestamps,
    });
    await queryInterface.addIndex('burials', ['grave_id'], { name: 'burials_grave_id_idx' });
    await queryInterface.addIndex('burials', ['deceased_id'], { name: 'burials_deceased_id_idx' });
    await queryInterface.addIndex('burials', ['tenant_id', 'burial_date'], {
      name: 'burials_tenant_id_burial_date_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('burials');
    await queryInterface.dropTable('deceased');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_burials_status";');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_deceased_current_location_type";');
  },
};
