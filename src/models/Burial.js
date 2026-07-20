'use strict';

// Evento de sepultamento — liga o sepultado à sepultura em uma data.
module.exports = (sequelize, DataTypes) => {
  const Burial = sequelize.define(
    'Burial',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      tenantId: { type: DataTypes.UUID, allowNull: false },
      cemeteryId: { type: DataTypes.UUID, allowNull: false },
      graveId: { type: DataTypes.UUID, allowNull: false },
      deceasedId: { type: DataTypes.UUID, allowNull: false },
      burialDate: { type: DataTypes.DATEONLY, allowNull: false },
      burialTime: { type: DataTypes.TIME },
      declarantPersonId: { type: DataTypes.UUID },
      funeralHome: { type: DataTypes.STRING(150) },
      // nº da Autorização de Sepultamento emitida (documents.formatted_number)
      authorizationNumber: { type: DataTypes.STRING(60) },
      status: {
        type: DataTypes.ENUM('ativo', 'exumado', 'transladado'),
        allowNull: false,
        defaultValue: 'ativo',
      },
      registeredByUserId: { type: DataTypes.UUID },
      notes: { type: DataTypes.TEXT },
    },
    { tableName: 'burials', underscored: true, timestamps: true }
  );
  return Burial;
};
