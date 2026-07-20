'use strict';

// Taxa de manutenção aplicada a um jazigo, vinculada ao proprietário pagador.
// Base para a geração automática de cobranças (billings).
module.exports = (sequelize, DataTypes) => {
  const MaintenanceFee = sequelize.define(
    'MaintenanceFee',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      tenantId: { type: DataTypes.UUID, allowNull: false },
      graveId: { type: DataTypes.UUID, allowNull: false },
      feeTypeId: { type: DataTypes.UUID, allowNull: false },
      concessionId: { type: DataTypes.UUID },
      payerPersonId: { type: DataTypes.UUID, allowNull: false },
      amount: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
      periodicity: {
        type: DataTypes.ENUM('mensal', 'trimestral', 'semestral', 'anual', 'unica'),
        allowNull: false,
      },
      dueDay: { type: DataTypes.INTEGER, validate: { min: 1, max: 31 } },
      dueMonth: { type: DataTypes.INTEGER, validate: { min: 1, max: 12 } },
      nextDueDate: { type: DataTypes.DATEONLY },
      lastAdjustedAt: { type: DataTypes.DATEONLY },
      adjustmentNotes: { type: DataTypes.STRING(255) },
      // Histórico de reajustes desta taxa: [{ date, from, to, reason }].
      // Alimenta o painel "Histórico de reajustes" e o reajuste em lote.
      adjustments: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      status: {
        type: DataTypes.ENUM('ativa', 'suspensa', 'encerrada'),
        allowNull: false,
        defaultValue: 'ativa',
      },
      notes: { type: DataTypes.TEXT },
    },
    { tableName: 'maintenance_fees', underscored: true, timestamps: true, paranoid: true }
  );
  return MaintenanceFee;
};
