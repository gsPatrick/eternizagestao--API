'use strict';

/**
 * Georreferência da ortofoto por POSICIONAMENTO POR CANTOS.
 *
 * Fluxo do operador: sobre a base OpenStreetMap ele carrega a ortofoto (imagem)
 * e a posiciona/alinha sobre o cemitério (arrastando/escalando/rotacionando os
 * 4 cantos). Cada canto vira uma coordenada geográfica real, salva em `corners`.
 *
 *  - corners : JSONB — 4 cantos { tl:[lat,lng], tr:[lat,lng], br:[lat,lng], bl:[lat,lng] }
 *              (tl=top-left, tr=top-right, br=bottom-right, bl=bottom-left).
 *              Complementa/substitui o `bounds` legado (retângulo alinhado ao norte).
 *  - opacity : FLOAT default 0.85 — opacidade da ortofoto sobre o mapa base.
 *
 * Idempotente por coluna. DOWN remove as colunas adicionadas.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('orthophotos');
    const addColumn = async (name, spec) => {
      if (!table[name]) await queryInterface.addColumn('orthophotos', name, spec);
    };

    await addColumn('corners', { type: Sequelize.JSONB, allowNull: true });
    await addColumn('opacity', { type: Sequelize.FLOAT, allowNull: false, defaultValue: 0.85 });
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('orthophotos');
    const dropColumn = async (name) => {
      if (table[name]) await queryInterface.removeColumn('orthophotos', name);
    };

    await dropColumn('corners');
    await dropColumn('opacity');
  },
};
