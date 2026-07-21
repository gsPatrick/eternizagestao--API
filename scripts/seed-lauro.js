'use strict';

/**
 * SEED DE DEMONSTRAÇÃO — Cidade "Lauro de Freitas" (Bahia).
 *
 * Uso: node scripts/seed-lauro.js   (ou `npm run seed:lauro`)
 *
 * Cria um tenant COMPLETO e pronto para demo: admin de teste
 * (teste@gmail.com / teste123), cemitérios com estrutura, ~36 sepulturas com
 * ocupação realista, pessoas, concessões, sepultados/sepultamentos, financeiro
 * (12 meses de cobranças pagas + inadimplência) e agenda de HOJE — de modo que
 * TODOS os cards do /api/v1/dashboard fiquem preenchidos.
 *
 * Idempotente: usa SEMPRE findOrCreate com chave natural (código/CPF/e-mail).
 * Rodar N vezes NÃO duplica nem dropa nada. Seguro para rodar em produção
 * (EasyPanel) — nunca usa DROP/TRUNCATE. Todo write passa `skipAudit: true`.
 *
 * Espelha o SHAPE de cada model do scripts/seed-dev.js (fonte da verdade: schema).
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
  Concession,
  Deceased,
  Burial,
  FeeType,
  MaintenanceFee,
  Billing,
  Payment,
  Chapel,
  Schedule,
} = require('../src/models');
const { hashPassword } = require('../src/utils/password');

const ADMIN_PASSWORD = 'teste123';

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
// {y,m} de N meses atrás (m 0-based)
function monthsAgo(n) {
  const d = new Date(Date.UTC(Y, M - n, 1));
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() };
}
function periodRef(y, m) {
  return `${y}-${String(m + 1).padStart(2, '0')}`;
}

const BRAND = {
  name: 'Prefeitura de Lauro de Freitas',
  primary: '#0f6b6b', // teal/azul da Bahia
  secondary: '#189494',
  deep: '#0a4a4a',
  city: 'Lauro de Freitas',
  state: 'BA',
  fqdn: 'lauro-de-freitas.eternizagestao.com.br',
};

// bairros reais de Lauro de Freitas (endereços das pessoas)
const BAIRROS = [
  'Vilas do Atlântico', 'Ipitanga', 'Itinga', 'Portão', 'Centro',
  'Aracuí', 'Caji', 'Buraquinho', 'Jardim Aeroporto', 'Miragem',
];

let STATUS = {}; // slug -> instância (statuses de sistema, tenant_id NULL)
async function loadStatuses() {
  const rows = await GraveStatus.findAll({ where: { tenantId: null } });
  STATUS = Object.fromEntries(rows.map((s) => [s.slug, s]));
}

/* ============================ main ============================ */

