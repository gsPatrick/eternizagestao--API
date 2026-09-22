'use strict';

/**
 * CORREÇÃO DE DADOS — remove o SUFIXO indevido do código das sepulturas.
 *
 * Contexto: `nextGraveCode` (src/features/graves/graves.service.js) contava
 * também as sepulturas SOFT-DELETED ao procurar um código livre. Como o cliente
 * criava e excluía a MESMA sepultura várias vezes, cada recriação ganhava um
 * sufixo (`12-12BLOCO18`, `-2`, `-3`, ... `-5`), embora o índice de unicidade
 * seja PARCIAL (só linhas com deleted_at IS NULL). O código já foi corrigido;
 * este script conserta as linhas que JÁ ficaram com sufixo.
 *
 * O que faz: para cada sepultura ATIVA cujo `code` é `<base>-<n>` (n >= 2),
 * recalcula a base a partir de QUADRA-LOTE da própria sepultura e, se a base
 * estiver LIVRE entre as ATIVAS do mesmo cemitério, renomeia para a base.
 * Sufixos que colidiriam com outra sepultura ativa são MANTIDOS (são sepulturas
 * distintas de verdade, na mesma quadra/lote) e apenas reportados.
 *
 * É IDEMPOTENTE: rodar de novo não muda nada.
 *
 * RODA NO BOOT da API (app.js), logo após o servidor subir: o cliente não tem
 * como abrir terminal no servidor, então o próprio deploy limpa os sufixos já
 * gravados. Só renomeia quando a base está LIVRE entre as sepulturas ativas —
 * nunca cria duplicidade — e é idempotente. Desligue com FIX_GRAVE_CODES=false.
 *
 * COMO EXECUTAR
 *   Simulação:  node scripts/fix-grave-code-suffixes.js --dry-run
 *   Valendo:    node scripts/fix-grave-code-suffixes.js
 *   Produção:   no container da API (EasyPanel → terminal do serviço), com as
 *               mesmas ENVs do app, os mesmos comandos acima.
 */

const { sequelize, Grave, Lot, Street, Block } = require('../src/models');

/**
 * Monta o código natural (QUADRA-LOTE) de uma sepultura.
 * Mesma regra de `nextGraveCode`, sem o sufixo.
 */
async function baseCodeOf(grave) {
  const lot = await Lot.findByPk(grave.lotId);
  if (!lot) return null;
  const street = lot.streetId ? await Street.findByPk(lot.streetId) : null;
  const block = street?.blockId ? await Block.findByPk(street.blockId) : null;
  return [block?.code, lot.code].filter(Boolean).join('-') || 'SEP';
}

/**
 * @param {{dryRun?: boolean, verbose?: boolean}} opts
 */
async function fixGraveCodeSuffixes({ dryRun = false, verbose = true } = {}) {
  // Só sepulturas ATIVAS: as apagadas não ocupam código nem são exibidas.
  const graves = await Grave.findAll({ order: [['createdAt', 'ASC']] });
  let corrigidas = 0;
  let mantidas = 0;

  for (const grave of graves) {
    if (!/-\d+$/.test(grave.code || '')) continue;

    const base = await baseCodeOf(grave);
    // Só mexe quando o sufixo é realmente redundante: `<base>-<n>` cuja base
    // bate com a quadra/lote atual. Códigos digitados à mão ficam intactos.
    if (!base || !new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-\\d+$`).test(grave.code)) continue;
    if (base === grave.code) continue;

    // A base precisa estar livre entre as ATIVAS do mesmo cemitério.
    const ocupante = await Grave.findOne({
      where: { tenantId: grave.tenantId, cemeteryId: grave.cemeteryId, code: base },
    });
    if (ocupante) {
      mantidas += 1;
      if (verbose) console.log(`  = ${grave.code} mantido (base '${base}' já em uso por ${ocupante.id})`);
      continue;
    }

    corrigidas += 1;
    if (verbose) console.log(`  ${dryRun ? '~' : '>'} ${grave.code} → ${base} (${grave.id})`);
    if (!dryRun) {
      // hooks/silent: correção de dado, sem efeitos colaterais nem updatedAt.
      await grave.update({ code: base }, { hooks: false, silent: true });
    }
  }

  return { sepulturas: graves.length, corrigidas, mantidas };
}

module.exports = { fixGraveCodeSuffixes };

// Execução manual: `node scripts/fix-grave-code-suffixes.js [--dry-run]`
if (require.main === module) {
  const dryRun = process.argv.includes('--dry-run');
  sequelize
    .authenticate()
    .then(() => fixGraveCodeSuffixes({ dryRun }))
    .then(async (r) => {
      console.log(
        `\n[fix-grave-code-suffixes] ${r.sepulturas} sepultura(s) ativa(s); `
        + `${r.corrigidas} ${dryRun ? 'a normalizar (dry-run)' : 'normalizada(s)'}; `
        + `${r.mantidas} mantida(s) por colisão com sepultura ativa.`
      );
      await sequelize.close();
    })
    .catch(async (err) => {
      console.error('[fix-grave-code-suffixes] FALHOU:', err.message);
      await sequelize.close().catch(() => {});
      process.exit(1);
    });
}
