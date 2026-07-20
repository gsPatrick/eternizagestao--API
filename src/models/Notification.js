'use strict';

// Notificação automática (WhatsApp/e-mail/SMS) com rastreio de entrega.
module.exports = (sequelize, DataTypes) => {
  const Notification = sequelize.define(
    'Notification',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      tenantId: { type: DataTypes.UUID, allowNull: false },
      recipientPersonId: { type: DataTypes.UUID },
      recipientUserId: { type: DataTypes.UUID },
      channel: { type: DataTypes.ENUM('whatsapp', 'email', 'sms'), allowNull: false },
      notificationType: {
        type: DataTypes.ENUM(
          'vencimento_taxa',
          'cobranca_gerada',
          'pagamento_confirmado',
          'autorizacao_sepultamento',
          'agendamento',
          'lembrete',
          'portal_acesso',
          'cobranca_vencida',
          'documento_emitido',
          'avulsa',
          'outro'
        ),
        allowNull: false,
      },
      // snapshot do contato no momento do envio
      recipientContact: { type: DataTypes.STRING(150), allowNull: false },
      subject: { type: DataTypes.STRING(200) },
      message: { type: DataTypes.TEXT, allowNull: false },
      referenceType: { type: DataTypes.STRING(60) },
      referenceId: { type: DataTypes.UUID },
      status: {
        type: DataTypes.ENUM('pendente', 'enfileirada', 'enviada', 'entregue', 'lida', 'falha'),
        allowNull: false,
        defaultValue: 'pendente',
      },
      provider: { type: DataTypes.STRING(50) },
      providerMessageId: { type: DataTypes.STRING(120) },
      errorMessage: { type: DataTypes.TEXT },
      scheduledFor: { type: DataTypes.DATE },
      sentAt: { type: DataTypes.DATE },
    },
    { tableName: 'notifications', underscored: true, timestamps: true }
  );
  return Notification;
};
