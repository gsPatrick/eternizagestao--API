'use strict';

/**
 * Documentos oficiais:
 *  - document_templates: modelos fornecidos pelo cliente (certidão, autorização...).
 *  - document_sequences: numerador sequencial por tenant + tipo + ano.
 *  - documents: documentos emitidos (PDF), com 2ª via e referência polimórfica.
 *  - document_signatures: assinatura eletrônica dos documentos emitidos.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const timestamps = {
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
    };
    const id = {
      type: Sequelize.UUID,
      primaryKey: true,
      defaultValue: Sequelize.literal('gen_random_uuid()'),
    };
    const fk = (table, allowNull = false, onDelete = 'RESTRICT') => ({
      type: Sequelize.UUID,
      allowNull,
      references: { model: table, key: 'id' },
      onUpdate: 'CASCADE',
      onDelete,
    });

    const DOCUMENT_TYPES = [
      'certidao_perpetuidade',
      'autorizacao_sepultamento',
      'autorizacao_exumacao',
      'recibo',
      'declaracao',
      'outro',
    ];

    await queryInterface.createTable('document_templates', {
      id,
      tenant_id: fk('tenants'),
      document_type: { type: Sequelize.ENUM(...DOCUMENT_TYPES), allowNull: false },
      name: { type: Sequelize.STRING(150), allowNull: false },
      // modelo pode ser arquivo (docx/pdf base) ou HTML renderizável
      file_url: { type: Sequelize.STRING(500), allowNull: true },
      body_html: { type: Sequelize.TEXT, allowNull: true },
      version: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
      active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      ...timestamps,
      deleted_at: { type: Sequelize.DATE, allowNull: true },
    });
    await queryInterface.addIndex('document_templates', ['tenant_id', 'document_type'], {
      name: 'document_templates_tenant_type_idx',
    });

    await queryInterface.createTable('document_sequences', {
      id,
      tenant_id: fk('tenants'),
      document_type: { type: Sequelize.ENUM(...DOCUMENT_TYPES), allowNull: false },
      year: { type: Sequelize.INTEGER, allowNull: false },
      // incrementado com SELECT ... FOR UPDATE dentro de transação
      last_number: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      ...timestamps,
    });
    await queryInterface.addIndex('document_sequences', ['tenant_id', 'document_type', 'year'], {
      unique: true,
      name: 'document_sequences_unique',
    });

    await queryInterface.createTable('documents', {
      id,
      tenant_id: fk('tenants'),
      template_id: fk('document_templates', true),
      document_type: { type: Sequelize.ENUM(...DOCUMENT_TYPES), allowNull: false },
      number: { type: Sequelize.INTEGER, allowNull: false },
      year: { type: Sequelize.INTEGER, allowNull: false },
      // ex.: "0001/2026"
      formatted_number: { type: Sequelize.STRING(30), allowNull: false },
      // referência polimórfica à origem (burial, exhumation, concession, payment...)
      reference_type: { type: Sequelize.STRING(60), allowNull: true },
      reference_id: { type: Sequelize.UUID, allowNull: true },
      // atalhos de consulta mais comuns
      grave_id: fk('graves', true),
      deceased_id: fk('deceased', true),
      person_id: fk('people', true),
      file_url: { type: Sequelize.STRING(500), allowNull: true },
      status: {
        type: Sequelize.ENUM('emitido', 'aguardando_assinatura', 'assinado', 'cancelado'),
        allowNull: false,
        defaultValue: 'emitido',
      },
      issued_by_user_id: fk('users', true),
      issued_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
      // 2ª via: reemissão aponta para o documento original
      original_document_id: fk('documents', true),
      reissue_count: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      canceled_at: { type: Sequelize.DATE, allowNull: true },
      notes: { type: Sequelize.TEXT, allowNull: true },
      ...timestamps,
    });
    await queryInterface.addIndex('documents', ['tenant_id', 'document_type', 'year', 'number'], {
      unique: true,
      name: 'documents_sequential_number_unique',
    });
    await queryInterface.addIndex('documents', ['grave_id'], { name: 'documents_grave_id_idx' });
    await queryInterface.addIndex('documents', ['deceased_id'], { name: 'documents_deceased_id_idx' });
    await queryInterface.addIndex('documents', ['reference_type', 'reference_id'], {
      name: 'documents_reference_idx',
    });

    await queryInterface.createTable('document_signatures', {
      id,
      tenant_id: fk('tenants'),
      document_id: fk('documents', false, 'CASCADE'),
      signer_name: { type: Sequelize.STRING(150), allowNull: false },
      signer_email: { type: Sequelize.STRING(150), allowNull: true },
      signer_cpf: { type: Sequelize.STRING(14), allowNull: true },
      signer_person_id: fk('people', true),
      signer_user_id: fk('users', true),
      // provedor de assinatura eletrônica (Clicksign, D4Sign, ZapSign...)
      provider: { type: Sequelize.STRING(50), allowNull: true },
      provider_envelope_id: { type: Sequelize.STRING(120), allowNull: true },
      status: {
        type: Sequelize.ENUM('pendente', 'enviado', 'assinado', 'recusado', 'expirado', 'cancelado'),
        allowNull: false,
        defaultValue: 'pendente',
      },
      signed_at: { type: Sequelize.DATE, allowNull: true },
      signature_hash: { type: Sequelize.STRING(255), allowNull: true },
      ip_address: { type: Sequelize.STRING(45), allowNull: true },
      notes: { type: Sequelize.TEXT, allowNull: true },
      ...timestamps,
    });
    await queryInterface.addIndex('document_signatures', ['document_id'], {
      name: 'document_signatures_document_id_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('document_signatures');
    await queryInterface.dropTable('documents');
    await queryInterface.dropTable('document_sequences');
    await queryInterface.dropTable('document_templates');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_document_signatures_status";');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_documents_status";');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_documents_document_type";');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_document_sequences_document_type";');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_document_templates_document_type";');
  },
};
