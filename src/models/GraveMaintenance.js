'use strict';

// Reforma/obra/manutenção física da sepultura.
module.exports = (sequelize, DataTypes) => {
  const GraveMaintenance = sequelize.define(
    'GraveMaintenance',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      tenantId: { type: DataTypes.UUID, allowNull: false },
      graveId: { type: DataTypes.UUID, allowNull: false },
      maintenanceType: {
        type: DataTypes.ENUM('reforma', 'construcao', 'limpeza', 'pintura', 'reparo', 'outro'),
        allowNull: false,
      },
      description: { type: DataTypes.TEXT },
      requestedByPersonId: { type: DataTypes.UUID },
      status: {
        type: DataTypes.ENUM('solicitada', 'autorizada', 'em_andamento', 'concluida', 'cancelada'),
        allowNull: false,
        defaultValue: 'solicitada',
      },
      startDate: { type: DataTypes.DATEONLY },
      endDate: { type: DataTypes.DATEONLY },
      cost: { type: DataTypes.DECIMAL(12, 2) },
      performedBy: { type: DataTypes.STRING(150) },
      registeredByUserId: { type: DataTypes.UUID },
      notes: { type: DataTypes.TEXT },
    },
    { tableName: 'grave_maintenances', underscored: true, timestamps: true }
  );
  return GraveMaintenance;
};
