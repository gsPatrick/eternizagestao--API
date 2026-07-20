'use strict';

// Foto aérea georreferenciada usada como base do mapa do cemitério.
module.exports = (sequelize, DataTypes) => {
  const Orthophoto = sequelize.define(
    'Orthophoto',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      tenantId: { type: DataTypes.UUID, allowNull: false },
      cemeteryId: { type: DataTypes.UUID, allowNull: false },
      name: { type: DataTypes.STRING(150), allowNull: false },
      fileUrl: { type: DataTypes.STRING(500), allowNull: false },
      bounds: { type: DataTypes.JSONB },
      widthPx: { type: DataTypes.INTEGER },
      heightPx: { type: DataTypes.INTEGER },
      resolutionCmPx: { type: DataTypes.DECIMAL(8, 3) },
      capturedAt: { type: DataTypes.DATEONLY },
      isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    },
    { tableName: 'orthophotos', underscored: true, timestamps: true }
  );
  return Orthophoto;
};
