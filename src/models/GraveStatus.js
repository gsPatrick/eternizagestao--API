'use strict';

// Situação operacional da sepultura — cadastrável por tenant.
// tenant_id NULL => status de sistema (livre, ocupada, reservada, etc.).
module.exports = (sequelize, DataTypes) => {
  const GraveStatus = sequelize.define(
    'GraveStatus',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      tenantId: { type: DataTypes.UUID, allowNull: true },
      name: { type: DataTypes.STRING(80), allowNull: false },
      slug: { type: DataTypes.STRING(50), allowNull: false },
      color: { type: DataTypes.STRING(7) },
      allowsBurial: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      isSystem: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    },
    { tableName: 'grave_statuses', underscored: true, timestamps: true }
  );
  return GraveStatus;
};
