'use strict';

/**
 * Estrutura física e georreferenciamento:
 *  - cemeteries: cemitérios do tenant (um tenant administra vários).
 *  - orthophotos: fotos aéreas usadas como base do mapa.
 *  - map_paths: malha de caminhos internos (polilinhas) p/ navegação GPS do visitante.
 *  - blocks (quadras) → streets (ruas) → lots (lotes/talhões): hierarquia espacial.
 *
 * Todos os níveis carregam tenant_id para reforço do isolamento multi-tenant.
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

    await queryInterface.createTable('cemeteries', {
      id,
      tenant_id: fk('tenants'),
      name: { type: Sequelize.STRING(150), allowNull: false },
      code: { type: Sequelize.STRING(30), allowNull: true },
      description: { type: Sequelize.TEXT, allowNull: true },
      address_street: { type: Sequelize.STRING(150), allowNull: true },
      address_number: { type: Sequelize.STRING(20), allowNull: true },
      address_district: { type: Sequelize.STRING(100), allowNull: true },
      address_city: { type: Sequelize.STRING(100), allowNull: true },
      address_state: { type: Sequelize.STRING(2), allowNull: true },
      address_zipcode: { type: Sequelize.STRING(9), allowNull: true },
      // ponto de partida das rotas GPS do app do visitante
      entrance_latitude: { type: Sequelize.DECIMAL(10, 7), allowNull: true },
      entrance_longitude: { type: Sequelize.DECIMAL(10, 7), allowNull: true },
      // perímetro do cemitério (array de pontos lat/lng)
      geo_polygon: { type: Sequelize.JSONB, allowNull: true },
      // permite identidade visual própria por cemitério (sobrepõe a do tenant)
      logo_url: { type: Sequelize.STRING(500), allowNull: true },
      active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      notes: { type: Sequelize.TEXT, allowNull: true },
      ...timestamps,
      deleted_at: { type: Sequelize.DATE, allowNull: true },
    });
    await queryInterface.addIndex('cemeteries', ['tenant_id'], { name: 'cemeteries_tenant_id_idx' });

    await queryInterface.createTable('orthophotos', {
      id,
      tenant_id: fk('tenants'),
      cemetery_id: fk('cemeteries', false, 'CASCADE'),
      name: { type: Sequelize.STRING(150), allowNull: false },
      file_url: { type: Sequelize.STRING(500), allowNull: false },
      // georreferenciamento da imagem: cantos/limites (bounds) em lat/lng
      bounds: { type: Sequelize.JSONB, allowNull: true },
      width_px: { type: Sequelize.INTEGER, allowNull: true },
      height_px: { type: Sequelize.INTEGER, allowNull: true },
      // resolução espacial (cm por pixel)
      resolution_cm_px: { type: Sequelize.DECIMAL(8, 3), allowNull: true },
      captured_at: { type: Sequelize.DATEONLY, allowNull: true },
      is_active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      ...timestamps,
    });
    await queryInterface.addIndex('orthophotos', ['cemetery_id'], { name: 'orthophotos_cemetery_id_idx' });

    await queryInterface.createTable('map_paths', {
      id,
      tenant_id: fk('tenants'),
      cemetery_id: fk('cemeteries', false, 'CASCADE'),
      name: { type: Sequelize.STRING(150), allowNull: true },
      // polilinha caminhável: [[lat, lng], [lat, lng], ...]
      path_coordinates: { type: Sequelize.JSONB, allowNull: false },
      is_active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      notes: { type: Sequelize.TEXT, allowNull: true },
      ...timestamps,
    });
    await queryInterface.addIndex('map_paths', ['cemetery_id'], { name: 'map_paths_cemetery_id_idx' });

    await queryInterface.createTable('blocks', {
      id,
      tenant_id: fk('tenants'),
      cemetery_id: fk('cemeteries'),
      name: { type: Sequelize.STRING(100), allowNull: false },
      code: { type: Sequelize.STRING(30), allowNull: false },
      geo_polygon: { type: Sequelize.JSONB, allowNull: true },
      notes: { type: Sequelize.TEXT, allowNull: true },
      ...timestamps,
      deleted_at: { type: Sequelize.DATE, allowNull: true },
    });
    await queryInterface.addIndex('blocks', ['cemetery_id', 'code'], {
      unique: true,
      name: 'blocks_cemetery_id_code_unique',
    });

    await queryInterface.createTable('streets', {
      id,
      tenant_id: fk('tenants'),
      cemetery_id: fk('cemeteries'),
      block_id: fk('blocks'),
      name: { type: Sequelize.STRING(100), allowNull: false },
      code: { type: Sequelize.STRING(30), allowNull: false },
      geo_polygon: { type: Sequelize.JSONB, allowNull: true },
      notes: { type: Sequelize.TEXT, allowNull: true },
      ...timestamps,
      deleted_at: { type: Sequelize.DATE, allowNull: true },
    });
    await queryInterface.addIndex('streets', ['block_id', 'code'], {
      unique: true,
      name: 'streets_block_id_code_unique',
    });
    await queryInterface.addIndex('streets', ['cemetery_id'], { name: 'streets_cemetery_id_idx' });

    await queryInterface.createTable('lots', {
      id,
      tenant_id: fk('tenants'),
      cemetery_id: fk('cemeteries'),
      street_id: fk('streets'),
      name: { type: Sequelize.STRING(100), allowNull: true },
      code: { type: Sequelize.STRING(30), allowNull: false },
      geo_polygon: { type: Sequelize.JSONB, allowNull: true },
      notes: { type: Sequelize.TEXT, allowNull: true },
      ...timestamps,
      deleted_at: { type: Sequelize.DATE, allowNull: true },
    });
    await queryInterface.addIndex('lots', ['street_id', 'code'], {
      unique: true,
      name: 'lots_street_id_code_unique',
    });
    await queryInterface.addIndex('lots', ['cemetery_id'], { name: 'lots_cemetery_id_idx' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('lots');
    await queryInterface.dropTable('streets');
    await queryInterface.dropTable('blocks');
    await queryInterface.dropTable('map_paths');
    await queryInterface.dropTable('orthophotos');
    await queryInterface.dropTable('cemeteries');
  },
};
