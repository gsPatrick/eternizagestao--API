'use strict';

// Cadastro de referência POR CIDADE: cartórios (registro civil) do tenant.
// O cliente exibe Nome / Estado / Município como campos principais.
module.exports = (sequelize, DataTypes) => {
  const Cartorio = sequelize.define(
    'Cartorio',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      tenantId: { type: DataTypes.UUID, allowNull: false },
      name: { type: DataTypes.STRING(150), allowNull: false },
      addressState: { type: DataTypes.STRING(2), allowNull: false }, // UF
      addressCity: { type: DataTypes.STRING(100), allowNull: false }, // município
      cnpj: { type: DataTypes.STRING(18) },
      phone: { type: DataTypes.STRING(20) },
      email: { type: DataTypes.STRING(150), validate: { isEmail: true } },
      addressStreet: { type: DataTypes.STRING(150) },
      notes: { type: DataTypes.TEXT },
    },
    { tableName: 'cartorios', underscored: true, timestamps: true, paranoid: true }
  );
  return Cartorio;
};
