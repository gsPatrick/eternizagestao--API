'use strict';

// Numerador sequencial de documentos por tenant + tipo + ano.
// Incrementar com SELECT ... FOR UPDATE dentro de transação.
module.exports = (sequelize, DataTypes) => {
  const DocumentSequence = sequelize.define(
    'DocumentSequence',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      tenantId: { type: DataTypes.UUID, allowNull: false },
      documentType: {
        type: DataTypes.ENUM(
          'certidao_perpetuidade',
          'autorizacao_sepultamento',
          'autorizacao_exumacao',
          'recibo',
          'declaracao',
          'outro'
        ),
        allowNull: false,
      },
      year: { type: DataTypes.INTEGER, allowNull: false },
      lastNumber: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    },
    { tableName: 'document_sequences', underscored: true, timestamps: true }
  );
  return DocumentSequence;
};
