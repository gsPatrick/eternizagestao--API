'use strict';

// Assinatura eletrônica de um documento emitido (via provedor externo).
module.exports = (sequelize, DataTypes) => {
  const DocumentSignature = sequelize.define(
    'DocumentSignature',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      tenantId: { type: DataTypes.UUID, allowNull: false },
      documentId: { type: DataTypes.UUID, allowNull: false },
      signerName: { type: DataTypes.STRING(150), allowNull: false },
      signerEmail: { type: DataTypes.STRING(150) },
      signerCpf: { type: DataTypes.STRING(14) },
      signerPersonId: { type: DataTypes.UUID },
      signerUserId: { type: DataTypes.UUID },
      provider: { type: DataTypes.STRING(50) },
      providerEnvelopeId: { type: DataTypes.STRING(120) },
      status: {
        type: DataTypes.ENUM('pendente', 'enviado', 'assinado', 'recusado', 'expirado', 'cancelado'),
        allowNull: false,
        defaultValue: 'pendente',
      },
      signedAt: { type: DataTypes.DATE },
      signatureHash: { type: DataTypes.STRING(255) },
      ipAddress: { type: DataTypes.STRING(45) },
      notes: { type: DataTypes.TEXT },
    },
    { tableName: 'document_signatures', underscored: true, timestamps: true }
  );
  return DocumentSignature;
};
