'use strict';

// Sepultura: cova, jazigo ou gaveta (gaveta referencia o jazigo pai).
module.exports = (sequelize, DataTypes) => {
  const Grave = sequelize.define(
    'Grave',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      tenantId: { type: DataTypes.UUID, allowNull: false },
      cemeteryId: { type: DataTypes.UUID, allowNull: false },
      lotId: { type: DataTypes.UUID, allowNull: false },
      parentGraveId: { type: DataTypes.UUID, allowNull: true },
      code: { type: DataTypes.STRING(50), allowNull: false },
      unitType: {
        type: DataTypes.ENUM('cova', 'jazigo', 'gaveta', 'tumulo', 'outro'),
        allowNull: false,
        defaultValue: 'cova',
      },
      statusId: { type: DataTypes.UUID, allowNull: false },
      capacity: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
      geoPolygon: { type: DataTypes.JSONB },
      latitude: { type: DataTypes.DECIMAL(10, 7) },
      longitude: { type: DataTypes.DECIMAL(10, 7) },
      photoUrl: { type: DataTypes.STRING(500) },
      areaM2: { type: DataTypes.DECIMAL(8, 2) },
      // Campos oficiais exigidos pelos modelos de documento do cliente.
      // utilizacao: regime de uso ('Perpétuo'/'Temporário').
      utilizacao: { type: DataTypes.STRING(50) },
      // tombType: "Tipo do túmulo" (Campas/jazigos-perpétuos, Carneiras de
      // adultos, Bloco de gaveta, Lápides no chão/cavas, ...).
      tombType: { type: DataTypes.STRING(120) },
      // carneiraPermission: "Permissão de carneira" (texto livre: Sim/Não/descrição).
      carneiraPermission: { type: DataTypes.STRING(120) },
      // bloqueio operacional (ex.: inadimplência) — impede reformas/sepultamentos
      isBlocked: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      blockedReason: { type: DataTypes.STRING(255) },
      notes: { type: DataTypes.TEXT },
    },
    { tableName: 'graves', underscored: true, timestamps: true, paranoid: true }
  );
  return Grave;
};
