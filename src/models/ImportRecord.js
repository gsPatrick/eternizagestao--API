'use strict';

// Linha individual de um lote de importação — raw_data preservado para auditoria.
module.exports = (sequelize, DataTypes) => {
  const ImportRecord = sequelize.define(
    'ImportRecord',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      tenantId: { type: DataTypes.UUID, allowNull: false },
      importBatchId: { type: DataTypes.UUID, allowNull: false },
      rowNumber: { type: DataTypes.INTEGER },
      rawData: { type: DataTypes.JSONB, allowNull: false },
      status: {
        type: DataTypes.ENUM('pendente', 'valido', 'invalido', 'importado', 'ignorado'),
        allowNull: false,
        defaultValue: 'pendente',
      },
      validationErrors: { type: DataTypes.JSONB },
      createdEntityType: { type: DataTypes.STRING(60) },
      createdEntityId: { type: DataTypes.UUID },
    },
    { tableName: 'import_records', underscored: true, timestamps: true }
  );
  return ImportRecord;
};
