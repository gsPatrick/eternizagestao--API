'use strict';

// Cobrança (fatura) — boleto/PIX via gateway. 2ª via referencia a original.
module.exports = (sequelize, DataTypes) => {
  const Billing = sequelize.define(
    'Billing',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      tenantId: { type: DataTypes.UUID, allowNull: false },
      // Numeração sequencial da cobrança: COB-2026-0001 (por tenant + ano)
      code: { type: DataTypes.STRING },
      cemeteryId: { type: DataTypes.UUID },
      graveId: { type: DataTypes.UUID },
      maintenanceFeeId: { type: DataTypes.UUID },
      payerPersonId: { type: DataTypes.UUID, allowNull: false },
      origin: {
        type: DataTypes.ENUM('taxa_manutencao', 'servico', 'avulsa'),
        allowNull: false,
        defaultValue: 'taxa_manutencao',
      },
      description: { type: DataTypes.STRING(255) },
      referencePeriod: { type: DataTypes.STRING(7) },
      amount: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
      discountAmount: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
      fineAmount: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
      interestAmount: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
      totalAmount: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
      dueDate: { type: DataTypes.DATEONLY, allowNull: false },
      status: {
        type: DataTypes.ENUM('pendente', 'pago', 'em_atraso', 'cancelado', 'estornado'),
        allowNull: false,
        defaultValue: 'pendente',
      },
      gatewayProvider: { type: DataTypes.STRING(50) },
      gatewayChargeId: { type: DataTypes.STRING(100) },
      boletoBarcode: { type: DataTypes.STRING(60) },
      boletoDigitableLine: { type: DataTypes.STRING(60) },
      boletoUrl: { type: DataTypes.STRING(500) },
      pixQrCode: { type: DataTypes.TEXT },
      pixCopyPaste: { type: DataTypes.TEXT },
      pixExpiresAt: { type: DataTypes.DATE },
      originalBillingId: { type: DataTypes.UUID },
      reissueCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      canceledAt: { type: DataTypes.DATE },
      notes: { type: DataTypes.TEXT },
    },
    { tableName: 'billings', underscored: true, timestamps: true }
  );
  return Billing;
};
