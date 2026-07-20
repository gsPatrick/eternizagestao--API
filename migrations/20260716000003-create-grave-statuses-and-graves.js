'use strict';

/**
 * Sepulturas:
 *  - grave_statuses: situações operacionais CADASTRÁVEIS por tenant (o briefing
 *    exige "qualquer outra condição previamente cadastrada"). Statuses de sistema
 *    (tenant_id NULL) são seedados aqui.
 *  - graves: covas, jazigos e gavetas. Gaveta referencia o jazigo pai via
 *    parent_grave_id. Georreferenciada por polígono (ortofoto) + lat/lng (GPS).
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

    await queryInterface.createTable('grave_statuses', {
      id,
      // NULL => status de sistema, disponível para todos os tenants
      tenant_id: fk('tenants', true),
      name: { type: Sequelize.STRING(80), allowNull: false },
      slug: { type: Sequelize.STRING(50), allowNull: false },
      color: { type: Sequelize.STRING(7), allowNull: true },
      // define se o status permite registrar novo sepultamento
      allows_burial: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      is_system: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      ...timestamps,
    });
    await queryInterface.addIndex('grave_statuses', ['tenant_id', 'slug'], {
      unique: true,
      name: 'grave_statuses_tenant_id_slug_unique',
    });

    // Statuses padrão exigidos pelo briefing (globais, imutáveis pela aplicação)
    await queryInterface.sequelize.query(`
      INSERT INTO grave_statuses (id, tenant_id, name, slug, color, allows_burial, is_system, active, created_at, updated_at)
      VALUES
        (gen_random_uuid(), NULL, 'Livre',            'livre',            '#22C55E', TRUE,  TRUE, TRUE, NOW(), NOW()),
        (gen_random_uuid(), NULL, 'Ocupada',          'ocupada',          '#EF4444', FALSE, TRUE, TRUE, NOW(), NOW()),
        (gen_random_uuid(), NULL, 'Reservada',        'reservada',        '#F59E0B', TRUE,  TRUE, TRUE, NOW(), NOW()),
        (gen_random_uuid(), NULL, 'Em Manutenção',    'em_manutencao',    '#3B82F6', FALSE, TRUE, TRUE, NOW(), NOW()),
        (gen_random_uuid(), NULL, 'Interditada',      'interditada',      '#6B7280', FALSE, TRUE, TRUE, NOW(), NOW()),
        (gen_random_uuid(), NULL, 'Em Perpetuidade',  'em_perpetuidade',  '#8B5CF6', TRUE,  TRUE, TRUE, NOW(), NOW());
    `);

    await queryInterface.createTable('graves', {
      id,
      tenant_id: fk('tenants'),
      cemetery_id: fk('cemeteries'),
      lot_id: fk('lots'),
      // gaveta dentro de um jazigo => aponta para a unidade pai
      parent_grave_id: fk('graves', true),
      code: { type: Sequelize.STRING(50), allowNull: false },
      unit_type: {
        type: Sequelize.ENUM('cova', 'jazigo', 'gaveta', 'tumulo', 'outro'),
        allowNull: false,
        defaultValue: 'cova',
      },
      status_id: fk('grave_statuses'),
      // capacidade de sepultamentos simultâneos (nº de gavetas/vagas)
      capacity: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
      // polígono de demarcação sobre a ortofoto: [[lat, lng], ...]
      geo_polygon: { type: Sequelize.JSONB, allowNull: true },
      // centroide para busca/rota GPS do visitante
      latitude: { type: Sequelize.DECIMAL(10, 7), allowNull: true },
      longitude: { type: Sequelize.DECIMAL(10, 7), allowNull: true },
      photo_url: { type: Sequelize.STRING(500), allowNull: true },
      area_m2: { type: Sequelize.DECIMAL(8, 2), allowNull: true },
      // bloqueio operacional (ex.: inadimplência) — impede reformas/sepultamentos
      is_blocked: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      blocked_reason: { type: Sequelize.STRING(255), allowNull: true },
      notes: { type: Sequelize.TEXT, allowNull: true },
      ...timestamps,
      deleted_at: { type: Sequelize.DATE, allowNull: true },
    });

    await queryInterface.addIndex('graves', ['cemetery_id', 'code'], {
      unique: true,
      name: 'graves_cemetery_id_code_unique',
    });
    await queryInterface.addIndex('graves', ['tenant_id'], { name: 'graves_tenant_id_idx' });
    await queryInterface.addIndex('graves', ['lot_id'], { name: 'graves_lot_id_idx' });
    await queryInterface.addIndex('graves', ['status_id'], { name: 'graves_status_id_idx' });
    await queryInterface.addIndex('graves', ['parent_grave_id'], { name: 'graves_parent_grave_id_idx' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('graves');
    await queryInterface.dropTable('grave_statuses');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_graves_unit_type";');
  },
};
