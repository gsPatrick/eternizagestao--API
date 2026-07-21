'use strict';

/**
 * SEED DE DESENVOLVIMENTO — Eterniza Gestão (multi-tenant, dados reais na API).
 *
 * Uso: node scripts/seed-dev.js   (ou `npm run seed:dev`)
 *
 * Idempotente: usa SEMPRE findOrCreate com chave natural. Rodar N vezes NÃO
 * duplica nem dropa nada. Nunca usa DROP/TRUNCATE.
 *
 * Auditoria: todo create/update passa `skipAudit: true`, então os hooks globais
 * de auditoria (src/models/audit-hooks.js) retornam cedo e o seed não polui
 * audit_logs nem depende de contexto de ator (ALS).
 *
 * O QUE É CRIADO
 * -------------------------------------------------------------------------
 * TENANTS (subdomínio = slug curto, igual ao `id` do FRONT/lib/tenants.js):
 *   demo (mantido)  guarulhos (PADRÃO/cheio)  sao-paulo  osasco  campinas
 *   santos  ribeirao  sorocaba
 *   Marca (primaryColor=accent, secondaryColor=accentBright) espelha o FRONT.
 *
 * CONTAS ADMINISTRATIVAS (senha: senha12345) — ver bloco final de credenciais.
 *   super@eterniza.dev (super_admin, sem tenant)
 *   admin@guarulhos.eternizagestao.com.br (admin, guarulhos)
 *   operador@guarulhos.eternizagestao.com.br (operador, guarulhos)
 *   consulta@guarulhos.eternizagestao.com.br (consulta, guarulhos)
 *   (mantém também admin@demo.dev / operador@demo.dev do seed antigo)
 *
 * PORTAL DA FAMÍLIA (FamilyPortalAccount, senha: senha12345):
 *   familia@guarulhos.eternizagestao.com.br → vinculado ao titular João Batista Silva,
 *   que possui jazigo, concessão perpétua e cobranças (paga/pendente/atrasada).
 *
 * DOMÍNIO — guarulhos é o tenant "cheio": cemitérios, quadras/ruas/lotes,
 * sepulturas (covas, jazigo com gavetas, túmulo), concessões (perpétua e
 * temporária a vencer), sepultados + sepultamentos (alguns neste mês), taxas +
 * cobranças (pago/pendente/em_atraso) + pagamentos, capelas + agendamentos
 * (alguns HOJE), documentos, notificações, ossário + nichos com depósito,
 * exumação, manutenção e eventos de linha do tempo. Demais cidades recebem um
 * conjunto leve (1 cemitério + estrutura + sepulturas + sepultados) para a
 * BUSCA PÚBLICA por cidade funcionar.
 */

require('dotenv').config();

const {
  sequelize,
  Tenant,
  User,
  Cemetery,
  Block,
  Street,
  Lot,
  GraveStatus,
  Grave,
  Person,
  PersonRelationship,
  FamilyPortalAccount,
  Concession,
  Deceased,
  Burial,
  FeeType,
  MaintenanceFee,
  Billing,
  Payment,
  Chapel,
  Schedule,
  DocumentTemplate,
  Document,
  DocumentSequence,
  Notification,
  Ossuary,
  OssuaryNiche,
  Exhumation,
  RemainsDeposit,
  GraveEvent,
  GraveMaintenance,
} = require('../src/models');
const { hashPassword } = require('../src/utils/password');
const storage = require('../src/providers/storage');
const zlib = require('zlib');

const PASSWORD = 'senha12345';

/* ============================ helpers ============================ */

// findOrCreate idempotente, sem auditoria. `where` é a chave natural.
async function foc(Model, where, defaults = {}) {
  const [row] = await Model.findOrCreate({
    where,
    defaults: { ...where, ...defaults },
    skipAudit: true,
  });
  return row;
}

