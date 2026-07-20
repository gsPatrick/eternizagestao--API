'use strict';

// Anexo polimórfico: foto do sepultado, certidão de óbito, contrato, comprovante...
// attachable_type/attachable_id apontam para qualquer entidade do sistema.
module.exports = (sequelize, DataTypes) => {
  const Attachment = sequelize.define(
    'Attachment',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      tenantId: { type: DataTypes.UUID, allowNull: false },
      attachableType: { type: DataTypes.STRING(60), allowNull: false },
      attachableId: { type: DataTypes.UUID, allowNull: false },
      category: { type: DataTypes.STRING(60), allowNull: false, defaultValue: 'outro' },
      fileName: { type: DataTypes.STRING(255), allowNull: false },
      fileUrl: { type: DataTypes.STRING(500), allowNull: false },
      mimeType: { type: DataTypes.STRING(100) },
      sizeBytes: { type: DataTypes.BIGINT },
      description: { type: DataTypes.STRING(255) },
      uploadedByUserId: { type: DataTypes.UUID },
    },
    { tableName: 'attachments', underscored: true, timestamps: true }
  );
  return Attachment;
};
