'use strict';

// Capela / sala de velório de um cemitério.
module.exports = (sequelize, DataTypes) => {
  const Chapel = sequelize.define(
    'Chapel',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      tenantId: { type: DataTypes.UUID, allowNull: false },
      cemeteryId: { type: DataTypes.UUID, allowNull: false },
      name: { type: DataTypes.STRING(100), allowNull: false },
      code: { type: DataTypes.STRING(30) },
      capacity: { type: DataTypes.INTEGER },
      active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      notes: { type: DataTypes.TEXT },
    },
    { tableName: 'chapels', underscored: true, timestamps: true, paranoid: true }
  );
  return Chapel;
};
