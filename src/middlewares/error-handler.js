'use strict';

const AppError = require('../utils/app-error');

// 404 para rotas não registradas — encaminha para o handler único
function notFoundHandler(req, res, next) {
  next(AppError.notFound(`Rota não encontrada: ${req.method} ${req.originalUrl}`, 'ROUTE_NOT_FOUND'));
}

// Mapa de códigos SQLSTATE do Postgres que são CULPA DO CLIENTE (dado enviado),
// não bug do servidor. Sem isto eles caem em SequelizeDatabaseError e o handler
// os trata como 500 + "[ERRO NÃO TRATADO]" com stack — foi o que aconteceu em
// produção no PATCH /v1/tenant/onboarding (22001: valor maior que a coluna).
const PG_CLIENT_ERRORS = {
  '22001': {
    message:
      'Valor muito longo para um dos campos. Reduza o tamanho do texto/endereço enviado e tente novamente.',
    code: 'VALUE_TOO_LONG',
  },
  '22P02': { message: 'Formato de dado inválido em um dos campos.', code: 'INVALID_TEXT_REPRESENTATION' },
  '22003': { message: 'Valor numérico fora do intervalo permitido.', code: 'NUMERIC_OUT_OF_RANGE' },
  '22007': { message: 'Data/hora em formato inválido.', code: 'INVALID_DATETIME_FORMAT' },
  '23502': { message: 'Campo obrigatório não informado.', code: 'NOT_NULL_VIOLATION' },
  '23514': { message: 'Valor não permitido para um dos campos.', code: 'CHECK_VIOLATION' },
};

// SQLSTATE do erro do Postgres, venha ele pelo wrapper do Sequelize ou cru do pg.
function pgCode(err) {
  return err?.parent?.code || err?.original?.code || err?.code || null;
}

// Conexão interrompida pelo cliente/proxy no meio do envio (upload grande,
// aba fechada, timeout do Nginx). NÃO é erro do servidor: não tem conserto
// aqui, não merece stack no log e a resposta quase sempre nem chega ao cliente.
function isAbortedRequest(err, req) {
  if (err?.type === 'request.aborted') return true;
  if (err?.code === 'ECONNABORTED' || err?.code === 'ECONNRESET') return true;
  if (err?.message === 'request aborted') return true;
  return Boolean(req?.aborted && err?.status === 400);
}

// Handler de erro ÚNICO da API — sempre o último middleware.
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  // (A) Conexão abortada — log curto de uma linha, sem stack, sem [ERRO NÃO TRATADO].
  if (isAbortedRequest(err, req)) {
    const esperado = err?.expected ? `${err.expected}B` : '?';
    const recebido = err?.received !== undefined ? `${err.received}B` : '?';
    console.warn(
      `[CONEXÃO INTERROMPIDA] ${req.method} ${req.originalUrl} — envio cortado `
      + `(recebido ${recebido} de ${esperado}). Cliente/proxy encerrou a conexão.`
    );
    // Se o socket já foi embora, não adianta responder — só encerra.
    if (res.headersSent || req.aborted || !res.writable) {
      try { res.end(); } catch { /* socket já fechado */ }
      return undefined;
    }
    return res.status(400).json({
      success: false,
      error: {
        code: 'REQUEST_ABORTED',
        message: 'O envio foi interrompido antes de terminar. Verifique a conexão e tente novamente.',
      },
    });
  }

  // (B) Corpo maior que o limite configurado — 413 com mensagem clara.
  if (err?.type === 'entity.too.large') {
    err = new AppError(
      'Arquivo muito grande para envio. Reduza o tamanho e tente novamente.',
      413,
      'PAYLOAD_TOO_LARGE'
    );
  } else if (err?.type === 'entity.parse.failed') {
    err = AppError.badRequest('Corpo da requisição em JSON inválido.', 'INVALID_JSON');
  }

  // Erros de validação/constraint do Sequelize viram erros de cliente estáveis
  if (err.name === 'SequelizeUniqueConstraintError') {
    err = AppError.conflict(
      'Registro duplicado: já existe um recurso com esses dados.',
      'UNIQUE_VIOLATION',
      err.errors?.map((e) => ({ field: e.path, message: e.message }))
    );
  } else if (err.name === 'SequelizeValidationError') {
    err = AppError.badRequest(
      'Dados inválidos.',
      'VALIDATION_ERROR',
      err.errors?.map((e) => ({ field: e.path, message: e.message }))
    );
  } else if (err.name === 'SequelizeForeignKeyConstraintError') {
    err = AppError.badRequest('Referência inválida: registro relacionado não existe.', 'FK_VIOLATION');
  } else if (PG_CLIENT_ERRORS[pgCode(err)]) {
    // Erro de BANCO causado pelo dado enviado (ex.: 22001 valor longo demais).
    // Vira 400 tratado, em português, em vez de 500 "[ERRO NÃO TRATADO]".
    const mapped = PG_CLIENT_ERRORS[pgCode(err)];
    console.warn(
      `[DB ${pgCode(err)}] ${req.method} ${req.originalUrl} — ${err.parent?.message || err.message}`
    );
    err = AppError.badRequest(mapped.message, mapped.code);
  }

  const statusCode = err.statusCode || 500;
  const code = err.code && typeof err.code === 'string' ? err.code : 'INTERNAL_ERROR';

  // Erros não operacionais (bugs) não vazam detalhes internos para o cliente
  const message = err.isOperational ? err.message : 'Erro interno do servidor.';
  if (!err.isOperational) {
    console.error('[ERRO NÃO TRATADO]', err);
  }

  const body = { success: false, error: { code, message } };
  if (err.details) body.error.details = err.details;

  // Se a resposta já começou (stream/sendFile), não dá para trocar o status:
  // tentar responder aqui gera ERR_HTTP_HEADERS_SENT e derruba o handler.
  if (res.headersSent) {
    try { res.end(); } catch { /* socket já fechado */ }
    return undefined;
  }

  return res.status(statusCode).json(body);
}

module.exports = { notFoundHandler, errorHandler };
