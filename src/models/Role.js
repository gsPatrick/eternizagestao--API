'use strict';

/**
 * Perfil de permissão CUSTOMIZÁVEL por cidade (tenant-scoped).
 *
 * PORQUÊ: o cliente quer criar perfis com permissões escolhidas por ele, sem
 * quebrar os 3 papéis fixos (admin/operador/consulta) em que dezenas de rotas
 * já confiam. A solução é uma CAMADA em cima, não uma troca:
 *  - `baseRole` (admin|operador|consulta) é o TETO de acesso herdado. Ao vincular
 *    um usuário a um Role, gravamos `user.role = role.baseRole`, então o
 *    middleware `authorize(...)` das rotas continua funcionando exatamente igual.
 *  - `permissions` (JSONB { modulo: [acoes] }) REFINA dentro desse teto, checado
 *    pelo middleware opcional `requirePermission`. Nunca amplia o que o baseRole
 *    já permitia.
 *  - `isSystem` marca os 3 perfis padrão (não podem ser apagados/editados).
 */
module.exports = (sequelize, DataTypes) => {
  const Role = sequelize.define(
    'Role',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      tenantId: { type: DataTypes.UUID, allowNull: false },
      name: { type: DataTypes.STRING(80), allowNull: false },
      // Teto de acesso herdado — casa com a coluna `role` (string) do User.
      baseRole: {
        type: DataTypes.ENUM('admin', 'operador', 'consulta'),
        allowNull: false,
        defaultValue: 'consulta',
      },
      // Mapa de permissões granulares: { "sepulturas": ["ver","criar"], ... }
      permissions: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      // Perfis de sistema (os 3 padrão) — protegidos contra exclusão/edição.
      isSystem: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      description: { type: DataTypes.STRING(255), allowNull: true },
    },
    {
      tableName: 'roles',
      underscored: true,
      timestamps: true,
      paranoid: true,
    }
  );
  return Role;
};
