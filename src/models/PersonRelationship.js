'use strict';

// Vínculo familiar entre duas pessoas (pai, mãe, filho(a), cônjuge...).
module.exports = (sequelize, DataTypes) => {
  const PersonRelationship = sequelize.define(
    'PersonRelationship',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      tenantId: { type: DataTypes.UUID, allowNull: false },
      personId: { type: DataTypes.UUID, allowNull: false },
      relatedPersonId: { type: DataTypes.UUID, allowNull: false },
      relationshipType: { type: DataTypes.STRING(50), allowNull: false },
      notes: { type: DataTypes.STRING(255) },
    },
    { tableName: 'person_relationships', underscored: true, timestamps: true }
  );
  return PersonRelationship;
};
