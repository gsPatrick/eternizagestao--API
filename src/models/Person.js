'use strict';

// Pessoa física (viva) do tenant: proprietário, responsável legal, familiar.
module.exports = (sequelize, DataTypes) => {
  const Person = sequelize.define(
    'Person',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      tenantId: { type: DataTypes.UUID, allowNull: false },
      fullName: { type: DataTypes.STRING(150), allowNull: false },
      cpf: { type: DataTypes.STRING(14) },
      rg: { type: DataTypes.STRING(20) },
      birthDate: { type: DataTypes.DATEONLY },
      gender: { type: DataTypes.STRING(30) },
      email: { type: DataTypes.STRING(150), validate: { isEmail: true } },
      phonePrimary: { type: DataTypes.STRING(20) },
      phoneSecondary: { type: DataTypes.STRING(20) },
      whatsapp: { type: DataTypes.STRING(20) },
      addressStreet: { type: DataTypes.STRING(150) },
      addressNumber: { type: DataTypes.STRING(20) },
      addressComplement: { type: DataTypes.STRING(100) },
      addressDistrict: { type: DataTypes.STRING(100) },
      addressCity: { type: DataTypes.STRING(100) },
      addressState: { type: DataTypes.STRING(2) },
      addressZipcode: { type: DataTypes.STRING(9) },
      photoUrl: { type: DataTypes.STRING(500) },
      notes: { type: DataTypes.TEXT },
      active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    },
    { tableName: 'people', underscored: true, timestamps: true, paranoid: true }
  );
  return Person;
};
