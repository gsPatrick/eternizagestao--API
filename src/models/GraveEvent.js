'use strict';

// Linha do tempo IMUTÁVEL da sepultura. Nunca atualizar/excluir registros:
// correções geram um novo evento. Referência polimórfica à entidade de origem.
module.exports = (sequelize, DataTypes) => {
  const GraveEvent = sequelize.define(
    'GraveEvent',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      tenantId: { type: DataTypes.UUID, allowNull: false },
      graveId: { type: DataTypes.UUID, allowNull: false },
      eventType: {
        type: DataTypes.ENUM(
          'sepultamento',
          'exumacao',
          'reforma',
          'manutencao',
          'transferencia_propriedade',
          'concessao',
          'cobranca',
          'pagamento',
          'bloqueio',
          'desbloqueio',
          'alteracao_status',
          'deposito_ossario',
          'documento_emitido',
          'agendamento',
          'outro'
        ),
        allowNull: false,
      },
      title: { type: DataTypes.STRING(200), allowNull: false },
      description: { type: DataTypes.TEXT },
      referenceType: { type: DataTypes.STRING(60) },
      referenceId: { type: DataTypes.UUID },
      metadata: { type: DataTypes.JSONB },
      occurredAt: { type: DataTypes.DATE, allowNull: false },
      registeredByUserId: { type: DataTypes.UUID },
    },
    { tableName: 'grave_events', underscored: true, timestamps: true }
  );
  return GraveEvent;
};
