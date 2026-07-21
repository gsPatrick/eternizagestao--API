'use strict';

// Sepultado (pessoa falecida). Localização atual mantida pelos fluxos de
// sepultamento/exumação; histórico completo em burials/exhumations/remains_deposits.
module.exports = (sequelize, DataTypes) => {
  const Deceased = sequelize.define(
    'Deceased',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      tenantId: { type: DataTypes.UUID, allowNull: false },
      fullName: { type: DataTypes.STRING(150), allowNull: false },
      // Matrícula/registro interno do sepultado (campo do sistema antigo).
      registrationNumber: { type: DataTypes.STRING(60) },
      cpf: { type: DataTypes.STRING(14) },
      rg: { type: DataTypes.STRING(20) },
      // Idade no falecimento (texto: aceita "75" ou "75 anos 3 meses").
      age: { type: DataTypes.STRING(30) },
      birthDate: { type: DataTypes.DATEONLY },
      deathDate: { type: DataTypes.DATEONLY },
      deathTime: { type: DataTypes.TIME },
      gender: { type: DataTypes.STRING(30) },
      // Estado civil e Cor/raça (registro civil — campos do sistema antigo).
      maritalStatus: { type: DataTypes.STRING(40) },
      skinColor: { type: DataTypes.STRING(30) },
      // Título de eleitor (documentação).
      voterId: { type: DataTypes.STRING(30) },
      motherName: { type: DataTypes.STRING(150) },
      fatherName: { type: DataTypes.STRING(150) },
      birthplace: { type: DataTypes.STRING(150) },
      causeOfDeath: { type: DataTypes.STRING(255) },
      // Local do falecimento (ex.: hospital, residência).
      deathPlace: { type: DataTypes.STRING(200) },
      // Médico responsável pelo atestado de óbito (pedido do cliente).
      attendingPhysician: { type: DataTypes.STRING(150) },
      deathCertificateNumber: { type: DataTypes.STRING(60) },
      // Cartório de registro (nome) — escolhido de Básico › Cartórios.
      deathCertificateRegistry: { type: DataTypes.STRING(150) },
      // Nº do REGISTRO no cartório (livro/folha/termo) — distinto do número do
      // atestado de óbito, que é emitido pelo médico.
      registryNumber: { type: DataTypes.STRING(120) },
      // Funerária responsável (nome) — escolhida de Básico › Funerárias.
      funeralHome: { type: DataTypes.STRING(150) },
      // PDF da declaração/certidão de óbito anexada no cadastro.
      deathCertificateFileUrl: { type: DataTypes.STRING(500) },
      photoUrl: { type: DataTypes.STRING(500) },
      // Responsável pela sepultura (pessoa) — distinto do PROPRIETÁRIO (concessão).
      // Comum em disputas: um é o dono, outro responde pelo sepultado.
      responsiblePersonId: { type: DataTypes.UUID },
      currentGraveId: { type: DataTypes.UUID },
      currentLocationType: {
        type: DataTypes.ENUM('sepultado', 'ossario', 'transladado', 'cremado', 'desconhecido'),
        allowNull: false,
        defaultValue: 'sepultado',
      },
      notes: { type: DataTypes.TEXT },
    },
    { tableName: 'deceased', underscored: true, timestamps: true, paranoid: true }
  );
  return Deceased;
};
