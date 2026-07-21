'use strict';

const catchAsync = require('../../utils/catch-async');
const { ok, noContent } = require('../../utils/http-response');
const { requireFields } = require('../../utils/validation');
const service = require('./password-resets.service');

// POST /password-resets — solicita o código.
// SEMPRE 202: a resposta não revela se o e-mail existe (anti-enumeração).
const request = catchAsync(async (req, res) => {
  requireFields(req.body, ['email', 'origin']);
  const result = await service.request({
    email: req.body.email,
    origin: req.body.origin,
    tenant: req.tenant || null, // resolvido (opcional) pelo tenant-resolver
    ip: req.ip,
  });
  return ok(res, result, undefined, 202);
});

// POST /password-resets/verify — confere o código sem consumi-lo (a UI usa
// isto só para liberar a tela de nova senha; o confirm revalida).
const verify = catchAsync(async (req, res) => {
  requireFields(req.body, ['email', 'code']);
  const result = await service.verify({ email: req.body.email, code: req.body.code });
  return ok(res, result);
});

// POST /password-resets/confirm — troca a senha e queima o código. 204 sem
// corpo: nada sobre a conta deve voltar para um chamador não autenticado.
const confirm = catchAsync(async (req, res) => {
  requireFields(req.body, ['email', 'code', 'password']);
  await service.confirm({
    email: req.body.email,
    code: req.body.code,
    password: req.body.password,
  });
  return noContent(res);
});

module.exports = { request, verify, confirm };
