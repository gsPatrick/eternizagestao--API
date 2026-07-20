'use strict';

// Ossário / depósito de ossos de um cemitério.
module.exports = (sequelize, DataTypes) => {
  const Ossuary = sequelize.define(
    'Ossuary',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      tenantId: { type: DataTypes.UUID, allowNull: false },
      cemeteryId: { type: DataTypes.UUID, allowNull: false },
      name: { type: DataTypes.STRING(150), allowNull: false },
      code: { type: DataTypes.STRING(30) },
      description: { type: DataTypes.TEXT },
      latitude: { type: DataTypes.DECIMAL(10, 7) },
      longitude: { type: DataTypes.DECIMAL(10, 7) },
      geoPolygon: { type: DataTypes.JSONB },
      active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    },
    { tableName: 'ossuaries', underscored: true, timestamps: true, paranoid: true }
  );
  return Ossuary;
};
