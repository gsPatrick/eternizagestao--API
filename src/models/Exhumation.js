'use strict';

// Processo de exumação: solicitação → autorização → agendamento → realização,
// com destino dos restos mortais (ossário, outro jazigo, cremação, translado).
module.exports = (sequelize, DataTypes) => {
  const Exhumation = sequelize.define(
    'Exhumation',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      tenantId: { type: DataTypes.UUID, allowNull: false },
      // Número do processo de exumação: 0044/2026 (por tenant + ano)
      processNumber: { type: DataTypes.STRING },
      cemeteryId: { type: DataTypes.UUID, allowNull: false },
      graveId: { type: DataTypes.UUID, allowNull: false },
      burialId: { type: DataTypes.UUID },
      deceasedId: { type: DataTypes.UUID, allowNull: false },
      requestedByPersonId: { type: DataTypes.UUID },
      requestDate: { type: DataTypes.DATEONLY },
      reason: { type: DataTypes.TEXT },
      authorizationNumber: { type: DataTypes.STRING(60) },
      authorizedByUserId: { type: DataTypes.UUID },
      authorizedAt: { type: DataTypes.DATE },
      scheduledDate: { type: DataTypes.DATEONLY },
      performedAt: { type: DataTypes.DATE },
      performedBy: { type: DataTypes.STRING(150) },
      status: {
        type: DataTypes.ENUM('solicitada', 'autorizada', 'agendada', 'realizada', 'cancelada'),
        allowNull: false,
        defaultValue: 'solicitada',
      },
      destinationType: {
        type: DataTypes.ENUM('ossario', 'outro_jazigo', 'cremacao', 'translado_externo', 'outro'),
      },
      destinationGraveId: { type: DataTypes.UUID },
      destinationOssuaryNicheId: { type: DataTypes.UUID },
      destinationDetails: { type: DataTypes.TEXT },
      registeredByUserId: { type: DataTypes.UUID },
      notes: { type: DataTypes.TEXT },
    },
    { tableName: 'exhumations', underscored: true, timestamps: true }
  );
  return Exhumation;
};
