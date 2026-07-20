'use strict';

/**
 * Seed de PRODUÇÃO — cria SOMENTE o super_admin padrão da plataforma.
 * Idempotente (findOrCreate) e sem auditoria (skipAudit). O resto do sistema
 * fica vazio; o super_admin loga em /admin/login e cria as cidades.
 *
 * E-mail/senha vêm das envs SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD; sem elas,
 * usa os defaults abaixo. Roda automaticamente no start do container (Dockerfile)
 * e também via `npm run seed:admin`.
 */

const { User } = require('../src/models');
const { hashPassword } = require('../src/utils/password');

const EMAIL = (process.env.SEED_ADMIN_EMAIL || 'eternizagestaoadmin@gmail.com').trim().toLowerCase();
const PASSWORD = process.env.SEED_ADMIN_PASSWORD || 'eternizagestao';

(async () => {
  const passwordHash = await hashPassword(PASSWORD);
  const [, created] = await User.findOrCreate({
    where: { email: EMAIL, tenantId: null },
    defaults: { name: 'Administrador', role: 'super_admin', passwordHash, active: true },
    skipAudit: true,
  });
  console.log(
    created
      ? `[seed-admin] super_admin criado: ${EMAIL}`
      : `[seed-admin] super_admin já existe: ${EMAIL} (nada alterado)`
  );
  process.exit(0);
})().catch((err) => {
  console.error('[seed-admin] erro:', err.message);
  process.exit(1);
});
