'use strict';

// Código de recuperação de senha (6 dígitos) do painel e do Portal da Família.
// Só o HASH do código é persistido; um código vale enquanto usedAt e
// invalidatedAt forem NULL e expiresAt estiver no futuro.
module.exports = (sequelize, DataTypes) => {
  const PasswordReset = sequelize.define(
    'PasswordReset',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      tenantId: { type: DataTypes.UUID, allowNull: true },
      origin: { type: DataTypes.ENUM('admin', 'portal'), allowNull: false },
      email: { type: DataTypes.STRING(150), allowNull: false },
      // users.id (admin) ou family_portal_accounts.id (portal) — sem FK de propósito
      targetId: { type: DataTypes.UUID, allowNull: true },
      codeHash: { type: DataTypes.STRING(255), allowNull: false },
      attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      expiresAt: { type: DataTypes.DATE, allowNull: false },
      usedAt: { type: DataTypes.DATE, allowNull: true },
      invalidatedAt: { type: DataTypes.DATE, allowNull: true },
      requestIp: { type: DataTypes.STRING(45), allowNull: true },
    },
    {
      tableName: 'password_resets',
      underscored: true,
      timestamps: true,
      // O hash do código nunca sai em consultas comuns — só o escopo explícito
      // usado pelo serviço de verificação enxerga a coluna.
      defaultScope: { attributes: { exclude: ['codeHash'] } },
      scopes: { withCode: { attributes: {} } },
    }
  );
  return PasswordReset;
};
