'use strict';

// Transferência de titularidade da concessão (venda, doação, herança...).
module.exports = (sequelize, DataTypes) => {
  const ConcessionTransfer = sequelize.define(
    'ConcessionTransfer',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      tenantId: { type: DataTypes.UUID, allowNull: false },
      graveId: { type: DataTypes.UUID, allowNull: false },
      fromConcessionId: { type: DataTypes.UUID, allowNull: false },
      toConcessionId: { type: DataTypes.UUID, allowNull: false },
      fromPersonId: { type: DataTypes.UUID },
      toPersonId: { type: DataTypes.UUID },
      transferReason: {
        type: DataTypes.ENUM('venda', 'doacao', 'heranca', 'decisao_judicial', 'regularizacao', 'outro'),
        allowNull: false,
      },
      // grau de parentesco quando por herança/vínculo familiar
      familyRelationship: { type: DataTypes.STRING(50) },
      transferDate: { type: DataTypes.DATEONLY, allowNull: false },
      registeredByUserId: { type: DataTypes.UUID },
      notes: { type: DataTypes.TEXT },
    },
    { tableName: 'concession_transfers', underscored: true, timestamps: true }
  );
  return ConcessionTransfer;
};
