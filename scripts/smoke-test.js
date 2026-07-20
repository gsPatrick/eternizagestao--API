'use strict';

/**
 * Smoke test END-TO-END contra a API rodando (npm start em outro terminal).
 * Percorre o fluxo de negócio completo:
 *   login → cemitério → quadra/rua/lote → jazigo → proprietário → concessão →
 *   sepultado → sepultamento → taxa → cobrança → webhook de pagamento (baixa
 *   automática) → recibo → timeline → capela → agendamento → certidão de
 *   perpetuidade → busca pública → dashboard
 *
 * Pré-requisitos: npm run migrate && npm run seed:dev && npm start
 * Uso: npm run smoke:test
 */
require('dotenv').config();

const BASE = process.env.SMOKE_BASE_URL || `http://localhost:${process.env.APP_PORT || 3000}/api`;
const TENANT_HEADER = { 'X-Tenant-Subdomain': 'demo' };
const WEBHOOK_SECRET = process.env.PAYMENT_GATEWAY_WEBHOOK_SECRET || 'mock-webhook-secret';

let token = null;
let step = 0;

function log(title, extra = '') {
  step += 1;
  console.log(`  ${String(step).padStart(2, '0')}. ${title}${extra ? ` — ${extra}` : ''}`);
}

async function api(method, path, body, extraHeaders = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...TENANT_HEADER,
      ...extraHeaders,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`${method} ${path} → HTTP ${res.status}: ${JSON.stringify(json)}`);
  }
  return json;
}

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT FALHOU: ${msg}`);
}

async function main() {
  const stamp = Date.now().toString().slice(-6);
  console.log(`\nSmoke test E2E — ${BASE}\n`);

  // ---- Fase 0: autenticação
  const login = await api('POST', '/v1/sessions', { email: 'admin@demo.dev', password: 'senha12345' });
  token = login.data.accessToken;
  log('Login admin', login.data.user.email);

  // ---- Fase 1: estrutura física
  const cem = (await api('POST', '/v1/cemeteries', {
    name: `Cemitério Smoke ${stamp}`, entranceLatitude: -23.55, entranceLongitude: -46.63,
  })).data;
  log('Cemitério criado', cem.name);

  const block = (await api('POST', `/v1/cemeteries/${cem.id}/blocks`, { name: 'Quadra A', code: `A${stamp}` })).data;
  const street = (await api('POST', `/v1/blocks/${block.id}/streets`, { name: 'Rua 1', code: `R1${stamp}` })).data;
  const lot = (await api('POST', `/v1/streets/${street.id}/lots`, { name: 'Lote 1', code: `L1${stamp}` })).data;
  log('Hierarquia criada', 'quadra → rua → lote');

  const grave = (await api('POST', '/v1/graves', {
    lotId: lot.id, code: `JAZ-${stamp}`, unitType: 'jazigo', capacity: 2,
    latitude: -23.5501, longitude: -46.6301,
  })).data;
  log('Jazigo criado', grave.code);

  await api('PATCH', `/v1/graves/${grave.id}/geometry`, {
    geoPolygon: [[-23.5501, -46.6301], [-23.5502, -46.6301], [-23.5502, -46.6302], [-23.5501, -46.6302]],
    latitude: -23.5501, longitude: -46.6301,
  });
  log('Geometria demarcada no mapa');

  // ---- Pessoas e concessão
  const owner = (await api('POST', '/v1/people', {
    fullName: `João Proprietário ${stamp}`, cpf: `${stamp}11122-33`, whatsapp: '+5511999990000',
    email: `joao${stamp}@mail.dev`,
  })).data;
  log('Proprietário criado', owner.fullName);

  const concession = (await api('POST', `/v1/graves/${grave.id}/concessions`, {
    personId: owner.id, concessionType: 'perpetua', startDate: '2026-01-10',
  })).data;
  log('Concessão perpétua emitida');

  // ---- Sepultado + sepultamento
  const deceased = (await api('POST', '/v1/deceased', {
    fullName: `Maria Falecida ${stamp}`, deathDate: '2026-07-01', birthDate: '1940-02-10',
  })).data;
  const burial = (await api('POST', '/v1/burials', {
    graveId: grave.id, deceasedId: deceased.id, burialDate: '2026-07-02',
    declarantPersonId: owner.id, funeralHome: 'Funerária Smoke',
  })).data;
  log('Sepultamento registrado', deceased.fullName);

  // ---- Financeiro: taxa → cobrança → baixa automática via webhook
  const feeType = (await api('POST', '/v1/fee-types', {
    name: `Taxa Manutenção ${stamp}`, defaultAmount: 150.0, periodicity: 'anual',
  })).data;
  const fee = (await api('POST', '/v1/maintenance-fees', {
    graveId: grave.id, feeTypeId: feeType.id, payerPersonId: owner.id,
    amount: 150.0, periodicity: 'anual', nextDueDate: '2026-08-01',
  })).data;
  log('Taxa de manutenção vinculada ao jazigo');

  const gen = (await api('POST', '/v1/billings/generate', { until: '2026-09-01' })).data;
  assert(gen.generated >= 1, 'geração de cobranças deveria criar >= 1');
  const billingId = gen.billings[0];
  const billing = (await api('GET', `/v1/billings/${billingId}`)).data;
  assert(billing.gatewayChargeId, 'cobrança deveria ter chargeId do gateway');
  assert(billing.pixCopyPaste, 'cobrança deveria ter PIX copia-e-cola');
  log('Cobrança gerada via gateway', `R$ ${billing.totalAmount} venc. ${billing.dueDate}`);

  // webhook do gateway (baixa automática) — endpoint público com assinatura
  const wh = await fetch(`${BASE}/v1/webhooks/payment-gateway`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-webhook-signature': WEBHOOK_SECRET },
    body: JSON.stringify({
      event: 'charge.paid', chargeId: billing.gatewayChargeId,
      paidAt: new Date().toISOString(), amountPaid: billing.totalAmount, method: 'pix',
    }),
  });
  assert(wh.ok, `webhook deveria responder 200 (veio ${wh.status})`);
  const paidBilling = (await api('GET', `/v1/billings/${billingId}`)).data;
  assert(paidBilling.status === 'pago', `billing deveria estar 'pago' (está '${paidBilling.status}')`);
  assert(paidBilling.payments?.length >= 1, 'deveria existir payment da baixa automática');
  log('Baixa automática confirmada via webhook', `status=${paidBilling.status}`);

  // ---- Timeline do jazigo deve conter os eventos do fluxo
  const timeline = (await api('GET', `/v1/graves/${grave.id}/timeline?perPage=50`)).data;
  const types = timeline.map((e) => e.eventType);
  for (const expected of ['sepultamento', 'concessao', 'cobranca', 'pagamento']) {
    assert(types.includes(expected), `timeline deveria conter evento '${expected}' (tem: ${types.join(',')})`);
  }
  log('Timeline do jazigo íntegra', types.join(', '));

  // ---- Agenda: capela + velório sem conflito + conflito detectado
  const chapel = (await api('POST', `/v1/cemeteries/${cem.id}/chapels`, { name: `Capela ${stamp}` })).data;
  await api('POST', '/v1/schedules', {
    scheduleType: 'velorio', cemeteryId: cem.id, chapelId: chapel.id,
    startsAt: '2026-07-20T09:00:00Z', endsAt: '2026-07-20T12:00:00Z',
    deceasedId: deceased.id, responsiblePersonId: owner.id, title: 'Velório Smoke',
  });
  let conflictCaught = false;
  try {
    await api('POST', '/v1/schedules', {
      scheduleType: 'velorio', cemeteryId: cem.id, chapelId: chapel.id,
      startsAt: '2026-07-20T10:00:00Z', endsAt: '2026-07-20T13:00:00Z',
    });
  } catch (e) {
    conflictCaught = /409|CONFLICT/i.test(e.message);
  }
  assert(conflictCaught, 'agendamento sobreposto na mesma capela deveria dar 409');
  log('Agenda com detecção de conflito funcionando');

  // ---- Documento oficial: certidão de perpetuidade com numeração sequencial
  const doc = (await api('POST', '/v1/documents', {
    documentType: 'certidao_perpetuidade', graveId: grave.id,
    referenceType: 'concession', referenceId: concession.id,
  })).data;
  assert(doc.formattedNumber, 'documento deveria ter número sequencial');
  log('Certidão de perpetuidade emitida', doc.formattedNumber);

  // ---- Busca pública (sem auth)
  const pub = await fetch(`${BASE}/v1/public/search?name=Maria%20Falecida%20${stamp}`, { headers: TENANT_HEADER });
  const pubJson = await pub.json();
  assert(pub.ok && pubJson.data?.length >= 1, 'busca pública deveria localizar a sepultada');
  assert(!JSON.stringify(pubJson).includes('causeOfDeath'), 'busca pública não pode vazar dados sensíveis');
  log('Busca pública OK', `${pubJson.data.length} resultado(s)`);

  // ---- Dashboard
  const dash = (await api('GET', '/v1/dashboard')).data;
  assert(dash.occupancy, 'dashboard deveria trazer ocupação');
  log('Dashboard consolidado OK');

  console.log('\n✅ SMOKE TEST E2E: TODOS OS PASSOS PASSARAM\n');
}

main().catch((err) => {
  console.error(`\n❌ SMOKE TEST FALHOU no passo ${step + 1}:`, err.message, '\n');
  process.exit(1);
});
