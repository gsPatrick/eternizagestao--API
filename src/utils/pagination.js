'use strict';

// Paginação padronizada para todas as listagens da API.
// Query params: ?page=1&perPage=20

function getPagination(query = {}, { defaultPerPage = 20, maxPerPage = 100 } = {}) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const perPage = Math.min(maxPerPage, Math.max(1, parseInt(query.perPage, 10) || defaultPerPage));
  return { page, perPage, limit: perPage, offset: (page - 1) * perPage };
}

function buildPageMeta(totalItems, page, perPage) {
  return {
    page,
    perPage,
    totalItems,
    totalPages: Math.max(1, Math.ceil(totalItems / perPage)),
  };
}

module.exports = { getPagination, buildPageMeta };
