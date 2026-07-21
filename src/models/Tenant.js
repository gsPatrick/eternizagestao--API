'use strict';

// Órgão gestor (prefeitura/concessionária) — cliente white label com subdomínio isolado.
module.exports = (sequelize, DataTypes) => {
  const Tenant = sequelize.define(
    'Tenant',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      name: { type: DataTypes.STRING(150), allowNull: false },
      legalName: { type: DataTypes.STRING(200) },
      cnpj: { type: DataTypes.STRING(18) },
      subdomain: { type: DataTypes.STRING(63), allowNull: false, unique: true },
      logoUrl: { type: DataTypes.STRING(500) },
      // Imagens da PÁGINA PÚBLICA da cidade (hero e rodapé). Quando vazias, a
      // landing usa a arte padrão da plataforma — assim cada cidade pode ter a
      // sua foto, diferente do portal Eterniza.
      heroImageUrl: { type: DataTypes.STRING(500) },
      footerImageUrl: { type: DataTypes.STRING(500) },
      primaryColor: { type: DataTypes.STRING(7) },
      secondaryColor: { type: DataTypes.STRING(7) },
      email: { type: DataTypes.STRING(150), validate: { isEmail: true } },
      phone: { type: DataTypes.STRING(20) },
      whatsapp: { type: DataTypes.STRING(20) },
      addressStreet: { type: DataTypes.STRING(150) },
      addressNumber: { type: DataTypes.STRING(20) },
      addressComplement: { type: DataTypes.STRING(100) },
      addressDistrict: { type: DataTypes.STRING(100) },
      addressCity: { type: DataTypes.STRING(100) },
      addressState: { type: DataTypes.STRING(2) },
      addressZipcode: { type: DataTypes.STRING(9) },
      documentHeader: { type: DataTypes.JSONB },
      settings: { type: DataTypes.JSONB },
      active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      // Estado de onboarding da cidade: 'pendente' (admin ainda vai configurar a
      // marca/órgão gestor) ou 'concluido'. Default 'concluido' → tenants antigos
      // permanecem válidos sem back-fill.
      onboardingStatus: {
        type: DataTypes.ENUM('pendente', 'concluido'),
        allowNull: false,
        defaultValue: 'concluido',
      },
    },
    { tableName: 'tenants', underscored: true, timestamps: true, paranoid: true }
  );
  return Tenant;
};
