'use strict';

/**
 * Helpers compartilhados pelos drivers de WhatsApp (evolution/mock).
 * Fonte ÚNICA do nome da instância por cidade e do mapeamento de estado, para
 * que o webhook e a UI falem sempre a mesma língua.
 */

const PREFIX = 'cidade-';

// Nome da instância Evolution da cidade: `cidade-<subdomain>` (estável, único).
// Sem subdomínio (caso degenerado) cai no id do tenant.
function instanceNameFor(tenant) {
  const sub = tenant && (tenant.subdomain || tenant.id);
  return `${PREFIX}${String(sub || 'default').toLowerCase()}`;
}

// Extrai o subdomínio a partir do instanceName (usado pelo webhook para achar o tenant).
function subdomainFromInstance(instance) {
  const s = String(instance || '');
  return s.startsWith(PREFIX) ? s.slice(PREFIX.length) : s;
}

// Estado do Evolution (connectionState/connection.update) → nosso enum estável.
function mapState(state) {
  switch (String(state || '').toLowerCase()) {
    case 'open':
      return 'conectado';
    case 'connecting':
      return 'conectando';
    default:
      return 'desconectado'; // 'close', vazio, desconhecido
  }
}

module.exports = { instanceNameFor, subdomainFromInstance, mapState, PREFIX };
