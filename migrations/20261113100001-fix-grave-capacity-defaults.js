'use strict';

/**
 * CORREÇÃO DE DADOS — "Sepultura sem capacidade disponível" (regressão relatada
 * pelo cliente em out/2026).
 *
 * Causa: o painel nunca enviou `capacity` ao cadastrar sepultura e a coluna tem
 * DEFAULT 1. Todo jazigo/túmulo nascia aceitando UM sepultamento; o segundo era
 * recusado. O código agora aplica o padrão por tipo (jazigo/túmulo = 4) e a
 * capacidade efetiva considera as gavetas; esta migration corrige o que já foi
 * gravado:
 *
 *  1) jazigos/túmulos com capacity = 1 (o valor-padrão nunca escolhido pelo
 *     operador) passam a 4;
 *  2) qualquer sepultura cujo nº de sepultamentos ativos (de sepultados não
 *     excluídos) já supera a capacidade tem a capacidade elevada a esse nº —
 *     registros migrados do sistema antigo não ficam "acima da lotação";
 *  3) sepulturas presas em "ocupada" que agora têm vaga voltam a "livre"
 *     (status do próprio tenant, se existir; senão o de sistema). Status
 *     manuais (interditada, reservada, perpetuidade…) não são tocados.
 *
 * Idempotente. O down não desfaz a correção de dados (não há como saber quais
 * registros tinham 1 por escolha) — é no-op de propósito.
 */
module.exports = {
  async up(queryInterface) {
    const q = (sql) => queryInterface.sequelize.query(sql);

    await q(`
      UPDATE graves
         SET capacity = 4, updated_at = NOW()
       WHERE unit_type IN ('jazigo', 'tumulo')
         AND capacity = 1
         AND deleted_at IS NULL
    `);

    await q(`
      UPDATE graves g
         SET capacity = a.total, updated_at = NOW()
        FROM (
          SELECT b.grave_id, COUNT(*)::int AS total
            FROM burials b
            JOIN deceased d ON d.id = b.deceased_id AND d.deleted_at IS NULL
           WHERE b.status = 'ativo'
           GROUP BY b.grave_id
        ) a
       WHERE a.grave_id = g.id
         AND g.capacity < a.total
    `);

    await q(`
      WITH ativos AS (
        SELECT b.grave_id, COUNT(*)::int AS total
          FROM burials b
          JOIN deceased d ON d.id = b.deceased_id AND d.deleted_at IS NULL
         WHERE b.status = 'ativo'
         GROUP BY b.grave_id
      ),
      gavetas AS (
        SELECT parent_grave_id, COUNT(*)::int AS total
          FROM graves
         WHERE parent_grave_id IS NOT NULL AND deleted_at IS NULL
         GROUP BY parent_grave_id
      ),
      alvo AS (
        SELECT g.id, g.tenant_id
          FROM graves g
          JOIN grave_statuses s ON s.id = g.status_id AND s.slug = 'ocupada'
          LEFT JOIN ativos a ON a.grave_id = g.id
          LEFT JOIN gavetas gv ON gv.parent_grave_id = g.id
         WHERE g.deleted_at IS NULL
           AND COALESCE(a.total, 0) < GREATEST(g.capacity, COALESCE(gv.total, 0))
      )
      UPDATE graves g
         SET status_id = COALESCE(
               (SELECT id FROM grave_statuses WHERE tenant_id = alvo.tenant_id AND slug = 'livre' LIMIT 1),
               (SELECT id FROM grave_statuses WHERE tenant_id IS NULL AND slug = 'livre' LIMIT 1)
             ),
             updated_at = NOW()
        FROM alvo
       WHERE g.id = alvo.id
         AND EXISTS (SELECT 1 FROM grave_statuses WHERE slug = 'livre')
    `);
  },

  async down() {
    // correção de dados — sem reversão (ver cabeçalho)
  },
};
