'use strict';

/**
 * Resposta HTTP padronizada da API.
 * Sucesso:  { success: true, data, meta? }
 * Erro:     { success: false, error: { code, message, details? } } (ver error-handler)
 */

function ok(res, data, meta = undefined, statusCode = 200) {
  const body = { success: true, data };
  if (meta) body.meta = meta;
  return res.status(statusCode).json(body);
}

function created(res, data) {
  return ok(res, data, undefined, 201);
}

function noContent(res) {
  return res.status(204).send();
}

module.exports = { ok, created, noContent };