// PNG sólido NxN de uma cor RGB (sem libs externas) → Buffer.
function solidPng(size, [r, g, b]) {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(body) >>> 0, 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; // bit depth 8, color type 2 (RGB)
  const row = Buffer.concat([Buffer.from([0]), Buffer.concat(Array(size).fill(Buffer.from([r, g, b])))]);
  const raw = Buffer.concat(Array(size).fill(row));
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// cor determinística a partir do nome (paleta navy/verde da identidade)
function colorFor(seed) {
  const palette = [[3, 46, 89], [26, 127, 92], [91, 138, 194], [154, 107, 21], [14, 28, 47], [176, 53, 53]];
  let h = 0;
  for (let i = 0; i < String(seed).length; i++) h = (h * 31 + String(seed).charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}

// Garante uma foto de perfil para a pessoa (idempotente: só cria se faltar).
// Usa o mesmo provider de storage do upload real → o painel exibe via /files.
async function ensurePhoto(person) {
  if (!person || person.photoUrl) return person;
  const png = solidPng(96, colorFor(person.fullName || person.id));
  const saved = await storage.saveFile({
    tenantId: person.tenantId,
    fileName: `avatar-${person.id}.png`,
    contentBase64: png.toString('base64'),
    mimeType: 'image/png',
  });
  await person.update({ photoUrl: saved.fileUrl }, { skipAudit: true });
  return person;
}

const now = new Date();
const Y = now.getUTCFullYear();
const M = now.getUTCMonth(); // 0-based
const D = now.getUTCDate();

// DATEONLY 'YYYY-MM-DD'
function ymd(year, monthIndex, day) {
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
function addDaysYmd(days) {
  const d = new Date(Date.UTC(Y, M, D));
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
// timestamp de HOJE numa dada hora (UTC)
function todayAt(hour, minute = 0) {
  return new Date(Date.UTC(Y, M, D, hour, minute, 0));
}
function daysAgo(days) {
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() - days);
  return d;
}

const thisMonthRef = `${Y}-${String(M + 1).padStart(2, '0')}`; // '2026-07'
const prevMonthRef = M === 0 ? `${Y - 1}-12` : `${Y}-${String(M).padStart(2, '0')}`;

/* ============================ marca (espelha o FRONT) ============================ */

// slug curto (subdomínio + o que o front usa como id) → identidade de marca.
const BRANDS = {
  guarulhos: {
    name: 'Prefeitura de Guarulhos', accent: '#1a5c3a', bright: '#288a58', deep: '#123f28',
    city: 'Guarulhos', fqdn: 'guarulhos.eternizagestao.com.br',
  },
  'sao-paulo': {
    name: 'Prefeitura de São Paulo', accent: '#7a1b1b', bright: '#a83232', deep: '#571010',
    city: 'São Paulo', fqdn: 'saopaulo.eternizagestao.com.br',
  },
  osasco: {
    name: 'Prefeitura de Osasco', accent: '#5b3a8c', bright: '#7a52b8', deep: '#412963',
    city: 'Osasco', fqdn: 'osasco.eternizagestao.com.br',
  },
  campinas: {
    name: 'Prefeitura de Campinas', accent: '#0f6b6b', bright: '#189494', deep: '#0a4a4a',
    city: 'Campinas', fqdn: 'campinas.eternizagestao.com.br',
  },
  santos: {
    name: 'Prefeitura de Santos', accent: '#12507a', bright: '#1d70a8', deep: '#0c3854',
    city: 'Santos', fqdn: 'santos.eternizagestao.com.br',
  },
  ribeirao: {
    name: 'Prefeitura de Ribeirão Preto', accent: '#a8532b', bright: '#c96e42', deep: '#7c3c1f',
    city: 'Ribeirão Preto', fqdn: 'ribeirao.eternizagestao.com.br',
  },
  sorocaba: {
    name: 'Prefeitura de Sorocaba', accent: '#3a3f8c', bright: '#5257b8', deep: '#292d63',
    city: 'Sorocaba', fqdn: 'sorocaba.eternizagestao.com.br',
  },
};

async function upsertTenant(slug, { isDefault = false } = {}) {
  const b = BRANDS[slug];
  return foc(
    Tenant,
    { subdomain: slug },
    {
      name: b.name,
      legalName: `${b.name} — Secretaria de Serviços Funerários`,
      cnpj: '46.523.171/0001-77',
      email: `cemiterios@${b.fqdn}`,
      phone: '+551123456789',
      whatsapp: '+5511987654321',
      primaryColor: b.accent,
      secondaryColor: b.bright,
      addressCity: b.city,
      addressState: 'SP',
      settings: { accentDeep: b.deep, fqdn: b.fqdn, isDefault },
      active: true,
    }
  );
}

/* ============================ grave statuses (sistema) ============================ */

let STATUS = {}; // slug -> instância (statuses de sistema, tenant_id NULL)
async function loadStatuses() {
  const rows = await GraveStatus.findAll({ where: { tenantId: null } });
  STATUS = Object.fromEntries(rows.map((s) => [s.slug, s]));
}

/* ============================ contas administrativas ============================ */

async function upsertUser({ email, name, role, tenantId }) {
  const passwordHash = await hashPassword(PASSWORD);
  return foc(User, { email, tenantId: tenantId ?? null }, { name, role, passwordHash, active: true });
}

/* ============================ tenant leve (demais cidades) ============================ */

async function seedLightCity(tenant) {
  const b = BRANDS[tenant.subdomain];
  const cemetery = await foc(
    Cemetery,
    { tenantId: tenant.id, code: `CEM-${tenant.subdomain.toUpperCase().slice(0, 4)}-01` },
    {
      name: `Cemitério Municipal de ${b.city}`,
      addressCity: b.city,
      addressState: 'SP',
      managerName: b.name,
      brandPrimaryColor: b.accent,
      brandSecondaryColor: b.bright,
    }
  );
  const block = await foc(Block, { cemeteryId: cemetery.id, code: 'A' }, { tenantId: tenant.id, name: 'Quadra A' });
  const street = await foc(Street, { blockId: block.id, code: 'R1' }, { tenantId: tenant.id, cemeteryId: cemetery.id, name: 'Rua 1' });
  const lot = await foc(Lot, { streetId: street.id, code: 'L1' }, { tenantId: tenant.id, cemeteryId: cemetery.id, name: 'Lote 1' });

  const graves = [];
  for (let i = 1; i <= 3; i += 1) {
    const g = await foc(
      Grave,
      { cemeteryId: cemetery.id, code: `COVA-${String(i).padStart(3, '0')}` },
      {
        tenantId: tenant.id,
        lotId: lot.id,
        unitType: 'cova',
        statusId: (i === 1 ? STATUS.ocupada : STATUS.livre).id,
        capacity: 1,
      }
    );
    graves.push(g);
  }

  // pessoas + sepultados para a busca pública funcionar por cidade
  const people = [
    { fullName: `Responsável ${b.city} 1`, cpf: `700.000.00${tenant.subdomain.length}-01` },
    { fullName: `Responsável ${b.city} 2`, cpf: `700.000.00${tenant.subdomain.length}-02` },
  ];
  for (const p of people) {
    await foc(Person, { tenantId: tenant.id, cpf: p.cpf }, { fullName: p.fullName, addressCity: b.city, addressState: 'SP' });
  }

  const deceasedList = [
    { fullName: `José da Silva (${b.city})`, deathDate: addDaysYmd(-40), birthDate: '1948-03-12' },
    { fullName: `Maria Aparecida (${b.city})`, deathDate: addDaysYmd(-8), birthDate: '1950-09-01' },
  ];
  for (let i = 0; i < deceasedList.length; i += 1) {
    const dc = deceasedList[i];
    const grave = graves[0];
    const deceased = await foc(
      Deceased,
      { tenantId: tenant.id, fullName: dc.fullName, deathDate: dc.deathDate },
      { birthDate: dc.birthDate, currentGraveId: grave.id, currentLocationType: 'sepultado' }
    );
    await foc(
      Burial,
      { graveId: grave.id, deceasedId: deceased.id },
      { tenantId: tenant.id, cemeteryId: cemetery.id, burialDate: dc.deathDate, status: 'ativo' }
    );
  }

  return { cemetery: 1, graves: graves.length, people: people.length, deceased: deceasedList.length };
}

/* ============================ tenant CHEIO (guarulhos) ============================ */

async function seedGuarulhos(tenant, users) {
  const b = BRANDS.guarulhos;
  const adminId = users.admin.id;
  const operadorId = users.operador.id;

  // ---- Cemitérios ----
  const cemMain = await foc(
    Cemetery,
    { tenantId: tenant.id, code: 'CEM-GRU-01' },
    {
      name: 'Cemitério Municipal de Guarulhos',
      description: 'Cemitério central do município.',
      addressStreet: 'Av. Monteiro Lobato', addressNumber: '1200', addressDistrict: 'Macedo',
      addressCity: b.city, addressState: 'SP', addressZipcode: '07112-000',
      entranceLatitude: -23.4538, entranceLongitude: -46.5333,
      managerName: b.name, managerDocument: '46.523.171/0001-77',
      managerPhone: '+551123456700', managerEmail: `cemiterios@${b.fqdn}`,
      brandPrimaryColor: b.accent, brandSecondaryColor: b.bright,
    }
  );
  const cemPark = await foc(
    Cemetery,
    { tenantId: tenant.id, code: 'CEM-GRU-02' },
    {
      name: 'Cemitério Parque das Flores',
      addressCity: b.city, addressState: 'SP',
      entranceLatitude: -23.42, entranceLongitude: -46.51,
      managerName: b.name, brandPrimaryColor: b.accent, brandSecondaryColor: b.bright,
    }
  );

  // ---- Situação customizada do tenant (demonstra cadastro por tenant) ----
  await foc(
    GraveStatus,
    { tenantId: tenant.id, slug: 'aguardando_regularizacao' },
    { name: 'Aguardando Regularização', color: '#F97316', allowsBurial: false }
  );

  // ---- Estrutura física (cemitério principal) ----
  const blockA = await foc(Block, { cemeteryId: cemMain.id, code: 'A' }, { tenantId: tenant.id, name: 'Quadra A', notes: 'Setor histórico' });
  const blockB = await foc(Block, { cemeteryId: cemMain.id, code: 'B' }, { tenantId: tenant.id, name: 'Quadra B' });

  const streetA1 = await foc(Street, { blockId: blockA.id, code: 'A-R1' }, { tenantId: tenant.id, cemeteryId: cemMain.id, name: 'Rua das Palmeiras' });
  const streetA2 = await foc(Street, { blockId: blockA.id, code: 'A-R2' }, { tenantId: tenant.id, cemeteryId: cemMain.id, name: 'Rua dos Ciprestes' });
  const streetB1 = await foc(Street, { blockId: blockB.id, code: 'B-R1' }, { tenantId: tenant.id, cemeteryId: cemMain.id, name: 'Rua Central' });

  const lotA1 = await foc(Lot, { streetId: streetA1.id, code: 'A-R1-L1' }, { tenantId: tenant.id, cemeteryId: cemMain.id, name: 'Lote 1' });
  const lotA2 = await foc(Lot, { streetId: streetA2.id, code: 'A-R2-L1' }, { tenantId: tenant.id, cemeteryId: cemMain.id, name: 'Lote 1' });
  const lotB1 = await foc(Lot, { streetId: streetB1.id, code: 'B-R1-L1' }, { tenantId: tenant.id, cemeteryId: cemMain.id, name: 'Lote 1' });

  // ---- Sepulturas ----
  // covas simples com status variado
  const covas = [];
  const covaSpec = [
    { code: 'COVA-001', status: 'ocupada' },
    { code: 'COVA-002', status: 'livre' },
    { code: 'COVA-003', status: 'reservada' },
    { code: 'COVA-004', status: 'em_manutencao' },
    { code: 'COVA-005', status: 'interditada' },
  ];
  for (const c of covaSpec) {
    const g = await foc(
      Grave,
      { cemeteryId: cemMain.id, code: c.code },
      {
        tenantId: tenant.id, lotId: lotA1.id, unitType: 'cova',
        statusId: STATUS[c.status].id, capacity: 1,
        latitude: -23.4539, longitude: -46.5334,
      }
    );
    covas.push(g);
  }

  // JAZIGO-001: perpétuo, com 4 gavetas (página Gavetas)
  const jazigo1 = await foc(
    Grave,
    { cemeteryId: cemMain.id, code: 'JAZ-001' },
    {
      tenantId: tenant.id, lotId: lotA2.id, unitType: 'jazigo',
      statusId: STATUS.em_perpetuidade.id, capacity: 4, areaM2: 6.0,
      latitude: -23.454, longitude: -46.5336,
    }
  );
  const gavetas1 = [];
  for (let i = 1; i <= 4; i += 1) {
    const occupied = i === 1; // 1ª gaveta ocupada
    const g = await foc(
      Grave,
      { cemeteryId: cemMain.id, code: `JAZ-001-G${i}` },
      {
        tenantId: tenant.id, lotId: lotA2.id, unitType: 'gaveta',
        parentGraveId: jazigo1.id, statusId: (occupied ? STATUS.ocupada : STATUS.livre).id, capacity: 1,
      }
    );
    gavetas1.push(g);
  }

  // JAZIGO-002: temporário (a vencer), 2 gavetas
  const jazigo2 = await foc(
    Grave,
    { cemeteryId: cemMain.id, code: 'JAZ-002' },
    {
      tenantId: tenant.id, lotId: lotB1.id, unitType: 'jazigo',
      statusId: STATUS.ocupada.id, capacity: 2, areaM2: 4.0,
    }
  );
  for (let i = 1; i <= 2; i += 1) {
    await foc(
      Grave,
      { cemeteryId: cemMain.id, code: `JAZ-002-G${i}` },
      {
        tenantId: tenant.id, lotId: lotB1.id, unitType: 'gaveta',
        parentGraveId: jazigo2.id, statusId: (i === 1 ? STATUS.ocupada : STATUS.livre).id, capacity: 1,
      }
    );
  }

  // Túmulo bloqueado por inadimplência
  const tumulo = await foc(
    Grave,
    { cemeteryId: cemMain.id, code: 'TUM-001' },
    {
      tenantId: tenant.id, lotId: lotB1.id, unitType: 'tumulo',
      statusId: STATUS.ocupada.id, capacity: 2,
      isBlocked: true, blockedReason: 'Inadimplência da taxa de manutenção',
    }
  );

  // ---- Pessoas ----
  // Titular do portal da família: possui jazigo, concessão e cobranças.
  const titular = await foc(
    Person,
    { tenantId: tenant.id, cpf: '111.111.111-11' },
    {
      fullName: 'João Batista Silva', rg: '12.345.678-9', birthDate: '1959-04-22', gender: 'masculino',
      email: 'joao.silva@example.com', phonePrimary: '+551133334444', whatsapp: '+5511988887777',
      addressStreet: 'Rua das Acácias', addressNumber: '45', addressDistrict: 'Centro',
      addressCity: b.city, addressState: 'SP', addressZipcode: '07010-000',
    }
  );
  const maria = await foc(
    Person,
    { tenantId: tenant.id, cpf: '222.222.222-22' },
    { fullName: 'Maria Oliveira Souza', birthDate: '1965-11-03', gender: 'feminino', email: 'maria.souza@example.com', phonePrimary: '+551133335555', whatsapp: '+5511977776666', addressCity: b.city, addressState: 'SP' }
  );
  const antonio = await foc(
    Person,
    { tenantId: tenant.id, cpf: '333.333.333-33' },
    { fullName: 'Antônio Pereira Lima', birthDate: '1952-07-19', gender: 'masculino', phonePrimary: '+551133336666', addressCity: b.city, addressState: 'SP' }
  );
  const filhaTitular = await foc(
    Person,
    { tenantId: tenant.id, cpf: '444.444.444-44' },
    { fullName: 'Ana Paula Silva', birthDate: '1988-02-10', gender: 'feminino', email: 'ana.silva@example.com', addressCity: b.city, addressState: 'SP' }
  );
  const carlos = await foc(
    Person,
    { tenantId: tenant.id, cpf: '555.555.555-55' },
    { fullName: 'Carlos Henrique Dias', birthDate: '1970-06-30', gender: 'masculino', phonePrimary: '+551133337777', addressCity: b.city, addressState: 'SP' }
  );

  // Vínculo familiar (titular → filha)
  await foc(
    PersonRelationship,
    { personId: titular.id, relatedPersonId: filhaTitular.id, relationshipType: 'filha' },
    { tenantId: tenant.id, notes: 'Herdeira / responsável secundária' }
  );

  // ---- Portal da Família (conta do titular) ----
  const portalHash = await hashPassword(PASSWORD);
  await foc(
    FamilyPortalAccount,
    { tenantId: tenant.id, email: `familia@${b.fqdn}` },
    { personId: titular.id, passwordHash: portalHash, status: 'ativo', lastLoginAt: daysAgo(2) }
  );

  // Fotos de perfil (§3.3 — anexo de foto). Idempotente.
  for (const p of [titular, maria, antonio, filhaTitular, carlos]) {
    await ensurePhoto(p);
  }

  // ---- Concessões ----
  // proprietário = personId; responsável LEGAL = responsiblePersonId (distinto).
  // Ana Paula e Carlos são RESPONSÁVEIS (não proprietários) → separam as views.
  const concJazigo1 = await foc(
    Concession,
    { tenantId: tenant.id, contractNumber: 'CON-2020-0001' },
    {
      graveId: jazigo1.id, personId: titular.id, responsiblePersonId: filhaTitular.id,
      concessionType: 'perpetua',
      startDate: '2020-03-15', status: 'ativa', acquisitionMethod: 'emissao', value: 8500.0,
    }
  );
  const concJazigo2 = await foc(
    Concession,
    { tenantId: tenant.id, contractNumber: 'CON-2024-0007' },
    {
      graveId: jazigo2.id, personId: maria.id, responsiblePersonId: carlos.id,
      concessionType: 'temporaria',
      startDate: '2024-01-10', endDate: addDaysYmd(35), status: 'ativa', acquisitionMethod: 'emissao', value: 2400.0,
    }
  );
  const concTumulo = await foc(
    Concession,
    { tenantId: tenant.id, contractNumber: 'CON-2019-0003' },
    {
      graveId: tumulo.id, personId: antonio.id,
      concessionType: 'temporaria',
      startDate: '2019-05-01', endDate: addDaysYmd(-20), status: 'vencida', acquisitionMethod: 'regularizacao', value: 1800.0,
    }
  );
  // garante o responsável mesmo em bases já semeadas (foc não atualiza existentes)
  if (!concJazigo1.responsiblePersonId) await concJazigo1.update({ responsiblePersonId: filhaTitular.id }, { skipAudit: true });
  if (!concJazigo2.responsiblePersonId) await concJazigo2.update({ responsiblePersonId: carlos.id }, { skipAudit: true });
  void concTumulo;

  // ---- Sepultados + sepultamentos ----
  // 1) na gaveta ocupada do jazigo1 (sepultamento neste mês)
  const decEsposa = await foc(
    Deceased,
    { tenantId: tenant.id, fullName: 'Terezinha Batista Silva', deathDate: ymd(Y, M, Math.min(5, D)) },
    {
      cpf: '900.111.222-33', birthDate: '1961-08-14', gender: 'feminino', motherName: 'Alzira Batista',
      causeOfDeath: 'Causas naturais', deathCertificateNumber: 'OB-2026-0451',
      currentGraveId: gavetas1[0].id, currentLocationType: 'sepultado',
    }
  );
  await foc(
    Burial,
    { graveId: gavetas1[0].id, deceasedId: decEsposa.id },
    {
      tenantId: tenant.id, cemeteryId: cemMain.id, burialDate: ymd(Y, M, Math.min(5, D)),
      burialTime: '10:30:00', declarantPersonId: titular.id, funeralHome: 'Funerária Central Guarulhos',
      authorizationNumber: '0044/2026', status: 'ativo', registeredByUserId: operadorId,
    }
  );

  // 2) em cova ocupada (sepultamento neste mês)
  const decAvo = await foc(
    Deceased,
    { tenantId: tenant.id, fullName: 'Sebastião Pereira Lima', deathDate: ymd(Y, M, Math.min(12, D)) },
    { birthDate: '1940-01-20', gender: 'masculino', currentGraveId: covas[0].id, currentLocationType: 'sepultado' }
  );
  await foc(
    Burial,
    { graveId: covas[0].id, deceasedId: decAvo.id },
    { tenantId: tenant.id, cemeteryId: cemMain.id, burialDate: ymd(Y, M, Math.min(12, D)), declarantPersonId: antonio.id, status: 'ativo', registeredByUserId: operadorId }
  );

  // 3) sepultamento antigo em JAZ-002
  const decAntigo = await foc(
    Deceased,
    { tenantId: tenant.id, fullName: 'Rosa Maria Oliveira', deathDate: '2024-11-02' },
    { birthDate: '1945-05-05', gender: 'feminino', currentGraveId: jazigo2.id, currentLocationType: 'sepultado' }
  );
  await foc(
    Burial,
    { graveId: jazigo2.id, deceasedId: decAntigo.id },
    { tenantId: tenant.id, cemeteryId: cemMain.id, burialDate: '2024-11-03', status: 'ativo', registeredByUserId: operadorId }
  );

  // 4) sepultado que foi exumado e depositado no ossário (currentLocationType ossario)
  const decExumado = await foc(
    Deceased,
    { tenantId: tenant.id, fullName: 'Benedito Alves Costa', deathDate: '2010-02-15' },
    { birthDate: '1930-03-10', gender: 'masculino', currentLocationType: 'ossario' }
  );
  const burialExumado = await foc(
    Burial,
    { graveId: covas[3] ? covas[3].id : covas[1].id, deceasedId: decExumado.id },
    { tenantId: tenant.id, cemeteryId: cemMain.id, burialDate: '2010-02-16', status: 'exumado', registeredByUserId: operadorId }
  );

  // ---- Financeiro ----
  const feeAnual = await foc(
    FeeType,
    { tenantId: tenant.id, name: 'Taxa de Manutenção Anual' },
    { description: 'Conservação e limpeza do jazigo.', defaultAmount: 180.0, periodicity: 'anual' }
  );
  const feeSepult = await foc(
    FeeType,
    { tenantId: tenant.id, name: 'Taxa de Sepultamento' },
    { description: 'Serviço de sepultamento.', defaultAmount: 320.0, periodicity: 'unica' }
  );

  const mfTitular = await foc(
    MaintenanceFee,
    { graveId: jazigo1.id, feeTypeId: feeAnual.id, payerPersonId: titular.id },
    {
      tenantId: tenant.id, concessionId: concJazigo1.id, amount: 180.0, periodicity: 'anual',
      dueDay: 10, dueMonth: 3, nextDueDate: ymd(Y + 1, 2, 10), status: 'ativa',
    }
  );
  const mfMaria = await foc(
    MaintenanceFee,
    { graveId: jazigo2.id, feeTypeId: feeAnual.id, payerPersonId: maria.id },
    { tenantId: tenant.id, amount: 180.0, periodicity: 'anual', dueDay: 5, dueMonth: 1, nextDueDate: ymd(Y + 1, 0, 5), status: 'ativa' }
  );
  const mfAntonio = await foc(
    MaintenanceFee,
    { graveId: tumulo.id, feeTypeId: feeAnual.id, payerPersonId: antonio.id },
    { tenantId: tenant.id, amount: 180.0, periodicity: 'anual', dueDay: 15, dueMonth: 6, nextDueDate: addDaysYmd(-30), status: 'ativa' }
  );

  // Cobranças: pago / pendente / em_atraso (para inadimplência e aging)
  // 1) PAGA (ano anterior)
  const billPago = await foc(
    Billing,
    { tenantId: tenant.id, code: 'COB-2026-0001' },
    {
      cemeteryId: cemMain.id, graveId: jazigo1.id, maintenanceFeeId: mfTitular.id, payerPersonId: titular.id,
      origin: 'taxa_manutencao', description: 'Taxa de manutenção anual 2025', referencePeriod: `${Y - 1}-03`,
      amount: 180.0, totalAmount: 180.0, dueDate: ymd(Y - 1, 2, 10), status: 'pago',
      gatewayProvider: 'mock', gatewayChargeId: 'chg_mock_0001',
    }
  );
  await foc(
    Payment,
    { billingId: billPago.id },
    {
      tenantId: tenant.id, paidAt: new Date(Date.UTC(Y - 1, 2, 9, 14, 0, 0)), amountPaid: 180.0,
      method: 'pix', receiptNumber: 'REC-2025-0001', reconciled: true, reconciledAt: new Date(Date.UTC(Y - 1, 2, 9, 14, 5, 0)),
      registeredByUserId: operadorId,
    }
  );

  // 2) PENDENTE (vence no futuro)
  await foc(
    Billing,
    { tenantId: tenant.id, code: 'COB-2026-0002' },
    {
      cemeteryId: cemMain.id, graveId: jazigo1.id, maintenanceFeeId: mfTitular.id, payerPersonId: titular.id,
      origin: 'taxa_manutencao', description: 'Taxa de manutenção anual 2026', referencePeriod: `${Y}-03`,
      amount: 180.0, totalAmount: 180.0, dueDate: addDaysYmd(25), status: 'pendente',
      gatewayProvider: 'mock', gatewayChargeId: 'chg_mock_0002',
      pixCopyPaste: '00020126...mockpix...5204000053039865802BR',
    }
  );

  // 3) EM ATRASO (vencida — Antônio, gera inadimplência/bloqueio do túmulo)
  await foc(
    Billing,
    { tenantId: tenant.id, code: 'COB-2026-0003' },
    {
      cemeteryId: cemMain.id, graveId: tumulo.id, maintenanceFeeId: mfAntonio.id, payerPersonId: antonio.id,
      origin: 'taxa_manutencao', description: 'Taxa de manutenção anual 2026', referencePeriod: `${Y}-06`,
      amount: 180.0, fineAmount: 3.6, interestAmount: 5.4, totalAmount: 189.0, dueDate: addDaysYmd(-45), status: 'em_atraso',
      gatewayProvider: 'mock', gatewayChargeId: 'chg_mock_0003',
    }
  );

  // 4) EM ATRASO (Maria — aging mais recente)
  await foc(
    Billing,
    { tenantId: tenant.id, code: 'COB-2026-0004' },
    {
      cemeteryId: cemMain.id, graveId: jazigo2.id, maintenanceFeeId: mfMaria.id, payerPersonId: maria.id,
      origin: 'taxa_manutencao', description: 'Taxa de manutenção anual 2026', referencePeriod: `${Y}-01`,
      amount: 180.0, fineAmount: 3.6, interestAmount: 2.0, totalAmount: 185.6, dueDate: addDaysYmd(-12), status: 'em_atraso',
      gatewayProvider: 'mock', gatewayChargeId: 'chg_mock_0004',
    }
  );

  // 5) AVULSA pendente (serviço) — sem maintenanceFee
  await foc(
    Billing,
    { tenantId: tenant.id, code: 'COB-2026-0005' },
    {
      cemeteryId: cemMain.id, graveId: gavetas1[0].id, payerPersonId: titular.id,
      origin: 'servico', description: 'Taxa de sepultamento — Terezinha B. Silva',
      amount: 320.0, totalAmount: 320.0, dueDate: addDaysYmd(10), status: 'pendente',
    }
  );

  // ---- Capelas + agendamentos (alguns HOJE) ----
  const capela1 = await foc(Chapel, { cemeteryId: cemMain.id, name: 'Capela São Judas' }, { tenantId: tenant.id, code: 'CAP-01', capacity: 80 });
  const capela2 = await foc(Chapel, { cemeteryId: cemMain.id, name: 'Capela Central' }, { tenantId: tenant.id, code: 'CAP-02', capacity: 50 });

  // velório HOJE (capela 1)
  await foc(
    Schedule,
    { tenantId: tenant.id, title: 'Velório — Terezinha Batista Silva' },
    {
      cemeteryId: cemMain.id, chapelId: capela1.id, deceasedId: decEsposa.id, responsiblePersonId: titular.id,
      scheduleType: 'velorio', startsAt: todayAt(9), endsAt: todayAt(12), status: 'confirmado', createdByUserId: operadorId,
    }
  );
  // sepultamento HOJE (capela 2)
  await foc(
    Schedule,
    { tenantId: tenant.id, title: 'Sepultamento — Sebastião Pereira Lima' },
    {
      cemeteryId: cemMain.id, chapelId: capela2.id, graveId: covas[0].id, deceasedId: decAvo.id, responsiblePersonId: antonio.id,
      scheduleType: 'sepultamento', startsAt: todayAt(14), endsAt: todayAt(15, 30), status: 'agendado', createdByUserId: operadorId,
    }
  );
  // visita técnica futura
  await foc(
    Schedule,
    { tenantId: tenant.id, title: 'Visita técnica — vistoria Quadra A' },
    {
      cemeteryId: cemMain.id, scheduleType: 'visita_tecnica',
      startsAt: new Date(Date.UTC(Y, M, D + 3, 8, 0, 0)), endsAt: new Date(Date.UTC(Y, M, D + 3, 10, 0, 0)),
      status: 'agendado', createdByUserId: adminId,
    }
  );

  // Eventos PÚBLICOS FUTUROS (velório/sepultamento) — garantem que a AGENDA
  // PÚBLICA sempre tenha próximos eventos (os "de hoje" viram passado no dia).
  const fut = (days, hour, min = 0) => new Date(Date.UTC(Y, M, D + days, hour, min, 0));
  await foc(
    Schedule,
    { tenantId: tenant.id, title: 'Velório — Rosa Maria Oliveira' },
    {
      cemeteryId: cemMain.id, chapelId: capela1.id, deceasedId: decAvo.id, responsiblePersonId: titular.id,
      scheduleType: 'velorio', startsAt: fut(1, 15), endsAt: fut(1, 18), status: 'confirmado', createdByUserId: operadorId,
    }
  );
  await foc(
    Schedule,
    { tenantId: tenant.id, title: 'Sepultamento — Benedito Alves Costa' },
    {
      cemeteryId: cemMain.id, chapelId: capela2.id, graveId: covas[0].id, deceasedId: decEsposa.id, responsiblePersonId: antonio.id,
      scheduleType: 'sepultamento', startsAt: fut(2, 10), endsAt: fut(2, 11, 30), status: 'agendado', createdByUserId: operadorId,
    }
  );
  await foc(
    Schedule,
    { tenantId: tenant.id, title: 'Velório — Sebastião Pereira Lima' },
    {
      cemeteryId: cemMain.id, chapelId: capela1.id, deceasedId: decAvo.id, responsiblePersonId: antonio.id,
      scheduleType: 'velorio', startsAt: fut(5, 9), endsAt: fut(5, 12), status: 'agendado', createdByUserId: operadorId,
    }
  );

  // ---- Ossário + nichos + depósito ----
  const ossuary = await foc(
    Ossuary,
    { cemeteryId: cemMain.id, code: 'OSS-01' },
    { tenantId: tenant.id, name: 'Ossário Central', description: 'Depósito de restos mortais.' }
  );
  const niches = [];
  for (let i = 1; i <= 6; i += 1) {
    const n = await foc(
      OssuaryNiche,
      { ossuaryId: ossuary.id, code: `N-${String(i).padStart(3, '0')}` },
      { tenantId: tenant.id, rowLabel: String.fromCharCode(64 + Math.ceil(i / 3)), columnLabel: String(((i - 1) % 3) + 1), status: i === 1 ? 'ocupado' : 'livre' }
    );
    niches.push(n);
  }

  // ---- Exumação (realizada) + depósito no ossário ----
  const exhum = await foc(
    Exhumation,
    { tenantId: tenant.id, processNumber: '0007/2026' },
    {
      cemeteryId: cemMain.id, graveId: (covas[3] ? covas[3].id : covas[1].id), burialId: burialExumado.id, deceasedId: decExumado.id,
      requestedByPersonId: carlos.id, requestDate: addDaysYmd(-60), reason: 'Decurso de prazo — translado para ossário',
      authorizationNumber: 'AUT-EX-0007/2026', authorizedByUserId: adminId, authorizedAt: daysAgo(50),
      scheduledDate: addDaysYmd(-40), performedAt: daysAgo(40), performedBy: 'Equipe de Campo A',
      status: 'realizada', destinationType: 'ossario', destinationOssuaryNicheId: niches[0].id, registeredByUserId: operadorId,
    }
  );
  await foc(
    RemainsDeposit,
    { deceasedId: decExumado.id, ossuaryNicheId: niches[0].id },
    { tenantId: tenant.id, exhumationId: exhum.id, originGraveId: (covas[3] ? covas[3].id : covas[1].id), depositedAt: daysAgo(40), status: 'depositado', registeredByUserId: operadorId }
  );

  // ---- Documentos (modelos + emitidos) ----
  const tplCertidao = await foc(
    DocumentTemplate,
    { tenantId: tenant.id, documentType: 'certidao_perpetuidade' },
    { name: 'Certidão de Perpetuidade', bodyHtml: '<h1>Certidão de Perpetuidade</h1><p>{{titular}} — {{jazigo}}</p>' }
  );
  await foc(
    DocumentTemplate,
    { tenantId: tenant.id, documentType: 'autorizacao_sepultamento' },
    { name: 'Autorização de Sepultamento', bodyHtml: '<h1>Autorização de Sepultamento</h1>' }
  );

  await foc(
    Document,
    { tenantId: tenant.id, documentType: 'certidao_perpetuidade', formattedNumber: '0001/2026' },
    {
      templateId: tplCertidao.id, number: 1, year: Y, referenceType: 'concession', referenceId: concJazigo1.id,
      graveId: jazigo1.id, personId: titular.id, status: 'assinado', issuedByUserId: adminId, issuedAt: daysAgo(120),
    }
  );
  await foc(
    Document,
    { tenantId: tenant.id, documentType: 'autorizacao_sepultamento', formattedNumber: '0044/2026' },
    {
      number: 44, year: Y, referenceType: 'burial', graveId: gavetas1[0].id, deceasedId: decEsposa.id,
      status: 'emitido', issuedByUserId: operadorId, issuedAt: daysAgo(11),
    }
  );

  // Alinha o numerador (DocumentSequence) ao MAIOR número já emitido por
  // tipo/ano — senão a próxima emissão pelo app colide com o número do seed (409).
  const _docs = await Document.findAll({
    where: { tenantId: tenant.id },
    attributes: ['documentType', 'year', 'number'],
  });
  const _maxByKey = {};
  for (const d of _docs) {
    if (d.number == null || d.year == null) continue;
    const k = `${d.documentType}|${d.year}`;
    _maxByKey[k] = Math.max(_maxByKey[k] || 0, d.number);
  }
  for (const k of Object.keys(_maxByKey)) {
    const [documentType, yearStr] = k.split('|');
    const year = Number(yearStr);
    const [seq] = await DocumentSequence.findOrCreate({
      where: { tenantId: tenant.id, documentType, year },
      defaults: { lastNumber: _maxByKey[k] },
    });
    if (seq.lastNumber < _maxByKey[k]) await seq.update({ lastNumber: _maxByKey[k] });
  }

  // ---- Notificações ----
  await foc(
    Notification,
    { tenantId: tenant.id, subject: 'Taxa de manutenção vencida' },
    {
      recipientPersonId: antonio.id, channel: 'whatsapp', notificationType: 'cobranca_vencida',
      recipientContact: '+551133336666', message: 'Sua taxa de manutenção está vencida. Regularize para evitar bloqueio.',
      referenceType: 'billing', status: 'enviada', provider: 'mock', sentAt: daysAgo(5),
    }
  );
  await foc(
    Notification,
    { tenantId: tenant.id, subject: 'Velório agendado' },
    {
      recipientPersonId: titular.id, channel: 'email', notificationType: 'agendamento',
      recipientContact: 'joao.silva@example.com', message: 'Velório de Terezinha B. Silva confirmado para hoje às 09h — Capela São Judas.',
      referenceType: 'schedule', status: 'entregue', provider: 'mock', sentAt: daysAgo(1),
    }
  );
  await foc(
    Notification,
    { tenantId: tenant.id, subject: 'Certidão emitida' },
    {
      recipientPersonId: titular.id, channel: 'email', notificationType: 'documento_emitido',
      recipientContact: 'joao.silva@example.com', message: 'Sua Certidão de Perpetuidade 0001/2026 foi emitida.',
      referenceType: 'document', status: 'lida', provider: 'mock', sentAt: daysAgo(120),
    }
  );

  // ---- Manutenção física ----
  await foc(
    GraveMaintenance,
    { graveId: jazigo1.id, maintenanceType: 'reforma' },
    {
      tenantId: tenant.id, description: 'Reforma da lápide e impermeabilização.', requestedByPersonId: titular.id,
      status: 'concluida', startDate: addDaysYmd(-90), endDate: addDaysYmd(-80), cost: 1200.0,
      performedBy: 'Marmoraria Guarulhos', registeredByUserId: operadorId,
    }
  );

  // ---- Eventos de linha do tempo (jazigo1) ----
  const timeline = [
    { eventType: 'concessao', title: 'Concessão perpétua emitida', occurredAt: new Date('2020-03-15T12:00:00Z') },
    { eventType: 'sepultamento', title: 'Sepultamento de Terezinha B. Silva', occurredAt: todayAt(11) },
    { eventType: 'documento_emitido', title: 'Certidão de Perpetuidade 0001/2026', occurredAt: daysAgo(120) },
    { eventType: 'cobranca', title: 'Cobrança COB-2026-0002 gerada', occurredAt: daysAgo(3) },
    { eventType: 'pagamento', title: 'Pagamento da taxa 2025 confirmado', occurredAt: new Date(Date.UTC(Y - 1, 2, 9, 14, 0, 0)) },
  ];
  for (const ev of timeline) {
    await foc(
      GraveEvent,
      { graveId: jazigo1.id, eventType: ev.eventType, title: ev.title },
      { tenantId: tenant.id, occurredAt: ev.occurredAt, registeredByUserId: operadorId }
    );
  }

  return {
    cemeteries: 2,
    graves: covas.length + 1 + 4 + 1 + 2 + 1, // covas + jaz1 + gavetas1 + jaz2 + gavetas2 + tumulo
    people: 5,
    concessions: 3,
    deceased: 4,
    billings: 5,
    schedules: 3,
    ossuaryNiches: niches.length,
  };
}

/* ============================ main ============================ */

async function main() {
  await sequelize.authenticate();
  await loadStatuses();

  // --- demo (mantido para não quebrar admin@demo.dev / smoke test) ---
  const demo = await foc(
    Tenant,
    { subdomain: 'demo' },
    { name: 'Prefeitura Demo', legalName: 'Prefeitura Municipal Demo', email: 'contato@demo.gov.br', primaryColor: '#032e59', secondaryColor: '#0a4a8c', settings: { fqdn: 'demo.eternizagestao.com.br' } }
  );
  await upsertUser({ email: 'admin@demo.dev', name: 'Admin Demo', role: 'admin', tenantId: demo.id });
  await upsertUser({ email: 'operador@demo.dev', name: 'Operador Demo', role: 'operador', tenantId: demo.id });

  // --- super admin da plataforma ---
  await upsertUser({ email: 'super@eterniza.dev', name: 'Super Admin', role: 'super_admin', tenantId: null });
  // super_admin oficial de suporte (remetente da plataforma no Resend)
  await upsertUser({ email: 'suporte@eternizagestao.com.br', name: 'Suporte Eterniza', role: 'super_admin', tenantId: null });

  // --- cidade FANTASMA (ambiente de teste do super_admin) ---
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
  await upsertUser({ email: 'admin@fantasma.eternizagestao.com.br', name: 'Admin Fantasma', role: 'admin', tenantId: fantasma.id });
  // cemitério mínimo (com entrada GPS) para testar mapa/ortofoto/estrutura
  const cemF = await foc(
    Cemetery,
    { tenantId: fantasma.id, code: 'CEM-FANTASMA-01' },
    {
      name: 'Cemitério Central de Cidade Fantasma',
      addressCity: 'Cidade Fantasma', addressState: 'SP',
      entranceLatitude: -12.2664, entranceLongitude: -38.9663, // Itaberaba/BA (teste)
      managerName: 'Prefeitura de Cidade Fantasma',
    }
  );
  const blkF = await foc(Block, { cemeteryId: cemF.id, code: 'A' }, { tenantId: fantasma.id, name: 'Quadra A' });
  const stF = await foc(Street, { blockId: blkF.id, code: 'R1' }, { tenantId: fantasma.id, cemeteryId: cemF.id, name: 'Rua 1' });
  const lotF = await foc(Lot, { streetId: stF.id, code: 'L1' }, { tenantId: fantasma.id, cemeteryId: cemF.id, name: 'Lote 1' });
  for (let i = 1; i <= 2; i += 1) {
    await foc(
      Grave,
      { cemeteryId: cemF.id, code: `COVA-${String(i).padStart(3, '0')}` },
      { tenantId: fantasma.id, lotId: lotF.id, unitType: 'cova', statusId: STATUS.livre.id, capacity: 1 }
    );
  }

  // --- guarulhos (PADRÃO / cheio) ---
  const guarulhos = await upsertTenant('guarulhos', { isDefault: true });
  const gUsers = {
    admin: await upsertUser({ email: 'admin@guarulhos.eternizagestao.com.br', name: 'Administrador Guarulhos', role: 'admin', tenantId: guarulhos.id }),
    operador: await upsertUser({ email: 'operador@guarulhos.eternizagestao.com.br', name: 'Operador Guarulhos', role: 'operador', tenantId: guarulhos.id }),
    consulta: await upsertUser({ email: 'consulta@guarulhos.eternizagestao.com.br', name: 'Consulta Guarulhos', role: 'consulta', tenantId: guarulhos.id }),
  };
  const guarulhosStats = await seedGuarulhos(guarulhos, gUsers);

  // --- demais cidades (leves, para busca pública por cidade) ---
  const lightSlugs = ['sao-paulo', 'osasco', 'campinas', 'santos', 'ribeirao', 'sorocaba'];
  const lightStats = {};
  for (const slug of lightSlugs) {
    const t = await upsertTenant(slug);
    // 1 usuário admin por cidade (facilita login/inspeção)
    await upsertUser({ email: `admin@${BRANDS[slug].fqdn}`, name: `Admin ${BRANDS[slug].city}`, role: 'admin', tenantId: t.id });
    lightStats[slug] = await seedLightCity(t);
  }

  /* ============================ relatório ============================ */
  const line = '─'.repeat(74);
  console.log(`\n${line}`);
  console.log('SEED CONCLUÍDO — Eterniza Gestão');
  console.log(line);

  console.log('\nTENANTS (subdomínio → nome):');
  console.log('  demo (mantido)            → Prefeitura Demo');
  console.log('  guarulhos  [PADRÃO/CHEIO] → Prefeitura de Guarulhos');
  lightSlugs.forEach((s) => console.log(`  ${s.padEnd(24)}  → ${BRANDS[s].name}`));

  console.log('\nGUARULHOS — resumo do domínio:');
  Object.entries(guarulhosStats).forEach(([k, v]) => console.log(`  ${k.padEnd(16)}: ${v}`));

  console.log('\nDEMAIS CIDADES — resumo (cada uma):');
  Object.entries(lightStats).forEach(([slug, s]) => {
    console.log(`  ${slug.padEnd(12)} cemitério:${s.cemetery} sepulturas:${s.graves} pessoas:${s.people} sepultados:${s.deceased}`);
  });

  console.log(`\n${line}`);
  console.log(`CREDENCIAIS (senha para TODAS: ${PASSWORD})`);
  console.log(line);
  console.log('  ADMINISTRATIVAS (login no painel):');
  console.log('   e-mail                                    | role        | tenant');
  console.log('   ------------------------------------------|-------------|-----------');
  console.log('   super@eterniza.dev                        | super_admin | (nenhum)');
  console.log('   admin@guarulhos.eternizagestao.com.br           | admin       | guarulhos');
  console.log('   operador@guarulhos.eternizagestao.com.br        | operador    | guarulhos');
  console.log('   consulta@guarulhos.eternizagestao.com.br        | consulta    | guarulhos');
  console.log('   admin@saopaulo.eternizagestao.com.br            | admin       | sao-paulo');
  console.log('   admin@osasco.eternizagestao.com.br              | admin       | osasco');
  console.log('   admin@campinas.eternizagestao.com.br            | admin       | campinas');
  console.log('   admin@santos.eternizagestao.com.br              | admin       | santos');
  console.log('   admin@ribeirao.eternizagestao.com.br            | admin       | ribeirao');
  console.log('   admin@sorocaba.eternizagestao.com.br            | admin       | sorocaba');
  console.log('   admin@demo.dev                            | admin       | demo');
  console.log('   operador@demo.dev                         | operador    | demo');
  console.log('\n  PORTAL DA FAMÍLIA:');
  console.log('   familia@guarulhos.eternizagestao.com.br         | titular João Batista Silva (guarulhos)');
  console.log(`\n${line}`);
  console.log('Envie o header X-Tenant-Subdomain com o slug curto (ex.: guarulhos) para');
  console.log('resolver o tenant nas rotas públicas / super_admin.');
  console.log(`${line}\n`);

  await sequelize.close();
}

main().catch((err) => {
  console.error('Falha no seed:', err);
  process.exit(1);
});
