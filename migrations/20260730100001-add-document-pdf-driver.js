'use strict';

/**
 * Rastreabilidade do PDF do documento oficial: qual driver o gerou.
 *
 * O provider de PDF degrada automaticamente para o driver `fallback` quando o
 * Chromium não está disponível — o arquivo continua sendo um PDF válido, mas
 * SEM layout, logotipo ou cores. Sem registrar isso, um documento oficial
 * degradado é indistinguível do fiel (ambos começam com `%PDF-`) e não há como
 * listar o que precisa ser reemitido.
 *
 * Valores: 'puppeteer' (fiel), 'fallback' (degradado), null (documento anterior
 * a este campo — origem desconhecida).
 *
 * Idempotente: só cria a coluna se ainda não existir.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('documents');
    if (!table.pdf_driver) {
      await queryInterface.addColumn('documents', 'pdf_driver', {
        type: Sequelize.STRING(20),
        allowNull: true,
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('documents');
    if (table.pdf_driver) await queryInterface.removeColumn('documents', 'pdf_driver');
  },
};
