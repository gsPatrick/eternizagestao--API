'use strict';

// Modelo oficial de documento fornecido pelo cliente (certidão, autorização...).
module.exports = (sequelize, DataTypes) => {
  const DocumentTemplate = sequelize.define(
    'DocumentTemplate',
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
      name: { type: DataTypes.STRING(150), allowNull: false },
      fileUrl: { type: DataTypes.STRING(500) },
      bodyHtml: { type: DataTypes.TEXT },
      version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
      active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    },
    { tableName: 'document_templates', underscored: true, timestamps: true, paranoid: true }
  );
  return DocumentTemplate;
};
