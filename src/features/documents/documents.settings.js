'use strict';

/**
 * TEXTO LEGAL POR CIDADE — guardado em `tenant.settings.documents`:
 *   { legalCertidao, legalAutorizacao }
 *
 * Os DEFAULTS são os textos de Itaberaba (usados como exemplo/base); o admin
 * edita pela tela de Documentos (GET/PATCH /documents/settings). Injetados nos
 * modelos oficiais como {{texto_legal}} (fundamentação legal).
 */

const AppError = require('../../utils/app-error');
const { Tenant } = require('../../models');

// Texto legal padrão da CERTIDÃO DE PERPETUIDADE — "RESPONSABILIDADE DO
// PROPRIETÁRIO(A)" (texto oficial fornecido pelo cliente; editável por cidade).
const DEFAULT_LEGAL_CERTIDAO =
  'Em caso de abandono ou ruína de sepultura ou jazigo perpétuo ou de suas ' +
  'construções funerárias, observado os critérios legais, poderá a Administração ' +
  'revogar a concessão de uso perpétuo da sepultura e dar destinação adequada os ' +
  'restos mortais, conforme estabelecido no Art. 17 § 3º.';

// Texto legal padrão da AUTORIZAÇÃO DE SEPULTAMENTO — "OBRIGAÇÕES DO RESPONSÁVEL
// PELO FALECIDO(A)" (texto oficial fornecido pelo cliente; editável por cidade).
const DEFAULT_LEGAL_AUTORIZACAO =
  'O responsável pelo(a) falecido(a) deverá comparecer na Administração do ' +
  'Cemitério, em 30 (trinta) dias antes do vencimento abaixo mencionado, para ' +
  'tratar da exumação dos despojos do falecido, concessão de uso provisório de ' +
  'sepultura será por 3 (três) anos, contados da data do sepultamento de acordo ' +
  'com o Art. 17. Findos os prazos previstos no caput deste artigo, os restos ' +
  'mortais existentes na sepultura provisória poderão ser removidos para o ' +
  'ossuário, bem como os caixões e outros objetos destinados à incineração ou a ' +
  'local adequado, sendo a respectiva sepultura considerada vaga.';

const DEFAULTS = {
  legalCertidao: DEFAULT_LEGAL_CERTIDAO,
  legalAutorizacao: DEFAULT_LEGAL_AUTORIZACAO,
};

// Normaliza o bloco `documents` de settings mesclando com os defaults.
function resolveDocumentsSettings(tenant) {
  const settings = (tenant && tenant.settings && typeof tenant.settings === 'object') ? tenant.settings : {};
  const docs = (settings.documents && typeof settings.documents === 'object') ? settings.documents : {};
  return {
    legalCertidao: typeof docs.legalCertidao === 'string' && docs.legalCertidao.trim() ? docs.legalCertidao : DEFAULTS.legalCertidao,
    legalAutorizacao: typeof docs.legalAutorizacao === 'string' && docs.legalAutorizacao.trim() ? docs.legalAutorizacao : DEFAULTS.legalAutorizacao,
  };
}

// Texto legal do tipo de documento (para injeção no template).
function legalTextFor(tenant, documentType) {
  const cfg = resolveDocumentsSettings(tenant);
  if (documentType === 'autorizacao_sepultamento') return cfg.legalAutorizacao;
  return cfg.legalCertidao; // certidão (default)
}

// GET /documents/settings — devolve o texto legal efetivo (com defaults).
async function getSettings(tenantId) {
  const tenant = await Tenant.findByPk(tenantId);
  if (!tenant) throw AppError.notFound('Tenant não encontrado.');
  return resolveDocumentsSettings(tenant);
}

// PATCH /documents/settings — persiste { legalCertidao?, legalAutorizacao? }.
async function updateSettings(tenantId, body = {}) {
  const tenant = await Tenant.findByPk(tenantId);
  if (!tenant) throw AppError.notFound('Tenant não encontrado.');

  const current = (tenant.settings && typeof tenant.settings === 'object') ? tenant.settings : {};
  const currentDocs = (current.documents && typeof current.documents === 'object') ? current.documents : {};

  const nextDocs = { ...currentDocs };
  if (typeof body.legalCertidao === 'string') nextDocs.legalCertidao = body.legalCertidao;
  if (typeof body.legalAutorizacao === 'string') nextDocs.legalAutorizacao = body.legalAutorizacao;

  // JSONB: reatribui o objeto inteiro para o Sequelize detectar a mudança.
  await tenant.update({ settings: { ...current, documents: nextDocs } });
  return resolveDocumentsSettings(tenant);
}

module.exports = {
  DEFAULTS,
  resolveDocumentsSettings,
  legalTextFor,
  getSettings,
  updateSettings,
};
