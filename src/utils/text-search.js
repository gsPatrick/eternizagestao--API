'use strict';

const { literal } = require('sequelize');

/**
 * Busca textual tolerante para nomes (pessoas, sepultados…).
 *
 * Por que existe: `iLike '%termo%'` exige o termo literal — "joao" não achava
 * "João", e "maria jesus" não achava "Maria Aparecida de Jesus". Com milhares de
 * pessoas cadastradas, o operador digita do jeito que lembra; a busca precisa:
 *   - ignorar acentos e maiúsculas (sem depender da extensão `unaccent`, que
 *     pode não estar instalada no Postgres de produção — usamos `translate`);
 *   - casar CADA palavra digitada em qualquer posição do nome (AND entre elas);
 *   - casar o CPF só pelos dígitos ("123.456" acha "123.456.789-00" e "12345").
 */

const ACCENTED = 'áàâãäåéèêëíìîïóòôõöúùûüçñýÿÁÀÂÃÄÅÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑÝ';
const PLAIN = 'aaaaaaeeeeiiiiooooouuuucnyyAAAAAAEEEEIIIIOOOOOUUUUCNY';

function normalizeTerm(term) {
  return String(term || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

// Escapa os curingas do LIKE para o termo do usuário ser literal.
function escapeLike(s) {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}

function normalizedColumn(qualifiedColumn) {
  return `lower(translate(${qualifiedColumn}, '${ACCENTED}', '${PLAIN}'))`;
}

/**
 * Monta as condições (para `where[Op.and]`) de uma busca por nome/CPF.
 *
 * @param {import('sequelize').Sequelize} sequelize  instância (para escapar valores)
 * @param {string} term                               texto digitado
 * @param {object} cols
 * @param {string}  cols.name   coluna do nome, já qualificada (ex.: '"Person"."full_name"')
 * @param {string} [cols.cpf]   coluna do CPF, já qualificada
 * @param {string[]} [cols.extra] outras colunas texto que também casam o termo inteiro
 * @returns {import('sequelize').Utils.Literal | null}  condição única, ou null se vazio
 */
function buildNameSearch(sequelize, term, { name, cpf, extra = [] }) {
  const norm = normalizeTerm(term);
  if (!norm) return null;

  const words = norm.split(/\s+/).filter(Boolean).slice(0, 8);
  const nameExpr = normalizedColumn(name);
  const byName = words
    .map((w) => `${nameExpr} LIKE ${sequelize.escape(`%${escapeLike(w)}%`)}`)
    .join(' AND ');

  const alternatives = [`(${byName})`];

  const digits = String(term).replace(/\D/g, '');
  if (cpf && digits.length >= 3) {
    alternatives.push(
      `regexp_replace(coalesce(${cpf}, ''), '\\D', '', 'g') LIKE ${sequelize.escape(`%${digits}%`)}`
    );
  }

  extra.forEach((col) => {
    alternatives.push(
      `${normalizedColumn(col)} LIKE ${sequelize.escape(`%${escapeLike(norm)}%`)}`
    );
  });

  return literal(`(${alternatives.join(' OR ')})`);
}

module.exports = { buildNameSearch, normalizeTerm };
