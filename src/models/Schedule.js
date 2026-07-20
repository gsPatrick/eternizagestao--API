'use strict';

// Agendamento de velório, sepultamento ou exumação.
// Conflitos de horário são verificados pelo service (sobreposição de intervalos).
module.exports = (sequelize, DataTypes) => {
  const Schedule = sequelize.define(
    'Schedule',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      tenantId: { type: DataTypes.UUID, allowNull: false },
      cemeteryId: { type: DataTypes.UUID, allowNull: false },
      chapelId: { type: DataTypes.UUID },
      graveId: { type: DataTypes.UUID },
      deceasedId: { type: DataTypes.UUID },
      exhumationId: { type: DataTypes.UUID },
      responsiblePersonId: { type: DataTypes.UUID },
      scheduleType: {
        type: DataTypes.ENUM('velorio', 'sepultamento', 'exumacao', 'visita_tecnica', 'outro'),
        allowNull: false,
      },
      title: { type: DataTypes.STRING(200) },
      startsAt: { type: DataTypes.DATE, allowNull: false },
      endsAt: { type: DataTypes.DATE, allowNull: false },
      status: {
        type: DataTypes.ENUM('agendado', 'confirmado', 'em_andamento', 'concluido', 'cancelado'),
        allowNull: false,
        defaultValue: 'agendado',
      },
      createdByUserId: { type: DataTypes.UUID },
      notes: { type: DataTypes.TEXT },
    },
    {
      tableName: 'schedules',
      underscored: true,
      timestamps: true,
      validate: {
        endsAfterStarts() {
          if (this.startsAt && this.endsAt && this.endsAt <= this.startsAt) {
            throw new Error('ends_at deve ser posterior a starts_at');
          }
        },
      },
    }
  );
  return Schedule;
};
