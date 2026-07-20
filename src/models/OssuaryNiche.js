'use strict';

// Nicho/gaveta individual do ossário — onde os restos mortais são depositados.
module.exports = (sequelize, DataTypes) => {
  const OssuaryNiche = sequelize.define(
    'OssuaryNiche',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      tenantId: { type: DataTypes.UUID, allowNull: false },
      ossuaryId: { type: DataTypes.UUID, allowNull: false },
      code: { type: DataTypes.STRING(30), allowNull: false },
      rowLabel: { type: DataTypes.STRING(20) },
      columnLabel: { type: DataTypes.STRING(20) },
      status: {
        type: DataTypes.ENUM('livre', 'ocupado', 'reservado', 'em_manutencao'),
        allowNull: false,
        defaultValue: 'livre',
      },
      notes: { type: DataTypes.TEXT },
    },
    { tableName: 'ossuary_niches', underscored: true, timestamps: true, paranoid: true }
  );
  return OssuaryNiche;
};
