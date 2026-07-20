'use strict';

// Cadastro de referência POR CIDADE: funerárias do tenant, com bloco de contato.
module.exports = (sequelize, DataTypes) => {
  const FuneralHome = sequelize.define(
    'FuneralHome',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      tenantId: { type: DataTypes.UUID, allowNull: false },
      name: { type: DataTypes.STRING(150), allowNull: false },
      cnpj: { type: DataTypes.STRING(18), allowNull: false },
      phone: { type: DataTypes.STRING(20), allowNull: false },
      email: { type: DataTypes.STRING(150), validate: { isEmail: true } },
      addressStreet: { type: DataTypes.STRING(150), allowNull: false },
      addressDistrict: { type: DataTypes.STRING(100), allowNull: false }, // bairro
      addressState: { type: DataTypes.STRING(2), allowNull: false }, // UF
      addressCity: { type: DataTypes.STRING(100), allowNull: false }, // município
      // ---- Contato (pessoa de referência na funerária) ----
      contactName: { type: DataTypes.STRING(150) },
      contactCpf: { type: DataTypes.STRING(14) },
      contactPhone: { type: DataTypes.STRING(20) },
      contactEmail: { type: DataTypes.STRING(150) },
      contactAddress: { type: DataTypes.STRING(200) },
      notes: { type: DataTypes.TEXT }, // observação
    },
    { tableName: 'funeral_homes', underscored: true, timestamps: true, paranoid: true }
  );
  return FuneralHome;
};
