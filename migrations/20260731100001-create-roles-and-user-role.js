'use strict';

/**
 * RBAC customizável: cria a tabela `roles` (perfis de permissão por cidade) e
 * adiciona `users.role_id` (FK opcional para o perfil customizado).
 *
 * Desenho de segurança (ver src/models/Role.js): o perfil herda um `base_role`
 * (admin|operador|consulta) que é gravado em `users.role`, então o middleware
 * `authorize(...)` das rotas existentes NÃO muda de comportamento — o perfil
 * customizado só refina o acesso via permissões granulares (JSONB).
 *
 * Idempotente: só cria a tabela/coluna/índice se ainda não existir.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const existing = (await queryInterface.showAllTables()).map((t) =>
      typeof t === 'string' ? t : t.tableName
    );

    if (!existing.includes('roles')) {
      await queryInterface.createTable('roles', {
        id: {
          type: Sequelize.UUID,
          primaryKey: true,
          defaultValue: Sequelize.literal('gen_random_uuid()'),
        },
        tenant_id: {
          type: Sequelize.UUID,
          allowNull: false,
          references: { model: 'tenants', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE',
        },
        name: { type: Sequelize.STRING(80), allowNull: false },
        base_role: {
          type: Sequelize.ENUM('admin', 'operador', 'consulta'),
          allowNull: false,
          defaultValue: 'consulta',
        },
        permissions: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
        is_system: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
        description: { type: Sequelize.STRING(255), allowNull: true },
        created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
        updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
        deleted_at: { type: Sequelize.DATE, allowNull: true },
      });
      // Nome do perfil único POR CIDADE (ignora linhas soft-deleted via where).
      await queryInterface.addIndex('roles', ['tenant_id', 'name'], {
        name: 'roles_tenant_id_name_unique',
        unique: true,
        where: { deleted_at: null },
      });
    }

    // users.role_id (FK opcional). SET NULL no delete do perfil: um perfil só é
    // apagável quando não está em uso (regra do service), mas o SET NULL é a
    // defesa final para nunca deixar um usuário órfão de FK.
    const usersTable = await queryInterface.describeTable('users');
    if (!usersTable.role_id) {
      await queryInterface.addColumn('users', 'role_id', {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'roles', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      });
    }
  },

  async down(queryInterface) {
    const usersTable = await queryInterface.describeTable('users');
    if (usersTable.role_id) await queryInterface.removeColumn('users', 'role_id');
    await queryInterface.dropTable('roles');
    // Remove o tipo ENUM criado pelo Postgres para roles.base_role.
    await queryInterface.sequelize
      .query('DROP TYPE IF EXISTS "enum_roles_base_role";')
      .catch(() => {});
  },
};
