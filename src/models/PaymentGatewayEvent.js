'use strict';

// Webhook cru recebido do gateway de pagamento — auditoria da baixa automática.
module.exports = (sequelize, DataTypes) => {
  const PaymentGatewayEvent = sequelize.define(
    'PaymentGatewayEvent',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      tenantId: { type: DataTypes.UUID },
      provider: { type: DataTypes.STRING(50), allowNull: false },
      eventType: { type: DataTypes.STRING(100) },
      gatewayChargeId: { type: DataTypes.STRING(100) },
      billingId: { type: DataTypes.UUID },
      payload: { type: DataTypes.JSONB, allowNull: false },
      status: {
        type: DataTypes.ENUM('recebido', 'processado', 'ignorado', 'erro'),
        allowNull: false,
        defaultValue: 'recebido',
      },
      errorMessage: { type: DataTypes.TEXT },
      processedAt: { type: DataTypes.DATE },
    },
    { tableName: 'payment_gateway_events', underscored: true, timestamps: true }
  );
  return PaymentGatewayEvent;
};
