'use strict';

// Cadastro de referência POR CIDADE: instituições (hospitais, IML, igrejas, etc.).
module.exports = (sequelize, DataTypes) => {
  const Institution = sequelize.define(
    'Institution',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      tenantId: { type: DataTypes.UUID, allowNull: false },
      name: { type: DataTypes.STRING(150), allowNull: false },
      type: { type: DataTypes.STRING(80) }, // opcional: hospital, IML, igreja...
      cnpj: { type: DataTypes.STRING(18) },
      phone: { type: DataTypes.STRING(20) },
      email: { type: DataTypes.STRING(150), validate: { isEmail: true } },
      addressStreet: { type: DataTypes.STRING(150) },
      addressState: { type: DataTypes.STRING(2) },
      addressCity: { type: DataTypes.STRING(100) },
      notes: { type: DataTypes.TEXT },
    },
    { tableName: 'institutions', underscored: true, timestamps: true, paranoid: true }
  );
  return Institution;
};
