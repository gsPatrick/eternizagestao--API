'use strict';

/**
 * Recuperação de senha por CÓDIGO de 6 dígitos (painel administrativo e Portal
 * da Família).
 *
 * Decisões de SEGURANÇA refletidas no schema:
 *  - `code_hash` guarda apenas o HASH (bcrypt) do código — um vazamento do banco
 *    não entrega códigos válidos, e o hash lento inviabiliza força bruta offline.
 *  - `expires_at` materializa a validade curta (10 min): a expiração é conferida
 *    no banco/serviço, nunca no cliente.
 *  - `attempts` permite invalidar o código após 5 tentativas erradas (defesa
 *    contra varredura de 10^6 combinações; o rate limit por IP é a 2ª camada).
 *  - `used_at` (consumido no confirm) e `invalidated_at` (substituído por um
 *    novo pedido / estourou tentativas) mantêm a trilha sem reaproveitamento:
 *    um código só vale enquanto as DUAS colunas forem NULL.
 *  - `target_id` aponta para users.id (origin='admin') ou
 *    family_portal_accounts.id (origin='portal'). SEM foreign key: a linha é um
 *    registro de segurança que deve sobreviver à exclusão do alvo.
 *
 * Idempotente: só cria tabela/índices se ainda não existirem.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();
    const names = tables.map((t) => (typeof t === 'string' ? t : t.tableName));

    if (!names.includes('password_resets')) {
      await queryInterface.createTable('password_resets', {
        id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
        // tenant do alvo (NULL para super_admin, que não pertence a cidade nenhuma)
        tenant_id: { type: Sequelize.UUID, allowNull: true },
        // de onde partiu o pedido: painel administrativo x Portal da Família
        origin: { type: Sequelize.ENUM('admin', 'portal'), allowNull: false },
        email: { type: Sequelize.STRING(150), allowNull: false },
        // users.id ou family_portal_accounts.id conforme `origin` (sem FK — ver cabeçalho)
        target_id: { type: Sequelize.UUID, allowNull: true },
        // NUNCA o código em claro
        code_hash: { type: Sequelize.STRING(255), allowNull: false },
        attempts: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
        expires_at: { type: Sequelize.DATE, allowNull: false },
        used_at: { type: Sequelize.DATE, allowNull: true },
        invalidated_at: { type: Sequelize.DATE, allowNull: true },
        // IP do solicitante — só para investigação de abuso
        request_ip: { type: Sequelize.STRING(45), allowNull: true },
        created_at: { type: Sequelize.DATE, allowNull: false },
        updated_at: { type: Sequelize.DATE, allowNull: false },
      });
    }

    // Busca quente do fluxo: "último código VÁLIDO deste e-mail".
    await queryInterface.sequelize.query(
      'CREATE INDEX IF NOT EXISTS password_resets_email_created_idx ON password_resets (email, created_at DESC);'
    );
    // Invalidação em massa dos códigos anteriores do mesmo e-mail/origem.
    await queryInterface.sequelize.query(
      'CREATE INDEX IF NOT EXISTS password_resets_email_origin_idx ON password_resets (email, origin);'
    );
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query('DROP INDEX IF EXISTS password_resets_email_origin_idx;');
    await queryInterface.sequelize.query('DROP INDEX IF EXISTS password_resets_email_created_idx;');
    await queryInterface.dropTable('password_resets');
    // ENUM criado pelo Sequelize junto da tabela — precisa cair explicitamente.
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_password_resets_origin";');
  },
};
