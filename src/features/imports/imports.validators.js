'use strict';

/**
 * Validadores linha a linha por escopo de importação.
 * Cada validador: validateRow(row, ctx) => { valid: boolean, errors: string[] }
 * `ctx` carrega dados pré-carregados do tenant (ex.: ctx.lotIds Set) para
 * validar referências sem uma query por linha.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function normalizeCpf(value) {
  return String(value || '').replace(/\D/g, '');
}

function isValidDateOnly(value) {
  if (!DATE_RE.test(String(value))) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isBlank(value) {
  return value === undefined || value === null || String(value).trim() === '';
}

function isValidNumber(value) {
  const parsed = parseFloat(String(value).replace(',', '.'));
  return Number.isFinite(parsed);
}

// Aliases de nomenclatura na ENTRADA: o front usa `pessoas` onde a API chama
// `proprietarios`. Normaliza o escopo antes de validar/persistir sem quebrar o
// valor canônico já em uso.
const SCOPE_ALIASES = { pessoas: 'proprietarios' };
function normalizeScope(scope) {
  return SCOPE_ALIASES[scope] || scope;
}

const CONCESSION_TYPES = ['perpetua', 'temporaria'];
// status histórico aceito na planilha → status canônico da Billing
const BILLING_STATUS_MAP = { pago: 'pago', em_aberto: 'pendente', em_atraso: 'em_atraso' };

const validators = {
  proprietarios(row) {
    const errors = [];
    if (isBlank(row.fullName)) errors.push('fullName é obrigatório');
    if (!isBlank(row.cpf) && normalizeCpf(row.cpf).length !== 11) {
      errors.push('cpf inválido — esperado 11 dígitos');
    }
    return { valid: errors.length === 0, errors };
  },

  sepultados(row) {
    const errors = [];
    if (isBlank(row.fullName)) errors.push('fullName é obrigatório');
    if (!isBlank(row.birthDate) && !isValidDateOnly(row.birthDate)) {
      errors.push('birthDate inválida — esperado YYYY-MM-DD');
    }
    if (!isBlank(row.deathDate) && !isValidDateOnly(row.deathDate)) {
      errors.push('deathDate inválida — esperado YYYY-MM-DD');
    }
    return { valid: errors.length === 0, errors };
  },

  sepulturas(row, ctx = {}) {
    const errors = [];
    if (isBlank(row.code)) errors.push('code é obrigatório');
    if (isBlank(row.lotId)) errors.push('lotId é obrigatório');
    else if (ctx.lotIds && !ctx.lotIds.has(String(row.lotId))) {
      errors.push('lotId não corresponde a um lote do tenant');
    }
    return { valid: errors.length === 0, errors };
  },

  // Concessão de legado: vínculo concessionário (Person por CPF) ↔ sepultura
  // (Grave por código). FKs resolvidas via sets pré-carregados no ctx.
  concessoes(row, ctx = {}) {
    const errors = [];
    const cpf = normalizeCpf(row.cpf);
    if (isBlank(row.cpf)) errors.push('cpf é obrigatório');
    else if (cpf.length !== 11) errors.push('cpf inválido — esperado 11 dígitos');
    else if (ctx.personCpfs && !ctx.personCpfs.has(cpf)) {
      errors.push(`concessionário com CPF '${row.cpf}' não encontrado no cadastro`);
    }

    if (isBlank(row.graveCode)) errors.push('graveCode é obrigatório');
    else if (ctx.graveCodes && !ctx.graveCodes.has(String(row.graveCode))) {
      errors.push(`sepultura de código '${row.graveCode}' não encontrada no cadastro`);
    }

    if (isBlank(row.concessionType)) errors.push('concessionType é obrigatório');
    else if (!CONCESSION_TYPES.includes(row.concessionType)) {
      errors.push("concessionType inválido — use 'perpetua' ou 'temporaria'");
    }

    if (isBlank(row.startDate)) errors.push('startDate é obrigatório');
    else if (!isValidDateOnly(row.startDate)) errors.push('startDate inválida — esperado YYYY-MM-DD');

    if (!isBlank(row.endDate) && !isValidDateOnly(row.endDate)) {
      errors.push('endDate inválida — esperado YYYY-MM-DD');
    }
    if (!isBlank(row.value) && !isValidNumber(row.value)) errors.push('value inválido');

    return { valid: errors.length === 0, errors };
  },

  // Cobrança histórica: débito/pagamento do sistema antigo. Sem numeração
  // sequencial (dado legado). Pagador (Person por CPF) obrigatório; sepultura
  // (Grave por código) opcional.
  cobrancas(row, ctx = {}) {
    const errors = [];
    const cpf = normalizeCpf(row.cpf);
    if (isBlank(row.cpf)) errors.push('cpf é obrigatório');
    else if (cpf.length !== 11) errors.push('cpf inválido — esperado 11 dígitos');
    else if (ctx.personCpfs && !ctx.personCpfs.has(cpf)) {
      errors.push(`pagador com CPF '${row.cpf}' não encontrado no cadastro`);
    }

    if (!isBlank(row.graveCode) && ctx.graveCodes && !ctx.graveCodes.has(String(row.graveCode))) {
      errors.push(`sepultura de código '${row.graveCode}' não encontrada no cadastro`);
    }

    if (isBlank(row.amount)) errors.push('amount é obrigatório');
    else if (!isValidNumber(row.amount)) errors.push('amount inválido');

    if (isBlank(row.dueDate)) errors.push('dueDate é obrigatório');
    else if (!isValidDateOnly(row.dueDate)) errors.push('dueDate inválida — esperado YYYY-MM-DD');

    if (isBlank(row.status)) errors.push('status é obrigatório');
    else if (!BILLING_STATUS_MAP[row.status]) {
      errors.push("status inválido — use 'pago', 'em_aberto' ou 'em_atraso'");
    }

    if (!isBlank(row.paymentDate) && !isValidDateOnly(row.paymentDate)) {
      errors.push('paymentDate inválida — esperado YYYY-MM-DD');
    }

    return { valid: errors.length === 0, errors };
  },
};

module.exports = {
  validators, normalizeCpf, isValidDateOnly, normalizeScope, BILLING_STATUS_MAP,
};
