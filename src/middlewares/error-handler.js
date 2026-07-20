'use strict';

const AppError = require('../utils/app-error');

// 404 para rotas não registradas — encaminha para o handler único
function notFoundHandler(req, res, next) {
  next(AppError.notFound(`Rota não encontrada: ${req.method} ${req.originalUrl}`, 'ROUTE_NOT_FOUND'));
}

// Handler de erro ÚNICO da API — sempre o último middleware.
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
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

  return res.status(statusCode).json(body);
}

module.exports = { notFoundHandler, errorHandler };
