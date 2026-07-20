'use strict';

// Concessão: vínculo legal proprietário/concessionário ↔ sepultura.
// O histórico de proprietários é a sequência de concessões da sepultura.
module.exports = (sequelize, DataTypes) => {
  const Concession = sequelize.define(
    'Concession',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      tenantId: { type: DataTypes.UUID, allowNull: false },
      graveId: { type: DataTypes.UUID, allowNull: false },
      personId: { type: DataTypes.UUID, allowNull: false }, // concessionário/PROPRIETÁRIO
      // Responsável LEGAL pelo jazigo (contato/manutenção/obrigações). Pode ser
      // distinto do proprietário — é o que separa /proprietarios de /responsaveis.
      responsiblePersonId: { type: DataTypes.UUID, allowNull: true },
      concessionType: { type: DataTypes.ENUM('perpetua', 'temporaria'), allowNull: false },
      contractNumber: { type: DataTypes.STRING(50) },
      startDate: { type: DataTypes.DATEONLY, allowNull: false },
      endDate: { type: DataTypes.DATEONLY }, // NULL para perpétua
      status: {
        type: DataTypes.ENUM('ativa', 'vencida', 'transferida', 'encerrada', 'cancelada'),
        allowNull: false,
        defaultValue: 'ativa',
      },
      acquisitionMethod: {
        type: DataTypes.ENUM('emissao', 'transferencia', 'heranca', 'regularizacao', 'outro'),
        allowNull: false,
        defaultValue: 'emissao',
      },
      value: { type: DataTypes.DECIMAL(12, 2) },
      notes: { type: DataTypes.TEXT },
    },
    { tableName: 'concessions', underscored: true, timestamps: true, paranoid: true }
  );
  return Concession;
};
