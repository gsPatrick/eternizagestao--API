'use strict';

// Quadra — primeiro nível da hierarquia espacial do cemitério.
module.exports = (sequelize, DataTypes) => {
  const Block = sequelize.define(
    'Block',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      tenantId: { type: DataTypes.UUID, allowNull: false },
      cemeteryId: { type: DataTypes.UUID, allowNull: false },
      name: { type: DataTypes.STRING(100), allowNull: false },
      code: { type: DataTypes.STRING(30), allowNull: false },
      geoPolygon: { type: DataTypes.JSONB },
      notes: { type: DataTypes.TEXT },
    },
    { tableName: 'blocks', underscored: true, timestamps: true, paranoid: true }
  );
  return Block;
};
