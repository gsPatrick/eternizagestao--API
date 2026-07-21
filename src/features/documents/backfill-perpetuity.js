'use strict';

/**
 * BACKFILL das Certidões de Perpetuidade.
 *
 * A emissão automática só passou a existir depois que muitas sepulturas já
 * estavam marcadas como "Perpétuo" (e havia o bug do acento, que impedia a
 * emissão mesmo nas novas). Este backfill emite as certidões que FALTAM, sem
 * exigir que o operador reabra sepultura por sepultura.
 *
 * Roda no boot da API (app.js), em segundo plano. Propriedades importantes:
 *  - IDEMPOTENTE: só emite para sepultura perpétua SEM certidão; nas execuções
 *    seguintes não encontra nada e sai barato.
 *  - LIMITADO por execução (PERPETUITY_BACKFILL_BATCH, padrão 200) para não
 *    pesar o start nem o Chromium do PDF; o restante sai nos próximos boots.
 *  - BEST-EFFORT: falha em uma sepultura não interrompe as demais nem a API.
 *  - Desligável com PERPETUITY_BACKFILL=false.
 */

const { Op } = require('sequelize');
const { Grave, Document } = require('../../models');
const { ensurePerpetuityCertificate } = require('../graves/graves.service');

const BATCH = Number(process.env.PERPETUITY_BACKFILL_BATCH || 200);

async function backfillPerpetuityCertificates({ batch = BATCH } = {}) {
  // Sepulturas marcadas como perpétuas. ILIKE cobre as duas grafias porque o
  // valor gravado é "Perpétuo" (com acento) — foi justamente o acento que
  // quebrava o casamento antes.
  const graves = await Grave.findAll({
    where: {
      [Op.or]: [
        { utilizacao: { [Op.iLike]: '%perpet%' } },
        { utilizacao: { [Op.iLike]: '%perpét%' } },
      ],
    },
    attributes: ['id', 'tenantId', 'code', 'utilizacao'],
    order: [['createdAt', 'ASC']],
    limit: batch * 10, // janela de varredura; o corte real é o `batch` abaixo
  });
  if (!graves.length) return { pendentes: 0, emitidas: 0, falhas: 0 };

  // Quais já têm certidão (uma query só, sem N+1).
  const existentes = await Document.findAll({
    where: {
      graveId: { [Op.in]: graves.map((g) => g.id) },
      documentType: 'certidao_perpetuidade',
    },
    attributes: ['graveId'],
    raw: true,
  });
  const jaTem = new Set(existentes.map((d) => d.graveId));

  const pendentes = graves.filter((g) => !jaTem.has(g.id));
  const lote = pendentes.slice(0, batch);
  let emitidas = 0;
  let falhas = 0;

  for (const grave of lote) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await ensurePerpetuityCertificate(grave.tenantId, grave, null);
      emitidas += 1;
    } catch (err) {
      falhas += 1;
      console.error(`[backfill-certidao] sepultura ${grave.code}: ${err.message}`);
    }
  }

  return { pendentes: pendentes.length, emitidas, falhas };
}

module.exports = { backfillPerpetuityCertificates };
