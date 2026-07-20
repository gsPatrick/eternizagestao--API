'use strict';

/**
 * Render simples de templates com placeholders {{caminho.do.campo}}.
 * Usado na emissão de documentos oficiais a partir dos modelos do cliente.
 */
function render(templateString = '', data = {}) {
  return templateString.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (match, path) => {
    const value = path.split('.').reduce((acc, key) => (acc == null ? acc : acc[key]), data);
    return value === undefined || value === null ? '' : String(value);
  });
}

module.exports = { render };
