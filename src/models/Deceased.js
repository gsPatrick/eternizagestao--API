'use strict';

// Sepultado (pessoa falecida). Localização atual mantida pelos fluxos de
// sepultamento/exumação; histórico completo em burials/exhumations/remains_deposits.
module.exports = (sequelize, DataTypes) => {
  const Deceased = sequelize.define(
    'Deceased',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      tenantId: { type: DataTypes.UUID, allowNull: false },
      fullName: { type: DataTypes.STRING(150), allowNull: false },
      cpf: { type: DataTypes.STRING(14) },
      rg: { type: DataTypes.STRING(20) },
      birthDate: { type: DataTypes.DATEONLY },
      deathDate: { type: DataTypes.DATEONLY },
      deathTime: { type: DataTypes.TIME },
      gender: { type: DataTypes.STRING(30) },
      motherName: { type: DataTypes.STRING(150) },
      fatherName: { type: DataTypes.STRING(150) },
      birthplace: { type: DataTypes.STRING(150) },
      causeOfDeath: { type: DataTypes.STRING(255) },
      deathCertificateNumber: { type: DataTypes.STRING(60) },
      deathCertificateRegistry: { type: DataTypes.STRING(150) },
      photoUrl: { type: DataTypes.STRING(500) },
      currentGraveId: { type: DataTypes.UUID },
      currentLocationType: {
        type: DataTypes.ENUM('sepultado', 'ossario', 'transladado', 'cremado', 'desconhecido'),
        allowNull: false,
        defaultValue: 'sepultado',
      },
      notes: { type: DataTypes.TEXT },
    },
    { tableName: 'deceased', underscored: true, timestamps: true, paranoid: true }
  );
  return Deceased;
};
