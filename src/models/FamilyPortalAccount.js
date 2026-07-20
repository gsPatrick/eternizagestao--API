'use strict';

// Conta de autoatendimento do Portal da Família (login do proprietário/familiar).
module.exports = (sequelize, DataTypes) => {
  const FamilyPortalAccount = sequelize.define(
    'FamilyPortalAccount',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      tenantId: { type: DataTypes.UUID, allowNull: false },
      personId: { type: DataTypes.UUID, allowNull: false },
      email: { type: DataTypes.STRING(150), allowNull: false, validate: { isEmail: true } },
      passwordHash: { type: DataTypes.STRING(255) },
      status: {
        type: DataTypes.ENUM('pendente_ativacao', 'ativo', 'bloqueado'),
        allowNull: false,
        defaultValue: 'pendente_ativacao',
      },
      activationToken: { type: DataTypes.STRING(100) },
      passwordResetToken: { type: DataTypes.STRING(100) },
      passwordResetExpiresAt: { type: DataTypes.DATE },
      lastLoginAt: { type: DataTypes.DATE },
    },
    {
      tableName: 'family_portal_accounts',
      underscored: true,
      timestamps: true,
      defaultScope: { attributes: { exclude: ['passwordHash', 'activationToken', 'passwordResetToken'] } },
      scopes: { withSecrets: { attributes: {} } },
    }
  );
  return FamilyPortalAccount;
};
