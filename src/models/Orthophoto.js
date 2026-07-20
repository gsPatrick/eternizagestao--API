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
      // bounds: retângulo alinhado ao norte { sw:[lat,lng], ne:[lat,lng] } (legado).
      bounds: { type: DataTypes.JSONB },
      // corners: georreferência por 4 cantos da ortofoto POSICIONADA sobre o mapa.
      // O operador arrasta/escala/rotaciona a imagem; cada canto vira lat/lng real.
      // Shape: { tl:[lat,lng], tr:[lat,lng], br:[lat,lng], bl:[lat,lng] }
      //   tl=top-left, tr=top-right, br=bottom-right, bl=bottom-left.
      corners: { type: DataTypes.JSONB },
      // opacity: opacidade da ortofoto sobre a base OpenStreetMap (0..1).
      opacity: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0.85 },
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
