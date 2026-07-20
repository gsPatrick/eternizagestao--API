'use strict';

/**
 * Seed FOCADO da cidade de TESTE "fantasma" + o super_admin de suporte.
 * Idempotente (findOrCreate) e SEGURO em produção — NÃO cria dados demo do
 * seed-dev (guarulhos, etc.). Só o essencial para testar:
 *
 *   - super_admin  suporte@eternizagestao.com.br  (remetente da plataforma)
 *   - cidade       Cidade Fantasma (subdomain "fantasma", ativa/concluída)
 *   - admin        admin@fantasma.eternizagestao.com.br
 *   - cemitério    Cemitério Central de Cidade Fantasma (entrada GPS +
 *                  Quadra A / Rua 1 / Lote 1 + 2 covas) → testar mapa/ortofoto
 *
 * Senha (todas): env SEED_FANTASMA_PASSWORD ou "senha12345".
 * Rodar: `npm run seed:fantasma` (precisa das MIGRATIONS aplicadas antes).
 */

require('dotenv').config();
const { Tenant, User, Cemetery, Block, Street, Lot, Grave, GraveStatus } = require('../src/models');
const { hashPassword } = require('../src/utils/password');

const PASSWORD = process.env.SEED_FANTASMA_PASSWORD || 'senha12345';

async function foc(Model, where, defaults = {}) {
  const [row] = await Model.findOrCreate({
    where,
    defaults: { ...where, ...defaults },
    skipAudit: true,
  });
  return row;
}

(async () => {
  const passwordHash = await hashPassword(PASSWORD);

  // super_admin de suporte (remetente da plataforma no Resend)
  await foc(
    User,
    { email: 'suporte@eternizagestao.com.br', tenantId: null },
    { name: 'Suporte Eterniza', role: 'super_admin', passwordHash, active: true }
  );

  // cidade FANTASMA
  const fantasma = await foc(
    Tenant,
    { subdomain: 'fantasma' },
    {
      name: 'Cidade Fantasma',
      legalName: 'Prefeitura de Cidade Fantasma — Serviços Funerários',
      cnpj: '00.000.000/0001-00',
      email: 'contato@fantasma.eternizagestao.com.br',
      phone: '+551100000000',
      primaryColor: '#4b5563',
      secondaryColor: '#9ca3af',
      addressCity: 'Cidade Fantasma',
      addressState: 'SP',
      onboardingStatus: 'concluido',
      settings: { fqdn: 'fantasma.eternizagestao.com.br', isDefault: false },
      active: true,
    }
  );

  await foc(
    User,
    { email: 'admin@fantasma.eternizagestao.com.br', tenantId: fantasma.id },
    { name: 'Admin Fantasma', role: 'admin', passwordHash, active: true }
  );

  // cemitério mínimo (com entrada GPS) — para testar mapa/ortofoto/estrutura
  const livre = await GraveStatus.findOne({ where: { slug: 'livre', tenantId: null } });
  const cemF = await foc(
    Cemetery,
    { tenantId: fantasma.id, code: 'CEM-FANTASMA-01' },
    {
      name: 'Cemitério Central de Cidade Fantasma',
      addressCity: 'Cidade Fantasma',
      addressState: 'SP',
      entranceLatitude: -12.2664,
      entranceLongitude: -38.9663,
      managerName: 'Prefeitura de Cidade Fantasma',
    }
  );
  const blk = await foc(Block, { cemeteryId: cemF.id, code: 'A' }, { tenantId: fantasma.id, name: 'Quadra A' });
  const st = await foc(Street, { blockId: blk.id, code: 'R1' }, { tenantId: fantasma.id, cemeteryId: cemF.id, name: 'Rua 1' });
  const lot = await foc(Lot, { streetId: st.id, code: 'L1' }, { tenantId: fantasma.id, cemeteryId: cemF.id, name: 'Lote 1' });
  if (livre) {
    for (let i = 1; i <= 2; i += 1) {
      await foc(
        Grave,
        { cemeteryId: cemF.id, code: `COVA-${String(i).padStart(3, '0')}` },
        { tenantId: fantasma.id, lotId: lot.id, unitType: 'cova', statusId: livre.id, capacity: 1 }
      );
    }
  } else {
    console.warn('[seed-fantasma] status "livre" não encontrado — covas não criadas (rode as migrations/seed de status).');
  }

  console.log('[seed-fantasma] OK.');
  console.log('  super_admin  : suporte@eternizagestao.com.br');
  console.log('  admin cidade : admin@fantasma.eternizagestao.com.br  (subdomain: fantasma)');
  console.log(`  senha (todas): ${PASSWORD}`);
  process.exit(0);
})().catch((err) => {
  console.error('[seed-fantasma] erro:', err.message);
  process.exit(1);
});
