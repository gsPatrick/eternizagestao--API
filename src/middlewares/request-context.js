'use strict';

/**
 * Contexto por-request via AsyncLocalStorage (ALS).
 *
 * Cria um "store" isolado por request para carregar o ATOR da ação (quem está
 * fazendo o quê) através de toda a pilha: auth → tenant-resolver → controller →
 * service → hooks globais do Sequelize. Assim o motor de auditoria descobre o
 * autor de qualquer INSERT/UPDATE/DELETE sem precisar passar `req` adiante.
 *
 * Contrato (outros módulos dependem EXATO disto):
 *  - contextMiddleware(req, res, next): abre um store vazio para o request.
 *  - setActor(partial): mescla campos do ator no store atual.
 *  - getActor(): retorna o store atual (ou {} fora de um request; nunca lança).
 *
 * Campos padrão do store: { userId, portalAccountId, tenantId, ipAddress,
 * userAgent, __audited }.
 */

const { AsyncLocalStorage } = require('async_hooks');

const als = new AsyncLocalStorage();

// Aberto no TOPO de src/routes/index.js — todo o processamento subsequente
// (auth, controllers, services e hooks do Sequelize) roda dentro deste escopo.
function contextMiddleware(req, res, next) {
  als.run({}, () => next());
}

// Mescla dados do ator no store atual. Silencioso se chamado fora de um request.
function setActor(partial = {}) {
  const store = als.getStore();
  if (!store) return;
  Object.assign(store, partial);
}

// Nunca lança: fora de um request (jobs/seed) retorna objeto vazio.
function getActor() {
  return als.getStore() || {};
}

module.exports = { als, contextMiddleware, setActor, getActor };
