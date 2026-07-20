'use strict';

// Catálogo de tipos de taxa do tenant (manutenção anual, serviço de sepultamento...).
module.exports = (sequelize, DataTypes) => {
  const FeeType = sequelize.define(
    'FeeType',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      tenantId: { type: DataTypes.UUID, allowNull: false },
      name: { type: DataTypes.STRING(100), allowNull: false },
      description: { type: DataTypes.TEXT },
      defaultAmount: { type: DataTypes.DECIMAL(12, 2) },
      periodicity: {
        type: DataTypes.ENUM('mensal', 'trimestral', 'semestral', 'anual', 'unica'),
        allowNull: false,
        defaultValue: 'anual',
      },
      active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    },
    { tableName: 'fee_types', underscored: true, timestamps: true, paranoid: true }
  );
  return FeeType;
};
