'use strict';

// Lote de importação/migração de dados de sistemas legados.
module.exports = (sequelize, DataTypes) => {
  const ImportBatch = sequelize.define(
    'ImportBatch',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      tenantId: { type: DataTypes.UUID, allowNull: false },
      cemeteryId: { type: DataTypes.UUID },
      sourceName: { type: DataTypes.STRING(150) },
      fileName: { type: DataTypes.STRING(255) },
      fileUrl: { type: DataTypes.STRING(500) },
      entityScope: {
        type: DataTypes.ENUM(
          'sepulturas', 'sepultados', 'proprietarios', 'concessoes', 'cobrancas', 'financeiro', 'misto'
        ),
        allowNull: false,
        defaultValue: 'misto',
      },
      status: {
        type: DataTypes.ENUM('pendente', 'processando', 'validado', 'importado', 'erro', 'cancelado'),
        allowNull: false,
        defaultValue: 'pendente',
      },
      totalRecords: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      validRecords: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      invalidRecords: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      importedRecords: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      errorSummary: { type: DataTypes.JSONB },
      startedAt: { type: DataTypes.DATE },
      finishedAt: { type: DataTypes.DATE },
      createdByUserId: { type: DataTypes.UUID },
      notes: { type: DataTypes.TEXT },
    },
    { tableName: 'import_batches', underscored: true, timestamps: true }
  );
  return ImportBatch;
};