async function main() {
  await sequelize.authenticate();
  await loadStatuses();

  // ---- Tenant ----
  const tenant = await foc(
    Tenant,
    { subdomain: 'lauro-de-freitas' },
    {
      name: BRAND.name,
      legalName: `${BRAND.name} — Secretaria de Serviços Públicos`,
      cnpj: '13.927.819/0001-40',
      email: `cemiterios@${BRAND.fqdn}`,
      phone: '+557133785000',
      whatsapp: '+5571988776655',
      primaryColor: BRAND.primary,
      secondaryColor: BRAND.secondary,
      addressCity: BRAND.city,
      addressState: BRAND.state,
      onboardingStatus: 'concluido',
      settings: { accentDeep: BRAND.deep, fqdn: BRAND.fqdn },
      active: true,
    }
  );

  // ---- Usuários ----
  const adminHash = await hashPassword(ADMIN_PASSWORD);
  const admin = await foc(
    User,
    { email: 'teste@gmail.com', tenantId: tenant.id },
    { name: 'Administrador Lauro', role: 'admin', passwordHash: adminHash, active: true }
  );
  const operador = await foc(
    User,
    { email: `operador@${BRAND.fqdn}`, tenantId: tenant.id },
    { name: 'Operador Lauro', role: 'operador', passwordHash: adminHash, active: true }
  );
  const operadorId = operador.id;

  // ---- Cemitérios ----
  const cemMain = await foc(
    Cemetery,
    { tenantId: tenant.id, code: 'CEM-LDF-01' },
    {
      name: 'Cemitério Municipal de Lauro de Freitas',
      description: 'Cemitério central do município.',
      addressStreet: 'Estrada do Coco', addressNumber: 'S/N', addressDistrict: 'Centro',
      addressCity: BRAND.city, addressState: BRAND.state, addressZipcode: '42700-000',
      entranceLatitude: -12.894, entranceLongitude: -38.327,
      managerName: BRAND.name, managerDocument: '13.927.819/0001-40',
      managerPhone: '+557133785010', managerEmail: `cemiterios@${BRAND.fqdn}`,
      brandPrimaryColor: BRAND.primary, brandSecondaryColor: BRAND.secondary,
    }
  );
  const cemPark = await foc(
    Cemetery,
    { tenantId: tenant.id, code: 'CEM-LDF-02' },
    {
      name: 'Cemitério Parque Ipitanga',
      addressCity: BRAND.city, addressState: BRAND.state, addressDistrict: 'Ipitanga',
      entranceLatitude: -12.86, entranceLongitude: -38.35,
      managerName: BRAND.name, brandPrimaryColor: BRAND.primary, brandSecondaryColor: BRAND.secondary,
    }
  );

  // ---- Estrutura física (quadras/ruas/lotes) → lista plana de lotes ----
  const lots = [];
  async function buildStructure(cemetery, blockDefs) {
    for (const bd of blockDefs) {
      const block = await foc(
        Block, { cemeteryId: cemetery.id, code: bd.code },
        { tenantId: tenant.id, name: bd.name }
      );
      const street = await foc(
        Street, { blockId: block.id, code: `${bd.code}-R1` },
        { tenantId: tenant.id, cemeteryId: cemetery.id, name: bd.street }
      );
      for (let l = 1; l <= bd.lots; l += 1) {
        const lot = await foc(
          Lot, { streetId: street.id, code: `${bd.code}-R1-L${l}` },
          { tenantId: tenant.id, cemeteryId: cemetery.id, name: `Lote ${l}` }
        );
        lots.push({ lot, cemeteryId: cemetery.id });
      }
    }
  }
  await buildStructure(cemMain, [
    { code: 'A', name: 'Quadra A', street: 'Rua das Palmeiras', lots: 3 },
    { code: 'B', name: 'Quadra B', street: 'Rua dos Coqueiros', lots: 3 },
  ]);
  await buildStructure(cemPark, [
    { code: 'C', name: 'Quadra C', street: 'Alameda Ipitanga', lots: 2 },
  ]);

  // ---- Sepulturas (~36) com ocupação realista (~66%) ----
  // ocupada 20 + em_perpetuidade 4 = 24 "ocupadas"; livre 6; reservada 4; manutenção 2
  const statusPlan = [
    ...Array(20).fill('ocupada'),
    ...Array(4).fill('em_perpetuidade'),
    ...Array(4).fill('reservada'),
    ...Array(6).fill('livre'),
    ...Array(2).fill('em_manutencao'),
  ];
  const graves = [];
  for (let i = 0; i < statusPlan.length; i += 1) {
    const slug = statusPlan[i];
    const target = lots[i % lots.length];
    const unitType =
      slug === 'em_perpetuidade' ? 'jazigo'
        : slug === 'reservada' ? 'jazigo'
          : i % 5 === 0 ? 'tumulo' : 'cova';
    const g = await foc(
      Grave,
      { cemeteryId: target.cemeteryId, code: `LDF-${String(i + 1).padStart(3, '0')}` },
      {
        tenantId: tenant.id, lotId: target.lot.id, unitType,
        statusId: STATUS[slug].id,
        capacity: unitType === 'jazigo' ? 4 : unitType === 'tumulo' ? 2 : 1,
        latitude: -12.894 + i * 0.0002, longitude: -38.327 + i * 0.0002,
      }
    );
    graves.push({ grave: g, slug, cemeteryId: target.cemeteryId });
  }
  const occupiedGraves = graves.filter((g) => g.slug === 'ocupada' || g.slug === 'em_perpetuidade');
  const perpetuaGraves = graves.filter((g) => g.slug === 'em_perpetuidade');

  // ---- Pessoas (~18) — proprietários/responsáveis/declarantes ----
  const nomes = [
    'Josefa Conceição dos Santos', 'Antônio Carlos de Jesus', 'Maria das Graças Oliveira',
    'João Pedro da Silva Neto', 'Rita de Cássia Barbosa', 'Edvaldo Souza Bispo',
    'Nilza Ferreira dos Anjos', 'Manoel Ribeiro da Cruz', 'Cleonice Alves Sacramento',
    'Genivaldo Pinto Argolo', 'Ana Lúcia Nascimento', 'Roberto Carlos Menezes',
    'Vanusa Santana de Brito', 'Jailson Correia Lima', 'Marinalva Rocha dos Reis',
    'Adriana Passos Vieira', 'Severino Gomes da Paixão', 'Luzia Teixeira de Almeida',
  ];
  const people = [];
  for (let i = 0; i < nomes.length; i += 1) {
    const p = await foc(
      Person,
      { tenantId: tenant.id, cpf: `801.${String(100 + i).padStart(3, '0')}.${String(200 + i).padStart(3, '0')}-0${i % 10}` },
      {
        fullName: nomes[i],
        birthDate: ymd(1940 + (i * 3) % 55, i % 12, 1 + (i % 27)),
        gender: i % 2 === 0 ? 'feminino' : 'masculino',
        email: `pessoa${i + 1}@example.com`,
        phonePrimary: `+55719${String(80000000 + i * 137).slice(0, 8)}`,
        addressStreet: `Rua ${BAIRROS[i % BAIRROS.length]}`, addressNumber: `${10 + i}`,
        addressDistrict: BAIRROS[i % BAIRROS.length],
        addressCity: BRAND.city, addressState: BRAND.state, addressZipcode: '42700-000',
      }
    );
    people.push(p);
  }

  // ---- Concessões (~8) ligando titulares a jazigos/sepulturas ----
  const concessions = [];
  // perpétuas nos jazigos em_perpetuidade
  for (let i = 0; i < perpetuaGraves.length; i += 1) {
    const c = await foc(
      Concession,
      { tenantId: tenant.id, contractNumber: `CON-LDF-2019-${String(i + 1).padStart(4, '0')}` },
      {
        graveId: perpetuaGraves[i].grave.id, personId: people[i].id, concessionType: 'perpetua',
        startDate: ymd(2019 + i, 2, 15), status: 'ativa', acquisitionMethod: 'emissao', value: 8200 + i * 300,
      }
    );
    concessions.push(c);
  }
  // temporárias (a vencer) e uma vencida, em sepulturas ocupadas
  const tempSpec = [
    { off: 0, end: addDaysYmd(40), status: 'ativa' },
    { off: 1, end: addDaysYmd(80), status: 'ativa' },
    { off: 2, end: addDaysYmd(15), status: 'ativa' },
    { off: 3, end: addDaysYmd(-25), status: 'vencida' },
  ];
  for (let i = 0; i < tempSpec.length; i += 1) {
    const t = tempSpec[i];
    const c = await foc(
      Concession,
      { tenantId: tenant.id, contractNumber: `CON-LDF-2023-${String(i + 1).padStart(4, '0')}` },
      {
        graveId: occupiedGraves[t.off].grave.id, personId: people[perpetuaGraves.length + i].id,
        concessionType: 'temporaria', startDate: ymd(2023, i % 12, 10), endDate: t.end,
        status: t.status, acquisitionMethod: i % 2 ? 'regularizacao' : 'emissao', value: 2100 + i * 250,
      }
    );
    concessions.push(c);
  }

  // ---- Sepultados + sepultamentos (~10; alguns NESTE mês) ----
  const deceasedSpec = [
    { name: 'Terezinha Batista dos Santos', death: ymd(Y, M, Math.min(4, D)), birth: '1948-06-12' },
    { name: 'Djalma Souza Argolo', death: ymd(Y, M, Math.min(11, D)), birth: '1939-01-30' },
    { name: 'Iracema Nunes de Jesus', death: ymd(Y, M, Math.min(17, D)), birth: '1955-09-08' },
    { name: 'Valdomiro Pereira Lima', death: addDaysYmd(-38), birth: '1942-03-21' },
    { name: 'Dulce Maria Sacramento', death: addDaysYmd(-62), birth: '1950-11-02' },
    { name: 'Aloísio Ferreira Bispo', death: addDaysYmd(-95), birth: '1936-07-19' },
    { name: 'Neusa Rocha dos Reis', death: '2025-12-14', birth: '1944-05-05' },
    { name: 'Gilberto Passos Vieira', death: '2025-08-27', birth: '1938-10-11' },
    { name: 'Zilda Correia Lima', death: '2024-06-03', birth: '1941-02-28' },
    { name: 'Otávio Gomes da Paixão', death: '2023-04-15', birth: '1935-12-01' },
  ];
  let burialsCount = 0;
  for (let i = 0; i < deceasedSpec.length; i += 1) {
    const dc = deceasedSpec[i];
    const grave = occupiedGraves[i % occupiedGraves.length].grave;
    const deceased = await foc(
      Deceased,
      { tenantId: tenant.id, fullName: dc.name, deathDate: dc.death },
      {
        birthDate: dc.birth, gender: i % 2 ? 'masculino' : 'feminino',
        causeOfDeath: 'Causas naturais', deathCertificateNumber: `OB-${Y}-${String(500 + i).padStart(4, '0')}`,
        currentGraveId: grave.id, currentLocationType: 'sepultado',
      }
    );
    await foc(
      Burial,
      { graveId: grave.id, deceasedId: deceased.id },
      {
        tenantId: tenant.id, cemeteryId: grave.cemeteryId, burialDate: dc.death,
        declarantPersonId: people[i % people.length].id, funeralHome: 'Funerária Boa Esperança',
        authorizationNumber: `${String(40 + i).padStart(4, '0')}/${Y}`, status: 'ativo',
        registeredByUserId: operadorId,
      }
    );
    burialsCount += 1;
  }

  // ---- Financeiro: tipos de taxa ----
  const feeAnual = await foc(
    FeeType,
    { tenantId: tenant.id, name: 'Taxa de Manutenção Anual' },
    { description: 'Conservação e limpeza da sepultura.', defaultAmount: 180.0, periodicity: 'anual' }
  );
  const feeSepult = await foc(
    FeeType,
    { tenantId: tenant.id, name: 'Taxa de Sepultamento' },
    { description: 'Serviço de sepultamento.', defaultAmount: 350.0, periodicity: 'unica' }
  );

  // ---- MaintenanceFees (uma por concessão) ----
  const maintFees = [];
  for (let i = 0; i < concessions.length; i += 1) {
    const c = concessions[i];
    const mf = await foc(
      MaintenanceFee,
      { graveId: c.graveId, feeTypeId: feeAnual.id, payerPersonId: c.personId },
      {
        tenantId: tenant.id, concessionId: c.id, amount: 180.0, periodicity: 'anual',
        dueDay: 10, dueMonth: (i % 12) + 1, nextDueDate: ymd(Y + 1, i % 12, 10), status: 'ativa',
      }
    );
    maintFees.push(mf);
  }

  // ---- Cobranças PAGAS ao longo dos últimos 12 meses (arrecadação subindo) ----
  // revenueSeries/receivedThisMonth leem Payment.paidAt → cada cobrança paga
  // recebe um Payment com paidAt no mês correspondente.
  let paidBillings = 0;
  let paymentsCount = 0;
  // índice 11 = 11 meses atrás ... 0 = mês atual (tendência crescente)
  for (let ago = 11; ago >= 0; ago -= 1) {
    const { y, m } = monthsAgo(ago);
    const ref = periodRef(y, m);
    const count = 2 + Math.floor((11 - ago) / 3); // 2..5 cobranças/mês (cresce)
    for (let n = 0; n < count; n += 1) {
      const idx = (ago * 3 + n) % occupiedGraves.length;
      const grave = occupiedGraves[idx].grave;
      const payer = people[idx % people.length];
      const amount = 160 + (11 - ago) * 12 + n * 25; // valor cresce ao longo do tempo
      const payDay = ago === 0 ? Math.min(10, D) : 12;
      const code = `COB-LDF-${ref}-${String(n + 1).padStart(2, '0')}`;
      const bill = await foc(
        Billing,
        { tenantId: tenant.id, code },
        {
          cemeteryId: grave.cemeteryId, graveId: grave.id, payerPersonId: payer.id,
          maintenanceFeeId: maintFees[idx % maintFees.length].id,
          origin: 'taxa_manutencao', description: `Taxa de manutenção — ${ref}`,
          referencePeriod: ref, amount, totalAmount: amount, dueDate: ymd(y, m, 10),
          status: 'pago', gatewayProvider: 'mock', gatewayChargeId: `chg_${ref}_${n}`,
        }
      );
      await foc(
        Payment,
        { billingId: bill.id },
        {
          tenantId: tenant.id, paidAt: new Date(Date.UTC(y, m, payDay, 12, 0, 0)),
          amountPaid: amount, method: 'pix', receiptNumber: `REC-${ref}-${n + 1}`,
          reconciled: true, reconciledAt: new Date(Date.UTC(y, m, payDay, 12, 5, 0)),
          registeredByUserId: operadorId,
        }
      );
      paidBillings += 1;
      paymentsCount += 1;
    }
  }

  // ---- Cobranças EM ATRASO (inadimplência + top devedores) — 5 pagadores distintos ----
  let overdueBillings = 0;
  for (let i = 0; i < 5; i += 1) {
    const grave = occupiedGraves[(i + 2) % occupiedGraves.length].grave;
    const payer = people[(i * 3 + 1) % people.length];
    const amount = 180 + i * 60;
    const fine = Math.round(amount * 0.02 * 100) / 100;
    const interest = Math.round(amount * 0.03 * 100) / 100;
    await foc(
      Billing,
      { tenantId: tenant.id, code: `COB-LDF-ATR-${String(i + 1).padStart(2, '0')}` },
      {
        cemeteryId: grave.cemeteryId, graveId: grave.id, payerPersonId: payer.id,
        origin: 'taxa_manutencao', description: 'Taxa de manutenção anual em atraso',
        referencePeriod: periodRef(Y, (M + 11) % 12), amount, fineAmount: fine, interestAmount: interest,
        totalAmount: amount + fine + interest, dueDate: addDaysYmd(-15 - i * 12), status: 'em_atraso',
        gatewayProvider: 'mock', gatewayChargeId: `chg_atr_${i}`,
      }
    );
    overdueBillings += 1;
  }

  // ---- Cobranças PENDENTES (a vencer) ----
  let pendingBillings = 0;
  for (let i = 0; i < 3; i += 1) {
    const grave = occupiedGraves[(i + 6) % occupiedGraves.length].grave;
    const payer = people[(i * 4 + 2) % people.length];
    await foc(
      Billing,
      { tenantId: tenant.id, code: `COB-LDF-PEN-${String(i + 1).padStart(2, '0')}` },
      {
        cemeteryId: grave.cemeteryId, graveId: grave.id, payerPersonId: payer.id,
        origin: i === 0 ? 'servico' : 'taxa_manutencao',
        description: i === 0 ? 'Taxa de sepultamento' : 'Taxa de manutenção anual',
        referencePeriod: periodRef(Y, M), amount: 180 + i * 40, totalAmount: 180 + i * 40,
        dueDate: addDaysYmd(12 + i * 10), status: 'pendente',
        gatewayProvider: 'mock', gatewayChargeId: `chg_pen_${i}`,
      }
    );
    pendingBillings += 1;
  }

  // ---- Capelas + Agenda de HOJE ----
  const capela1 = await foc(Chapel, { cemeteryId: cemMain.id, name: 'Capela Senhor do Bonfim' }, { tenantId: tenant.id, code: 'CAP-01', capacity: 80 });
  const capela2 = await foc(Chapel, { cemeteryId: cemMain.id, name: 'Capela Santo Amaro' }, { tenantId: tenant.id, code: 'CAP-02', capacity: 50 });

  // sepultado deste mês (para linkar aos agendamentos de hoje)
  const decHojeVelorio = await Deceased.findOne({ where: { tenantId: tenant.id, fullName: 'Terezinha Batista dos Santos' } });
  const decHojeSepult = await Deceased.findOne({ where: { tenantId: tenant.id, fullName: 'Djalma Souza Argolo' } });

  await foc(
    Schedule,
    { tenantId: tenant.id, title: 'Velório — Terezinha Batista dos Santos' },
    {
      cemeteryId: cemMain.id, chapelId: capela1.id, deceasedId: decHojeVelorio ? decHojeVelorio.id : null,
      responsiblePersonId: people[0].id, scheduleType: 'velorio',
      startsAt: todayAt(9), endsAt: todayAt(12), status: 'confirmado', createdByUserId: operadorId,
    }
  );
  await foc(
    Schedule,
    { tenantId: tenant.id, title: 'Sepultamento — Djalma Souza Argolo' },
    {
      cemeteryId: cemMain.id, chapelId: capela2.id, graveId: occupiedGraves[1].grave.id,
      deceasedId: decHojeSepult ? decHojeSepult.id : null, responsiblePersonId: people[1].id,
      scheduleType: 'sepultamento', startsAt: todayAt(14), endsAt: todayAt(15, 30),
      status: 'agendado', createdByUserId: operadorId,
    }
  );
  await foc(
    Schedule,
    { tenantId: tenant.id, title: 'Exumação — vistoria de decurso de prazo' },
    {
      cemeteryId: cemMain.id, graveId: occupiedGraves[3].grave.id, scheduleType: 'exumacao',
      startsAt: todayAt(16), endsAt: todayAt(17), status: 'agendado', createdByUserId: operadorId,
    }
  );

  /* ============================ relatório ============================ */
  const line = '─'.repeat(70);
  console.log(`\n${line}`);
  console.log('SEED LAURO DE FREITAS — CONCLUÍDO');
  console.log(line);
  console.log(`  Tenant        : ${tenant.name} (subdomain: ${tenant.subdomain}, id: ${tenant.id})`);
  console.log(`  Admin         : teste@gmail.com / ${ADMIN_PASSWORD}  (role: admin)`);
  console.log(`  Operador      : operador@${BRAND.fqdn} / ${ADMIN_PASSWORD}`);
  console.log(`  Cemitérios    : 2`);
  console.log(`  Sepulturas    : ${graves.length}  (ocupadas: ${occupiedGraves.length} — ${Math.round((occupiedGraves.length / graves.length) * 100)}%)`);
  console.log(`  Pessoas       : ${people.length}`);
  console.log(`  Concessões    : ${concessions.length}`);
  console.log(`  Sepultamentos : ${burialsCount}`);
  console.log(`  Cobranças     : pagas ${paidBillings} (+${paymentsCount} pagamentos) | em atraso ${overdueBillings} | pendentes ${pendingBillings}`);
  console.log(`  Agenda hoje   : 3 (velório, sepultamento, exumação)`);
  console.log(line);
  console.log('  Login: POST /api/v1/sessions  {"email":"teste@gmail.com","password":"teste123"}');
  console.log(`${line}\n`);

  await sequelize.close();
  process.exit(0);
}

main().catch((err) => {
  console.error('Falha no seed Lauro de Freitas:', err);
  process.exit(1);
});
