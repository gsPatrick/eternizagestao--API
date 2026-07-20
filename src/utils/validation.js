'use strict';

const AppError = require('./app-error');

/**
 * Validação superficial de payloads nos controllers (regra de negócio fica no service).
 */

// Lança 400 listando os campos obrigatórios ausentes/vazios.
function requireFields(body = {}, fields = []) {
  const missing = fields.filter(
    (f) => body[f] === undefined || body[f] === null || body[f] === ''
  );
  if (missing.length) {
    throw AppError.badRequest(
      `Campos obrigatórios ausentes: ${missing.join(', ')}`,
      'MISSING_FIELDS',
      missing.map((field) => ({ field, message: 'obrigatório' }))
    );
  }
}

// Retorna apenas os campos permitidos (whitelist) — evita mass assignment.
function pick(obj = {}, fields = []) {
  const out = {};
  for (const f of fields) {
    if (obj[f] !== undefined) out[f] = obj[f];
  }
  return out;
}

// Valida que o valor pertence a um conjunto (enums vindos do cliente).
function requireOneOf(value, allowed, fieldName) {
  if (!allowed.includes(value)) {
    throw AppError.badRequest(
      `Valor inválido para ${fieldName}. Permitidos: ${allowed.join(', ')}`,
      'INVALID_ENUM_VALUE'
    );
  }
}

module.exports = { requireFields, pick, requireOneOf };
