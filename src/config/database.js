'use strict';

require('dotenv').config();

/**
 * Configuração de conexão com o PostgreSQL via Sequelize.
 * Consumida tanto pelo sequelize-cli (migrations) quanto por src/models/index.js.
 *
 * Todas as variáveis estão documentadas em .env.example.
 */

const useSsl = String(process.env.DB_SSL).toLowerCase() === 'true';

const base = {
  username: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: process.env.DB_NAME || 'eterniza_gestao_dev',
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 5432,
  dialect: 'postgres',
  logging:
    String(process.env.DB_LOGGING).toLowerCase() === 'true'
      ? console.log // eslint-disable-line no-console
      : false,
  // Pool por INSTÂNCIA da app — deliberadamente pequeno (~20).
  //
  // ESCALA (10 mil usuários simultâneos): a app NÃO abre 10k conexões diretas
  // no Postgres. Cada instância mantém um pool enxuto e escalamos
  // HORIZONTALMENTE (várias réplicas atrás de um load balancer).
  // Na frente do Postgres deve existir um PgBouncer (pooler externo em modo
  // transaction) agregando as conexões de todas as réplicas — o Postgres
  // aguenta bem algumas centenas de conexões físicas, não milhares.
  // Regra de bolso: max_conns_postgres >= soma(DB_POOL_MAX) das réplicas via PgBouncer.
  pool: {
    max: Number(process.env.DB_POOL_MAX) || 20,
    min: Number(process.env.DB_POOL_MIN) || 2,
    acquire: Number(process.env.DB_POOL_ACQUIRE) || 30000,
    idle: Number(process.env.DB_POOL_IDLE) || 10000,
  },
  define: {
    underscored: true, // colunas em snake_case no banco
    freezeTableName: false,
  },
  dialectOptions: useSsl
    ? {
        ssl: {
          require: true,
          // Provedores gerenciados costumam usar certificados sem cadeia completa
          rejectUnauthorized: false,
        },
      }
    : {},
  // Garante consistência de fuso: timestamps sempre em UTC
  timezone: '+00:00',
};

module.exports = {
  development: { ...base },
  test: {
    ...base,
    database: process.env.DB_NAME_TEST || 'eterniza_gestao_test',
    logging: false,
  },
  production: { ...base, logging: false },
};
