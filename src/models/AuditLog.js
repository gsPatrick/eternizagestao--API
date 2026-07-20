'use strict';

// Log imutável de ações (usuário admin ou conta do Portal da Família).
// Apenas created_at — registros nunca são atualizados ou excluídos.
module.exports = (sequelize, DataTypes) => {
  const AuditLog = sequelize.define(
    'AuditLog',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      tenantId: { type: DataTypes.UUID },
      userId: { type: DataTypes.UUID },
      portalAccountId: { type: DataTypes.UUID },
      action: { type: DataTypes.STRING(60), allowNull: false },
      entityType: { type: DataTypes.STRING(60) },
      entityId: { type: DataTypes.UUID },
      description: { type: DataTypes.STRING(255) },
      previousData: { type: DataTypes.JSONB },
      newData: { type: DataTypes.JSONB },
      ipAddress: { type: DataTypes.STRING(45) },
      userAgent: { type: DataTypes.STRING(255) },
    },
    { tableName: 'audit_logs', underscored: true, timestamps: true, updatedAt: false }
  );
  return AuditLog;
};
