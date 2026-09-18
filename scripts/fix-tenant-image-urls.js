'use strict';

/**
 * CORREÇÃO DE DADOS — limpa a ASSINATURA das URLs de imagem dos tenants.
 *
 * Contexto: o painel recebia a URL já assinada (?token=...&exp=...) e a devolvia
 * no PATCH de onboarding; a API gravava esse valor cru no banco. Na leitura, a
 * API assinava POR CIMA (/files/x.jpg?token=A&exp=B?token=C&exp=D), a validação
 * do /files falhava e a imagem voltava 403 (miniatura quebrada, landing pública
 * sem atualizar). O código já não grava mais assim; este script conserta as
 * linhas que JÁ ficaram sujas.
 *
 * Campos tratados: logoUrl, heroImageUrl, footerImageUrl (TODOS os tenants,
 * inclusive os soft-deleted).
 *
 * É IDEMPOTENTE: rodar de novo não muda nada (só limpa o que ainda tem '?').
 *
 * RODA SOZINHO NO BOOT da API (app.js), logo após o servidor subir: é uma
 * varredura barata (uma linha por cidade) e idempotente, então o cliente não
 * precisa abrir terminal nenhum — o deploy já conserta as imagens. Desligue com
 * FIX_IMAGE_URLS=false.
 *
 * COMO EXECUTAR À MÃO (opcional)
 *   Local:      node scripts/fix-tenant-image-urls.js
 *   Produção:   no container da API (EasyPanel → terminal do serviço),
 *               com as mesmas ENVs do app:
 *                 node scripts/fix-tenant-image-urls.js
 *   Simulação:  node scripts/fix-tenant-image-urls.js --dry-run
 *               (mostra o que mudaria, sem gravar)
 */

const { sequelize, Tenant } = require('../src/models');
const storage = require('../src/providers/storage');

const CAMPOS = ['logoUrl', 'heroImageUrl', 'footerImageUrl'];

/**
 * Limpa as URLs sujas e devolve o resumo. NÃO fecha a conexão (é chamado tanto
 * pelo boot, que segue usando o pool, quanto pela execução manual abaixo).
 *
 * @param {{dryRun?: boolean, verbose?: boolean}} opts
 * @returns {Promise<{cidades:number, corrigidos:number, campos:number}>}
 */
async function fixTenantImageUrls({ dryRun = false, verbose = true } = {}) {
  // paranoid:false → cidades removidas também são corrigidas (podem voltar).
  const tenants = await Tenant.findAll({ paranoid: false });
  let corrigidos = 0;
  let campos = 0;

  for (const tenant of tenants) {
    const patch = {};
    for (const campo of CAMPOS) {
      const atual = tenant[campo];
      if (!atual) continue;
      const limpo = storage.rawFileUrl(atual);
      if (limpo !== atual) {
        patch[campo] = limpo;
        campos += 1;
        if (verbose) {
          console.log(`  [${tenant.subdomain}] ${campo}\n    de:   ${atual}\n    para: ${limpo}`);
        }
      }
    }
    if (!Object.keys(patch).length) continue;
    corrigidos += 1;
    if (!dryRun) {
      // hooks:false/silent → correção de dados não deve mexer em updatedAt nem
      // disparar efeitos colaterais do modelo.
      await tenant.update(patch, { paranoid: false, hooks: false, silent: true });
    }
  }

  return { cidades: tenants.length, corrigidos, campos };
}

module.exports = { fixTenantImageUrls };

// Execução manual: `node scripts/fix-tenant-image-urls.js [--dry-run]`
if (require.main === module) {
  const dryRun = process.argv.includes('--dry-run');
  sequelize
    .authenticate()
    .then(() => fixTenantImageUrls({ dryRun }))
    .then(async (r) => {
      console.log(
        `\n[fix-tenant-image-urls] ${r.cidades} cidade(s) verificada(s); `
        + `${r.corrigidos} com URL suja; ${r.campos} campo(s) `
        + `${dryRun ? 'a corrigir (dry-run)' : 'corrigido(s)'}.`
      );
      await sequelize.close();
    })
    .catch(async (err) => {
      console.error('[fix-tenant-image-urls] FALHOU:', err.message);
      await sequelize.close().catch(() => {});
      process.exit(1);
    });
}
