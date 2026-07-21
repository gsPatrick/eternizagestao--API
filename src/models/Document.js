'use strict';

// Documento oficial emitido (PDF): numeração sequencial por tenant/tipo/ano,
// 2ª via via original_document_id, referência polimórfica à origem.
module.exports = (sequelize, DataTypes) => {
  const Document = sequelize.define(
    'Document',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      tenantId: { type: DataTypes.UUID, allowNull: false },
      templateId: { type: DataTypes.UUID },
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
      number: { type: DataTypes.INTEGER, allowNull: false },
      year: { type: DataTypes.INTEGER, allowNull: false },
      formattedNumber: { type: DataTypes.STRING(30), allowNull: false }, // ex.: "0001/2026"
      referenceType: { type: DataTypes.STRING(60) },
      referenceId: { type: DataTypes.UUID },
      graveId: { type: DataTypes.UUID },
      deceasedId: { type: DataTypes.UUID },
      personId: { type: DataTypes.UUID },
      fileUrl: { type: DataTypes.STRING(500) }, // HTML branded (fonte do PDF)
      pdfUrl: { type: DataTypes.STRING(500) }, // PDF oficial gerado do HTML
      // Driver que REALMENTE gerou o pdfUrl ('puppeteer' = fiel ao layout;
      // 'fallback' = degradado, sem layout/logo/cores). Serve para auditar e
      // reemitir documentos que saíram degradados por falta de Chromium.
      // null = documento anterior a este campo (origem desconhecida).
      pdfDriver: { type: DataTypes.STRING(20) },
      status: {
        type: DataTypes.ENUM('emitido', 'aguardando_assinatura', 'assinado', 'cancelado'),
        allowNull: false,
        defaultValue: 'emitido',
      },
      issuedByUserId: { type: DataTypes.UUID },
      issuedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      originalDocumentId: { type: DataTypes.UUID },
      reissueCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      canceledAt: { type: DataTypes.DATE },
      notes: { type: DataTypes.TEXT },
    },
    { tableName: 'documents', underscored: true, timestamps: true }
  );
  return Document;
};
