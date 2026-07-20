'use strict';

// Depósito de restos mortais em nicho do ossário — rastreabilidade completa
// (de onde veio, onde está, para onde foi).
module.exports = (sequelize, DataTypes) => {
  const RemainsDeposit = sequelize.define(
    'RemainsDeposit',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      tenantId: { type: DataTypes.UUID, allowNull: false },
      deceasedId: { type: DataTypes.UUID, allowNull: false },
      exhumationId: { type: DataTypes.UUID },
      ossuaryNicheId: { type: DataTypes.UUID, allowNull: false },
      originGraveId: { type: DataTypes.UUID },
      depositedAt: { type: DataTypes.DATE, allowNull: false },
      removedAt: { type: DataTypes.DATE },
      removalReason: { type: DataTypes.STRING(255) },
      removalDestination: { type: DataTypes.STRING(255) },
      status: {
        type: DataTypes.ENUM('depositado', 'transferido', 'retirado'),
        allowNull: false,
        defaultValue: 'depositado',
      },
      registeredByUserId: { type: DataTypes.UUID },
      notes: { type: DataTypes.TEXT },
    },
    { tableName: 'remains_deposits', underscored: true, timestamps: true }
  );
  return RemainsDeposit;
};
