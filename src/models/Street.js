'use strict';

// Rua — pertence a uma quadra.
module.exports = (sequelize, DataTypes) => {
  const Street = sequelize.define(
    'Street',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      tenantId: { type: DataTypes.UUID, allowNull: false },
      cemeteryId: { type: DataTypes.UUID, allowNull: false },
      blockId: { type: DataTypes.UUID, allowNull: false },
      name: { type: DataTypes.STRING(100), allowNull: false },
      code: { type: DataTypes.STRING(30), allowNull: false },
      geoPolygon: { type: DataTypes.JSONB },
      notes: { type: DataTypes.TEXT },
    },
    { tableName: 'streets', underscored: true, timestamps: true, paranoid: true }
  );
  return Street;
};
