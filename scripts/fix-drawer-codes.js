'use strict';

/**
 * CORREÇÃO DE DADOS — prefixa o código das GAVETAS com o bloco (jazigo) PAI.
 *
 * Contexto: a tela "Nova gaveta" enviava o NÚMERO puro como código ("18"). Como
 * o índice de unicidade é por CEMITÉRIO
 * (`graves_cemetery_id_code_active_unique ON graves (cemetery_id, code)
 * WHERE deleted_at IS NULL`), a gaveta 18 do bloco 12BLOCO01 colidia com a
 * gaveta 18 do bloco 12BLOCO15 — "Registro duplicado" num cadastro legítimo.
 * O código já foi corrigido (`drawerCode` em src/features/graves/graves.service.js):
 * a gaveta passa a se chamar `<código do bloco pai>-G<número>`. Este script
 * normaliza as gavetas que JÁ foram cadastradas com o número solto.
 *
 * O que faz: para cada gaveta ATIVA (unit_type = 'gaveta' com parent_grave_id)
 * cujo código NÃO comece com `<código do pai>-G`, renomeia para esse formato.
 * Se o código de destino já estiver ocupado por outra gaveta ATIVA do mesmo
 * cemitério, a linha é MANTIDA e apenas reportada (decisão humana).
 *
 * É IDEMPOTENTE: rodar de novo não muda nada.
 *
 * RODA NO BOOT da API (app.js), logo após o servidor subir: o cliente não tem
 * como abrir terminal no servidor, então o próprio deploy normaliza as gavetas
 * já cadastradas. É conservador (só renomeia quando o destino está livre) e
 * idempotente. Desligue com FIX_DRAWER_CODES=false.
 *
 * COMO EXECUTAR
 *   Simulação:  node scripts/fix-drawer-codes.js --dry-run
 *   Valendo:    node scripts/fix-drawer-codes.js
 *   Produção:   no container da API (EasyPanel → terminal do serviço), com as
 *               mesmas ENVs do app, os mesmos comandos acima.
 */

const { sequelize, Grave } = require('../src/models');
const { drawerCode } = require('../src/features/graves/graves.service');

/**
 * @param {{dryRun?: boolean, verbose?: boolean}} opts
 */
async function fixDrawerCodes({ dryRun = false, verbose = true } = {}) {
  // Só gavetas ATIVAS: as apagadas não ocupam código nem aparecem na tela.
  const gavetas = await Grave.findAll({
    where: { unitType: 'gaveta' },
    order: [['createdAt', 'ASC']],
  });
  let corrigidas = 0;
  let mantidas = 0;
  let semPai = 0;

  for (const gaveta of gavetas) {
    if (!gaveta.parentGraveId) { semPai += 1; continue; }

    // eslint-disable-next-line no-await-in-loop
    const pai = await Grave.findByPk(gaveta.parentGraveId);
    if (!pai) { semPai += 1; continue; }

    const alvo = drawerCode(pai.code, gaveta.code);
    if (!alvo || alvo === gaveta.code) continue; // já normalizada

    // O destino precisa estar livre entre as ATIVAS do mesmo cemitério.
    // eslint-disable-next-line no-await-in-loop
    const ocupante = await Grave.findOne({
      where: { tenantId: gaveta.tenantId, cemeteryId: gaveta.cemeteryId, code: alvo },
    });
    if (ocupante) {
      mantidas += 1;
      if (verbose) console.log(`  = ${gaveta.code} mantida (destino '${alvo}' já em uso por ${ocupante.id})`);
      continue;
    }

    corrigidas += 1;
    if (verbose) console.log(`  ${dryRun ? '~' : '>'} ${gaveta.code} → ${alvo} (${gaveta.id})`);
    if (!dryRun) {
      // hooks/silent: correção de dado, sem efeitos colaterais nem updatedAt.
      // eslint-disable-next-line no-await-in-loop
      await gaveta.update({ code: alvo }, { hooks: false, silent: true });
    }
  }

  return { gavetas: gavetas.length, corrigidas, mantidas, semPai };
}

module.exports = { fixDrawerCodes };

// Execução manual: `node scripts/fix-drawer-codes.js [--dry-run]`
if (require.main === module) {
  const dryRun = process.argv.includes('--dry-run');
  sequelize
    .authenticate()
    .then(() => fixDrawerCodes({ dryRun }))
    .then(async (r) => {
      console.log(
        `\n[fix-drawer-codes] ${r.gavetas} gaveta(s) ativa(s); `
        + `${r.corrigidas} ${dryRun ? 'a normalizar (dry-run)' : 'normalizada(s)'}; `
        + `${r.mantidas} mantida(s) por colisão; ${r.semPai} sem jazigo pai (ignorada(s)).`
      );
      await sequelize.close();
    })
    .catch(async (err) => {
      console.error('[fix-drawer-codes] FALHOU:', err.message);
      await sequelize.close().catch(() => {});
      process.exit(1);
    });
}
