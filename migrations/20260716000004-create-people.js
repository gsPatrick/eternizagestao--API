'use strict';

/**
 * Pessoas (vivas) e autoatendimento:
 *  - people: registro único de pessoa física do tenant — proprietários,
 *    responsáveis legais, declarantes, familiares.
 *  - person_relationships: vínculos familiares entre pessoas.
 *  - family_portal_accounts: credenciais do Portal da Família.
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

    await queryInterface.createTable('people', {
      id,
      tenant_id: fk('tenants'),
      full_name: { type: Sequelize.STRING(150), allowNull: false },
      cpf: { type: Sequelize.STRING(14), allowNull: true },
      rg: { type: Sequelize.STRING(20), allowNull: true },
      birth_date: { type: Sequelize.DATEONLY, allowNull: true },
      gender: { type: Sequelize.STRING(30), allowNull: true },
      email: { type: Sequelize.STRING(150), allowNull: true },
      phone_primary: { type: Sequelize.STRING(20), allowNull: true },
      phone_secondary: { type: Sequelize.STRING(20), allowNull: true },
      // número usado pelas notificações automáticas
      whatsapp: { type: Sequelize.STRING(20), allowNull: true },
      address_street: { type: Sequelize.STRING(150), allowNull: true },
      address_number: { type: Sequelize.STRING(20), allowNull: true },
      address_complement: { type: Sequelize.STRING(100), allowNull: true },
      address_district: { type: Sequelize.STRING(100), allowNull: true },
      address_city: { type: Sequelize.STRING(100), allowNull: true },
      address_state: { type: Sequelize.STRING(2), allowNull: true },
      address_zipcode: { type: Sequelize.STRING(9), allowNull: true },
      photo_url: { type: Sequelize.STRING(500), allowNull: true },
      notes: { type: Sequelize.TEXT, allowNull: true },
      active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      ...timestamps,
      deleted_at: { type: Sequelize.DATE, allowNull: true },
    });
    await queryInterface.addIndex('people', ['tenant_id', 'cpf'], {
      unique: true,
      name: 'people_tenant_id_cpf_unique',
    });
    await queryInterface.addIndex('people', ['tenant_id', 'full_name'], {
      name: 'people_tenant_id_full_name_idx',
    });

    await queryInterface.createTable('person_relationships', {
      id,
      tenant_id: fk('tenants'),
      person_id: fk('people', false, 'CASCADE'),
      related_person_id: fk('people', false, 'CASCADE'),
      // tipo livre (pai, mae, filho(a), conjuge, irmao(a), neto(a), ...)
      relationship_type: { type: Sequelize.STRING(50), allowNull: false },
      notes: { type: Sequelize.STRING(255), allowNull: true },
      ...timestamps,
    });
    await queryInterface.addIndex(
      'person_relationships',
      ['person_id', 'related_person_id', 'relationship_type'],
      { unique: true, name: 'person_relationships_unique' }
    );

    await queryInterface.createTable('family_portal_accounts', {
      id,
      tenant_id: fk('tenants'),
      person_id: fk('people', false, 'CASCADE'),
      email: { type: Sequelize.STRING(150), allowNull: false },
      password_hash: { type: Sequelize.STRING(255), allowNull: true },
      status: {
        type: Sequelize.ENUM('pendente_ativacao', 'ativo', 'bloqueado'),
        allowNull: false,
        defaultValue: 'pendente_ativacao',
      },
      activation_token: { type: Sequelize.STRING(100), allowNull: true },
      password_reset_token: { type: Sequelize.STRING(100), allowNull: true },
      password_reset_expires_at: { type: Sequelize.DATE, allowNull: true },
      last_login_at: { type: Sequelize.DATE, allowNull: true },
      ...timestamps,
    });
    await queryInterface.addIndex('family_portal_accounts', ['tenant_id', 'email'], {
      unique: true,
      name: 'family_portal_accounts_tenant_id_email_unique',
    });
    await queryInterface.addIndex('family_portal_accounts', ['person_id'], {
      unique: true,
      name: 'family_portal_accounts_person_id_unique',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('family_portal_accounts');
    await queryInterface.dropTable('person_relationships');
    await queryInterface.dropTable('people');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_family_portal_accounts_status";');
  },
};
