'use strict';

// Lote/Talhão — pertence a uma rua; contém as sepulturas.
module.exports = (sequelize, DataTypes) => {
  const Lot = sequelize.define(
    'Lot',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      tenantId: { type: DataTypes.UUID, allowNull: false },
      cemeteryId: { type: DataTypes.UUID, allowNull: false },
      streetId: { type: DataTypes.UUID, allowNull: false },
      name: { type: DataTypes.STRING(100) },
      code: { type: DataTypes.STRING(30), allowNull: false },
      geoPolygon: { type: DataTypes.JSONB },
      notes: { type: DataTypes.TEXT },
    },
    { tableName: 'lots', underscored: true, timestamps: true, paranoid: true }
  );
  return Lot;
};
