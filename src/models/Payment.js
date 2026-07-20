'use strict';

// Baixa de cobrança. is_automatic=true => baixa automática via webhook do gateway.
module.exports = (sequelize, DataTypes) => {
  const Payment = sequelize.define(
    'Payment',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      tenantId: { type: DataTypes.UUID, allowNull: false },
      billingId: { type: DataTypes.UUID, allowNull: false },
      paidAt: { type: DataTypes.DATE, allowNull: false },
      amountPaid: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
      method: {
        type: DataTypes.ENUM(
          'pix',
          'boleto',
          'dinheiro',
          'cartao_credito',
          'cartao_debito',
          'transferencia',
          'outro'
        ),
        allowNull: false,
      },
      gatewayTransactionId: { type: DataTypes.STRING(100) },
      receiptNumber: { type: DataTypes.STRING(30) },
      isAutomatic: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      reconciled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      reconciledAt: { type: DataTypes.DATE },
      registeredByUserId: { type: DataTypes.UUID }, // NULL quando baixa automática
      notes: { type: DataTypes.TEXT },
    },
    { tableName: 'payments', underscored: true, timestamps: true }
  );
  return Payment;
};
