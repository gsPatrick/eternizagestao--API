'use strict';

/**
 * URL do PDF oficial do documento. Coluna opcional / nullable em `documents`:
 * o `file_url` continua guardando o HTML branded (fonte); `pdf_url` guarda o PDF
 * gerado a partir dele (o artefato que a família/painel baixa). Preenchida na
 * emissão (best-effort) ou sob demanda pelo endpoint GET /documents/:id/pdf.
 *
 * Idempotente por coluna (só adiciona se ainda não existir). DOWN remove a coluna.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('documents');
    if (!table.pdf_url) {
      await queryInterface.addColumn('documents', 'pdf_url', {
        type: Sequelize.STRING(500),
        allowNull: true,
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('documents');
    if (table.pdf_url) {
      await queryInterface.removeColumn('documents', 'pdf_url');
    }
  },
};
