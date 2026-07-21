'use strict';

/**
 * Seed de PRODUÇÃO — cria SOMENTE o super_admin padrão da plataforma.
 * Idempotente (findOrCreate) e sem auditoria (skipAudit). O resto do sistema
 * fica vazio; o super_admin loga em /admin/login e cria as cidades.
 *
 * ENDURECIMENTO (segurança):
 * -----------------------------------------------------------------------------
 * Este script roda a CADA deploy (ver Dockerfile). Antes ele criava o admin com
 * uma senha padrão ('eternizagestao') que está versionada no repositório — ou
 * seja, TODO ambiente de produção subia com um super_admin de senha publicamente
 * conhecida e sem obrigação de troca. Agora:
 *
 *   - Em produção (NODE_ENV=production) a env SEED_ADMIN_PASSWORD é
 *     OBRIGATÓRIA. Sem ela (ou repetindo a senha padrão histórica) o seed FALHA
 *     com exit != 0 — o start do container aborta em vez de nascer vulnerável.
 *   - O super_admin criado em produção nasce com `mustChangePassword: true`,
 *     forçando a troca no primeiro login (mesmo que a senha da env vaze no
 *     painel de deploy, ela só serve uma vez).
 *   - Em desenvolvimento o comportamento antigo é mantido (senha padrão, sem
 *     troca obrigatória) para não atrapalhar o dia a dia / testes locais.
 *
 * E-mail continua vindo de SEED_ADMIN_EMAIL (com default).
 * Roda automaticamente no start do container (Dockerfile) e via `npm run seed:admin`.
 */

const { User } = require('../src/models');
const { hashPassword } = require('../src/utils/password');

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// Senha histórica do repositório: nunca pode valer em produção, nem mesmo se
// alguém a repassar explicitamente via env (seria exatamente o mesmo buraco).
const LEGACY_DEFAULT_PASSWORD = 'eternizagestao';

// Tamanho mínimo exigido da senha do super_admin em produção.
const MIN_PASSWORD_LENGTH = 12;

const EMAIL = (process.env.SEED_ADMIN_EMAIL || 'eternizagestaoadmin@gmail.com').trim().toLowerCase();
const RAW_PASSWORD = process.env.SEED_ADMIN_PASSWORD;

/**
 * Resolve a senha do seed conforme o ambiente. Lança (com mensagem acionável)
 * quando produção está mal configurada — melhor o deploy falhar ruidosamente do
 * que subir uma API com super_admin de senha conhecida.
 */
function resolvePassword() {
  // Desenvolvimento/teste: mantém o comportamento tolerante de sempre.
  if (!IS_PRODUCTION) return RAW_PASSWORD || LEGACY_DEFAULT_PASSWORD;

  if (!RAW_PASSWORD || !RAW_PASSWORD.trim()) {
    throw new Error(
      'SEED_ADMIN_PASSWORD é OBRIGATÓRIA em produção. Defina uma senha forte '
      + `(mínimo ${MIN_PASSWORD_LENGTH} caracteres) nas variáveis de ambiente do `
      + 'serviço e refaça o deploy. O super_admin nascerá exigindo troca no 1º login.'
    );
  }
  if (RAW_PASSWORD === LEGACY_DEFAULT_PASSWORD) {
    throw new Error(
      'SEED_ADMIN_PASSWORD está usando a senha padrão pública do repositório. '
      + 'Escolha outra — essa é conhecida por qualquer um com acesso ao código.'
    );
  }
  if (RAW_PASSWORD.length < MIN_PASSWORD_LENGTH) {
    throw new Error(
      `SEED_ADMIN_PASSWORD muito curta: use no mínimo ${MIN_PASSWORD_LENGTH} caracteres.`
    );
  }
  return RAW_PASSWORD;
}

(async () => {
  const password = resolvePassword();
  const passwordHash = await hashPassword(password);

  const [, created] = await User.findOrCreate({
    where: { email: EMAIL, tenantId: null },
    defaults: {
      name: 'Administrador',
      role: 'super_admin',
      passwordHash,
      active: true,
      // Em produção a senha vem de env (visível no painel de deploy) e precisa
      // ser descartada no 1º acesso. Em dev não incomodamos o desenvolvedor.
      mustChangePassword: IS_PRODUCTION,
    },
    skipAudit: true,
  });

  console.log(
    created
      ? `[seed-admin] super_admin criado: ${EMAIL}`
        + (IS_PRODUCTION ? ' (troca de senha obrigatória no primeiro login)' : '')
      : `[seed-admin] super_admin já existe: ${EMAIL} (nada alterado)`
  );
  process.exit(0);
})().catch((err) => {
  console.error('[seed-admin] erro:', err.message);
  process.exit(1);
});
