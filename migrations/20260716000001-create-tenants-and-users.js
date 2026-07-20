'use strict';

/**
 * Base multi-tenant (white label):
 *  - tenants: órgão gestor (prefeitura/concessionária) com subdomínio isolado,
 *    identidade visual e dados para cabeçalho de documentos oficiais.
 *  - users: usuários administrativos com perfil de acesso.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    // gen_random_uuid() — nativa a partir do PG13 via pgcrypto
    await queryInterface.sequelize.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto";');

    await queryInterface.createTable('tenants', {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
      },
      name: { type: Sequelize.STRING(150), allowNull: false },
      legal_name: { type: Sequelize.STRING(200), allowNull: true },
      cnpj: { type: Sequelize.STRING(18), allowNull: true },
      // subdomínio isolado por cliente: <subdomain>.plataforma.com
      subdomain: { type: Sequelize.STRING(63), allowNull: false, unique: true },
      logo_url: { type: Sequelize.STRING(500), allowNull: true },
      primary_color: { type: Sequelize.STRING(7), allowNull: true },
      secondary_color: { type: Sequelize.STRING(7), allowNull: true },
      email: { type: Sequelize.STRING(150), allowNull: true },
      phone: { type: Sequelize.STRING(20), allowNull: true },
      whatsapp: { type: Sequelize.STRING(20), allowNull: true },
      address_street: { type: Sequelize.STRING(150), allowNull: true },
      address_number: { type: Sequelize.STRING(20), allowNull: true },
      address_complement: { type: Sequelize.STRING(100), allowNull: true },
      address_district: { type: Sequelize.STRING(100), allowNull: true },
      address_city: { type: Sequelize.STRING(100), allowNull: true },
      address_state: { type: Sequelize.STRING(2), allowNull: true },
      address_zipcode: { type: Sequelize.STRING(9), allowNull: true },
      // dados livres para cabeçalho/rodapé de documentos oficiais do órgão
      document_header: { type: Sequelize.JSONB, allowNull: true },
      // configurações gerais do tenant (gateway, whatsapp provider, etc.)
      settings: { type: Sequelize.JSONB, allowNull: true },
      active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
      deleted_at: { type: Sequelize.DATE, allowNull: true },
    });

    await queryInterface.createTable('users', {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
      },
      // null => usuário da plataforma (super_admin, sem tenant)
      tenant_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'tenants', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      name: { type: Sequelize.STRING(150), allowNull: false },
      email: { type: Sequelize.STRING(150), allowNull: false },
      password_hash: { type: Sequelize.STRING(255), allowNull: false },
      role: {
        type: Sequelize.ENUM('super_admin', 'admin', 'operador', 'consulta'),
        allowNull: false,
        defaultValue: 'operador',
      },
      active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      last_login_at: { type: Sequelize.DATE, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
      deleted_at: { type: Sequelize.DATE, allowNull: true },
    });

    await queryInterface.addIndex('users', ['tenant_id', 'email'], {
      unique: true,
      name: 'users_tenant_id_email_unique',
    });
    await queryInterface.addIndex('users', ['tenant_id'], { name: 'users_tenant_id_idx' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('users');
    await queryInterface.dropTable('tenants');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_users_role";');
  },
};
