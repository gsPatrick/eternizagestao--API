'use strict';

/**
 * Cadastros de referência do módulo "Básico" (por cidade / tenant):
 *  - cartorios:     cartórios de registro civil (Nome / Estado / Município principais)
 *  - funeral_homes: funerárias, com bloco de dados de contato
 *  - institutions:  instituições (hospitais, IML, igrejas, etc.)
 *
 * Todas: belongsTo tenants, underscored, paranoid (deleted_at), UUID.
 * Idempotente: só cria tabela/índice se ainda não existir.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const timestamps = {
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
      deleted_at: { type: Sequelize.DATE, allowNull: true },
    };
    const id = {
      type: Sequelize.UUID,
      primaryKey: true,
      defaultValue: Sequelize.literal('gen_random_uuid()'),
    };
    const tenantFk = {
      type: Sequelize.UUID,
      allowNull: false,
      references: { model: 'tenants', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'RESTRICT',
    };

    const existing = (await queryInterface.showAllTables()).map((t) =>
      typeof t === 'string' ? t : t.tableName
    );
    const has = (name) => existing.includes(name);

    // ---------- cartorios ----------
    if (!has('cartorios')) {
      await queryInterface.createTable('cartorios', {
        id,
        tenant_id: tenantFk,
        name: { type: Sequelize.STRING(150), allowNull: false },
        address_state: { type: Sequelize.STRING(2), allowNull: false },
        address_city: { type: Sequelize.STRING(100), allowNull: false },
        cnpj: { type: Sequelize.STRING(18), allowNull: true },
        phone: { type: Sequelize.STRING(20), allowNull: true },
        email: { type: Sequelize.STRING(150), allowNull: true },
        address_street: { type: Sequelize.STRING(150), allowNull: true },
        notes: { type: Sequelize.TEXT, allowNull: true },
        ...timestamps,
      });
      await queryInterface.addIndex('cartorios', ['tenant_id', 'name'], {
        name: 'cartorios_tenant_id_name_idx',
      });
    }

    // ---------- funeral_homes ----------
    if (!has('funeral_homes')) {
      await queryInterface.createTable('funeral_homes', {
        id,
        tenant_id: tenantFk,
        name: { type: Sequelize.STRING(150), allowNull: false },
        cnpj: { type: Sequelize.STRING(18), allowNull: false },
        phone: { type: Sequelize.STRING(20), allowNull: false },
        email: { type: Sequelize.STRING(150), allowNull: true },
        address_street: { type: Sequelize.STRING(150), allowNull: false },
        address_district: { type: Sequelize.STRING(100), allowNull: false },
        address_state: { type: Sequelize.STRING(2), allowNull: false },
        address_city: { type: Sequelize.STRING(100), allowNull: false },
        contact_name: { type: Sequelize.STRING(150), allowNull: true },
        contact_cpf: { type: Sequelize.STRING(14), allowNull: true },
        contact_phone: { type: Sequelize.STRING(20), allowNull: true },
        contact_email: { type: Sequelize.STRING(150), allowNull: true },
        contact_address: { type: Sequelize.STRING(200), allowNull: true },
        notes: { type: Sequelize.TEXT, allowNull: true },
        ...timestamps,
      });
      await queryInterface.addIndex('funeral_homes', ['tenant_id', 'name'], {
        name: 'funeral_homes_tenant_id_name_idx',
      });
    }

    // ---------- institutions ----------
    if (!has('institutions')) {
      await queryInterface.createTable('institutions', {
        id,
        tenant_id: tenantFk,
        name: { type: Sequelize.STRING(150), allowNull: false },
        type: { type: Sequelize.STRING(80), allowNull: true },
        cnpj: { type: Sequelize.STRING(18), allowNull: true },
        phone: { type: Sequelize.STRING(20), allowNull: true },
        email: { type: Sequelize.STRING(150), allowNull: true },
        address_street: { type: Sequelize.STRING(150), allowNull: true },
        address_state: { type: Sequelize.STRING(2), allowNull: true },
        address_city: { type: Sequelize.STRING(100), allowNull: true },
        notes: { type: Sequelize.TEXT, allowNull: true },
        ...timestamps,
      });
      await queryInterface.addIndex('institutions', ['tenant_id', 'name'], {
        name: 'institutions_tenant_id_name_idx',
      });
    }
  },

  async down(queryInterface) {
    await queryInterface.dropTable('institutions');
    await queryInterface.dropTable('funeral_homes');
    await queryInterface.dropTable('cartorios');
  },
};
