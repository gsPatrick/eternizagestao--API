'use strict';

// Numerador sequencial genérico por tenant + escopo + ano.
// Generaliza o padrão de DocumentSequence: incrementa sob SELECT ... FOR UPDATE
// dentro de transação. `scope` identifica a série ('billing', 'exhumation', ...).
// Sem associações → auto-carregado pelo readdir do index.js.
module.exports = (sequelize, DataTypes) => {
  const Sequence = sequelize.define(
    'Sequence',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      tenantId: { type: DataTypes.UUID, allowNull: false },
      scope: { type: DataTypes.STRING, allowNull: false },
      year: { type: DataTypes.INTEGER, allowNull: false },
      lastNumber: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    },
    {
      tableName: 'sequences',
      underscored: true,
      timestamps: true,
      indexes: [{ unique: true, fields: ['tenant_id', 'scope', 'year'], name: 'sequences_unique' }],
    }
  );
  return Sequence;
};
