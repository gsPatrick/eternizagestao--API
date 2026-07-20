'use strict';

// Exportação de dados/relatórios para cartórios e órgãos municipais.
module.exports = (sequelize, DataTypes) => {
  const DataExport = sequelize.define(
    'DataExport',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      tenantId: { type: DataTypes.UUID, allowNull: false },
      cemeteryId: { type: DataTypes.UUID },
      exportType: {
        type: DataTypes.ENUM(
          'cartorio',
          'orgao_municipal',
          'ocupacao',
          'financeiro',
          'sepultamentos',
          'exumacoes',
          'inadimplencia',
          'outro'
        ),
        allowNull: false,
      },
      format: {
        type: DataTypes.ENUM('pdf', 'csv', 'xlsx', 'xml', 'json'),
        allowNull: false,
        defaultValue: 'pdf',
      },
      periodStart: { type: DataTypes.DATEONLY },
      periodEnd: { type: DataTypes.DATEONLY },
      parameters: { type: DataTypes.JSONB },
      fileUrl: { type: DataTypes.STRING(500) },
      status: {
        type: DataTypes.ENUM('pendente', 'processando', 'concluido', 'erro'),
        allowNull: false,
        defaultValue: 'pendente',
      },
      errorMessage: { type: DataTypes.TEXT },
      requestedByUserId: { type: DataTypes.UUID },
      generatedAt: { type: DataTypes.DATE },
    },
    { tableName: 'data_exports', underscored: true, timestamps: true }
  );
  return DataExport;
};
