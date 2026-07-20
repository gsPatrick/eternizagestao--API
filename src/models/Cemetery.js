'use strict';

// Cemitério administrado por um tenant (um tenant pode ter vários).
module.exports = (sequelize, DataTypes) => {
  const Cemetery = sequelize.define(
    'Cemetery',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      tenantId: { type: DataTypes.UUID, allowNull: false },
      name: { type: DataTypes.STRING(150), allowNull: false },
      code: { type: DataTypes.STRING(30) },
      description: { type: DataTypes.TEXT },
      addressStreet: { type: DataTypes.STRING(150) },
      addressNumber: { type: DataTypes.STRING(20) },
      addressDistrict: { type: DataTypes.STRING(100) },
      addressCity: { type: DataTypes.STRING(100) },
      addressState: { type: DataTypes.STRING(2) },
      addressZipcode: { type: DataTypes.STRING(9) },
      entranceLatitude: { type: DataTypes.DECIMAL(10, 7) },
      entranceLongitude: { type: DataTypes.DECIMAL(10, 7) },
      geoPolygon: { type: DataTypes.JSONB },
      logoUrl: { type: DataTypes.STRING(500) },
      // Identidade visual — cores usadas em documentos/portais deste cemitério.
      brandPrimaryColor: { type: DataTypes.STRING(7) },
      brandSecondaryColor: { type: DataTypes.STRING(7) },
      // Órgão gestor — cabeçalho das certidões/autorizações/recibos.
      managerName: { type: DataTypes.STRING(150) },
      managerDocument: { type: DataTypes.STRING(20) }, // CNPJ
      managerPhone: { type: DataTypes.STRING(20) },
      managerEmail: { type: DataTypes.STRING(150) },
      active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      notes: { type: DataTypes.TEXT },
    },
    { tableName: 'cemeteries', underscored: true, timestamps: true, paranoid: true }
  );
  return Cemetery;
};
