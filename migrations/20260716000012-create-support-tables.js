'use strict';

/**
 * Tabelas transversais de suporte:
 *  - attachments: anexos polimórficos (fotos, certidões, contratos, comprovantes).
 *  - notifications: notificações WhatsApp/e-mail/SMS com status de entrega.
 *  - audit_logs: log imutável de ações para rastreabilidade.
 *  - import_batches / import_records: migração de dados de sistemas legados.
 *  - data_exports: exportações para cartórios e órgãos municipais.
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

    await queryInterface.createTable('attachments', {
      id,
      tenant_id: fk('tenants'),
      // entidade dona do anexo (ex.: 'deceased', 'grave', 'exhumation', 'payment')
      attachable_type: { type: Sequelize.STRING(60), allowNull: false },
      attachable_id: { type: Sequelize.UUID, allowNull: false },
      // categoria livre: certidao_obito, foto, documento_pessoal, contrato,
      // autorizacao, comprovante, outro...
      category: { type: Sequelize.STRING(60), allowNull: false, defaultValue: 'outro' },
      file_name: { type: Sequelize.STRING(255), allowNull: false },
      file_url: { type: Sequelize.STRING(500), allowNull: false },
      mime_type: { type: Sequelize.STRING(100), allowNull: true },
      size_bytes: { type: Sequelize.BIGINT, allowNull: true },
      description: { type: Sequelize.STRING(255), allowNull: true },
      uploaded_by_user_id: fk('users', true),
      ...timestamps,
    });
    await queryInterface.addIndex('attachments', ['attachable_type', 'attachable_id'], {
      name: 'attachments_attachable_idx',
    });
    await queryInterface.addIndex('attachments', ['tenant_id'], { name: 'attachments_tenant_id_idx' });

    await queryInterface.createTable('notifications', {
      id,
      tenant_id: fk('tenants'),
      recipient_person_id: fk('people', true),
      recipient_user_id: fk('users', true),
      channel: { type: Sequelize.ENUM('whatsapp', 'email', 'sms'), allowNull: false },
      notification_type: {
        type: Sequelize.ENUM(
          'vencimento_taxa',
          'cobranca_gerada',
          'pagamento_confirmado',
          'autorizacao_sepultamento',
          'agendamento',
          'lembrete',
          'portal_acesso',
          'outro'
        ),
        allowNull: false,
      },
      // snapshot do contato no momento do envio (telefone/e-mail)
      recipient_contact: { type: Sequelize.STRING(150), allowNull: false },
      subject: { type: Sequelize.STRING(200), allowNull: true },
      message: { type: Sequelize.TEXT, allowNull: false },
      reference_type: { type: Sequelize.STRING(60), allowNull: true },
      reference_id: { type: Sequelize.UUID, allowNull: true },
      status: {
        type: Sequelize.ENUM('pendente', 'enfileirada', 'enviada', 'entregue', 'lida', 'falha'),
        allowNull: false,
        defaultValue: 'pendente',
      },
      provider: { type: Sequelize.STRING(50), allowNull: true },
      provider_message_id: { type: Sequelize.STRING(120), allowNull: true },
      error_message: { type: Sequelize.TEXT, allowNull: true },
      scheduled_for: { type: Sequelize.DATE, allowNull: true },
      sent_at: { type: Sequelize.DATE, allowNull: true },
      ...timestamps,
    });
    await queryInterface.addIndex('notifications', ['tenant_id', 'status'], {
      name: 'notifications_tenant_id_status_idx',
    });
    await queryInterface.addIndex('notifications', ['recipient_person_id'], {
      name: 'notifications_recipient_person_id_idx',
    });

    await queryInterface.createTable('audit_logs', {
      id,
      // NULL para eventos de plataforma (fora de tenant)
      tenant_id: fk('tenants', true),
      user_id: fk('users', true),
      // ação executada por conta do Portal da Família
      portal_account_id: fk('family_portal_accounts', true),
      action: { type: Sequelize.STRING(60), allowNull: false },
      entity_type: { type: Sequelize.STRING(60), allowNull: true },
      entity_id: { type: Sequelize.UUID, allowNull: true },
      description: { type: Sequelize.STRING(255), allowNull: true },
      previous_data: { type: Sequelize.JSONB, allowNull: true },
      new_data: { type: Sequelize.JSONB, allowNull: true },
      ip_address: { type: Sequelize.STRING(45), allowNull: true },
      user_agent: { type: Sequelize.STRING(255), allowNull: true },
      // log imutável: apenas created_at
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
    });
    await queryInterface.addIndex('audit_logs', ['tenant_id', 'created_at'], {
      name: 'audit_logs_tenant_id_created_at_idx',
    });
    await queryInterface.addIndex('audit_logs', ['entity_type', 'entity_id'], {
      name: 'audit_logs_entity_idx',
    });

    await queryInterface.createTable('import_batches', {
      id,
      tenant_id: fk('tenants'),
      cemetery_id: fk('cemeteries', true),
      // sistema/planilha de origem dos dados legados
      source_name: { type: Sequelize.STRING(150), allowNull: true },
      file_name: { type: Sequelize.STRING(255), allowNull: true },
      file_url: { type: Sequelize.STRING(500), allowNull: true },
      entity_scope: {
        type: Sequelize.ENUM('sepulturas', 'sepultados', 'proprietarios', 'financeiro', 'misto'),
        allowNull: false,
        defaultValue: 'misto',
      },
      status: {
        type: Sequelize.ENUM('pendente', 'processando', 'validado', 'importado', 'erro', 'cancelado'),
        allowNull: false,
        defaultValue: 'pendente',
      },
      total_records: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      valid_records: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      invalid_records: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      imported_records: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      error_summary: { type: Sequelize.JSONB, allowNull: true },
      started_at: { type: Sequelize.DATE, allowNull: true },
      finished_at: { type: Sequelize.DATE, allowNull: true },
      created_by_user_id: fk('users', true),
      notes: { type: Sequelize.TEXT, allowNull: true },
      ...timestamps,
    });
    await queryInterface.addIndex('import_batches', ['tenant_id', 'status'], {
      name: 'import_batches_tenant_id_status_idx',
    });

    await queryInterface.createTable('import_records', {
      id,
      tenant_id: fk('tenants'),
      import_batch_id: fk('import_batches', false, 'CASCADE'),
      row_number: { type: Sequelize.INTEGER, allowNull: true },
      // linha original do arquivo legado — preservada para auditoria
      raw_data: { type: Sequelize.JSONB, allowNull: false },
      status: {
        type: Sequelize.ENUM('pendente', 'valido', 'invalido', 'importado', 'ignorado'),
        allowNull: false,
        defaultValue: 'pendente',
      },
      validation_errors: { type: Sequelize.JSONB, allowNull: true },
      // entidade criada a partir desta linha (ex.: 'deceased' + uuid)
      created_entity_type: { type: Sequelize.STRING(60), allowNull: true },
      created_entity_id: { type: Sequelize.UUID, allowNull: true },
      ...timestamps,
    });
    await queryInterface.addIndex('import_records', ['import_batch_id', 'status'], {
      name: 'import_records_batch_status_idx',
    });

    await queryInterface.createTable('data_exports', {
      id,
      tenant_id: fk('tenants'),
      cemetery_id: fk('cemeteries', true),
      export_type: {
        type: Sequelize.ENUM(
          'cartorio',
          'orgao_municipal',
          'ocupacao',
          'financeiro',
          'sepultamentos',
          'exumacoes',
          'inadimplencia',
          'outro'
        ),
        allowNull: false,
      },
      format: {
        type: Sequelize.ENUM('pdf', 'csv', 'xlsx', 'xml', 'json'),
        allowNull: false,
        defaultValue: 'pdf',
      },
      period_start: { type: Sequelize.DATEONLY, allowNull: true },
      period_end: { type: Sequelize.DATEONLY, allowNull: true },
      // filtros/parâmetros usados na geração
      parameters: { type: Sequelize.JSONB, allowNull: true },
      file_url: { type: Sequelize.STRING(500), allowNull: true },
      status: {
        type: Sequelize.ENUM('pendente', 'processando', 'concluido', 'erro'),
        allowNull: false,
        defaultValue: 'pendente',
      },
      error_message: { type: Sequelize.TEXT, allowNull: true },
      requested_by_user_id: fk('users', true),
      generated_at: { type: Sequelize.DATE, allowNull: true },
      ...timestamps,
    });
    await queryInterface.addIndex('data_exports', ['tenant_id', 'export_type'], {
      name: 'data_exports_tenant_id_type_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('data_exports');
    await queryInterface.dropTable('import_records');
    await queryInterface.dropTable('import_batches');
    await queryInterface.dropTable('audit_logs');
    await queryInterface.dropTable('notifications');
    await queryInterface.dropTable('attachments');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_data_exports_status";');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_data_exports_format";');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_data_exports_export_type";');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_import_records_status";');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_import_batches_status";');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_import_batches_entity_scope";');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_notifications_status";');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_notifications_notification_type";');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_notifications_channel";');
  },
};
