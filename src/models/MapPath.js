'use strict';

// Polilinha caminhável do cemitério — malha usada na navegação GPS do visitante.
module.exports = (sequelize, DataTypes) => {
  const MapPath = sequelize.define(
    'MapPath',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      tenantId: { type: DataTypes.UUID, allowNull: false },
      cemeteryId: { type: DataTypes.UUID, allowNull: false },
      name: { type: DataTypes.STRING(150) },
      pathCoordinates: { type: DataTypes.JSONB, allowNull: false },
      isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      notes: { type: DataTypes.TEXT },
    },
    { tableName: 'map_paths', underscored: true, timestamps: true }
  );
  return MapPath;
};
