'use strict';

/**
 * RECUPERAÇÃO DE SENHA por código de 6 dígitos — painel administrativo (User)
 * e Portal da Família (FamilyPortalAccount).
 *
 * Fluxo (3 passos, sem sessão):
 *   1. request  — gera o código, guarda o HASH e envia por e-mail;
 *   2. verify   — confere o código (não consome) só para a UI liberar a tela
 *                 de nova senha;
 *   3. confirm  — confere de novo e TROCA a senha, consumindo o código.
 *
 * Decisões de segurança (o porquê):
 *  - Código gerado com `crypto.randomInt` (CSPRNG, distribuição uniforme).
 *    `Math.random` é previsível e não entra em nada que proteja conta.
 *  - Só o HASH bcrypt do código vai ao banco (mesmo hashing das senhas): um
 *    dump do banco não entrega códigos válidos nem permite força bruta barata.
 *  - Validade de 10 minutos + no máximo 5 tentativas: reduz a janela e mata a
 *    varredura das 10^6 combinações (o rate limit por IP é a segunda camada).
 *  - `request` SEMPRE responde igual (202), exista ou não o e-mail: a resposta
 *    não pode ser um oráculo de "quem tem cadastro" (enumeração de usuários).
 *  - `verify`/`confirm` devolvem a MESMA mensagem genérica para código errado,
 *    expirado ou e-mail inexistente — pelo mesmo motivo.
 *  - Um pedido novo invalida os códigos anteriores do mesmo e-mail: só um
 *    código vive por vez, então reenviar não multiplica segredos válidos.
 *  - O código NUNCA é retornado pela API, logado ou gravado em auditoria.
 */

const crypto = require('crypto');
const { Op } = require('sequelize');
const AppError = require('../../utils/app-error');
const { hashPassword, comparePassword } = require('../../utils/password');
const { renderEmail } = require('../../emails/render');
const { PasswordReset, User, FamilyPortalAccount, Person, Tenant } = require('../../models');
const audit = require('../audit-logs/audit.service');

const ORIGINS = ['admin', 'portal'];
const CODE_TTL_MS = 10 * 60 * 1000; // 10 minutos
const MAX_ATTEMPTS = 5;
const MIN_PASSWORD_LEN = 8;
const VALIDADE_LABEL = '10 minutos';

// Mensagem única para TODA falha de código (errado/expirado/inexistente).
// Diferenciar aqui seria um oráculo para quem está adivinhando.
const GENERIC_INVALID = 'Código inválido ou expirado. Solicite um novo código.';

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

// Provider de e-mail com require PREGUIÇOSO: o módulo é compartilhado e não
// deve derrubar o carregamento desta feature se estiver indisponível.
function emailProvider() {
  // eslint-disable-next-line global-require
  return require('../../providers/email');
}

// Config de integrações POR CIDADE (SMTP próprio do tenant). Best-effort:
// sem tenant/sem config, o provider decide (Resend da plataforma ou recusa).
async function tenantSmtpFor(tenantId) {
  if (!tenantId) return null;
  try {
    // eslint-disable-next-line global-require
    const { getIntegrationConfig } = require('../tenants/integration-config');
    const config = await getIntegrationConfig(tenantId);
    return config ? config.smtp : null;
  } catch (_err) {
    return null;
  }
}

/**
 * Código de 6 dígitos com CSPRNG. `randomInt` é uniforme no intervalo (sem o
 * viés de módulo de `randomBytes % 10`), e o padStart preserva zeros à esquerda
 * — '007321' é tão válido quanto qualquer outro.
 */
function generateCode() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

// Um código só vale enquanto não foi usado, não foi invalidado e não expirou.
function isUsable(reset) {
  return Boolean(reset && !reset.usedAt && !reset.invalidatedAt && reset.expiresAt > new Date());
}

/**
 * Resolve o DESTINATÁRIO conforme a origem.
 *  - admin  → usuário administrativo (users). Contas inativas não recebem
 *             código: reativar acesso é ato administrativo, não self-service.
 *  - portal → conta do Portal da Família (family_portal_accounts) já ATIVA.
 *             Conta 'pendente_ativacao' segue pelo fluxo de ativação (ela ainda
 *             não tem senha) e 'bloqueado' não se auto-desbloqueia.
 * O tenant é usado como filtro quando o request chegou por um subdomínio de
 * cidade; sem tenant resolvido, busca global (ex.: super_admin no domínio raiz).
 */
async function resolveTarget(origin, email, tenantId) {
  if (origin === 'admin') {
    const where = { email, active: true };
    if (tenantId) where.tenantId = tenantId;
    const user = await User.findOne({ where, order: [['createdAt', 'DESC']] });
    if (!user) return null;
    return { id: user.id, tenantId: user.tenantId, name: user.name, email: user.email, record: user };
  }

  const where = { email, status: 'ativo' };
  if (tenantId) where.tenantId = tenantId;
  const account = await FamilyPortalAccount.findOne({
    where,
    include: [{ model: Person, as: 'person', attributes: ['id', 'fullName'] }],
    order: [['createdAt', 'DESC']],
  });
  if (!account) return null;
  return {
    id: account.id,
    tenantId: account.tenantId,
    name: account.person ? account.person.fullName : '',
    email: account.email,
    record: account,
  };
}

// Invalida TODOS os códigos ainda vivos do e-mail (qualquer origem): um pedido
// novo aposenta os anteriores e a confirmação aposenta o que sobrou.
async function invalidatePrevious(email, exceptId = null) {
  const where = { email, usedAt: null, invalidatedAt: null };
  if (exceptId) where.id = { [Op.ne]: exceptId };
  await PasswordReset.update(
    { invalidatedAt: new Date() },
    { where, skipAudit: true } // ato interno de segurança — auditamos a ação semântica
  );
}

// Envia o e-mail com o código. Traduz a recusa do provider ("e-mail da
// plataforma não configurado") em 503 com código estável — nunca fingimos
// sucesso: o usuário precisa saber que o código NÃO foi entregue.
async function sendCodeEmail({ tenant, tenantId, origin, to, name, code }) {
  const destino = origin === 'portal' ? 'no Portal da Família' : 'no painel de gestão';
  const { subject, html, text } = renderEmail(
    'password-reset-code',
    {
      nome: name || 'você',
      email: to,
      codigo: code,
      validade: VALIDADE_LABEL,
      destino,
    },
    { tenant }
  );

  const smtp = await tenantSmtpFor(tenantId);
  try {
    return await emailProvider().sendEmail(smtp, { to, subject, html, text });
  } catch (err) {
    if (err && err.code === 'EMAIL_NOT_CONFIGURED') {
      throw new AppError(
        'Não é possível enviar o código: o e-mail da plataforma não está configurado.',
        503,
        'EMAIL_NOT_CONFIGURED'
      );
    }
    console.error('[password-resets] falha no envio do código:', err && err.message);
    throw new AppError(
      'Não foi possível enviar o código de recuperação. Tente novamente em instantes.',
      503,
      'EMAIL_SEND_FAILED'
    );
  }
}

/* =========================================================================
 * 1) SOLICITAR CÓDIGO — responde 202 sempre (anti-enumeração)
 * ========================================================================= */
async function request({ email, origin, tenant = null, ip = null } = {}) {
  const normalizedEmail = normalizeEmail(email);
  if (!ORIGINS.includes(origin)) {
    throw AppError.badRequest(`Origem inválida. Permitidas: ${ORIGINS.join(', ')}`, 'INVALID_ORIGIN');
  }
  if (!normalizedEmail || !normalizedEmail.includes('@')) {
    throw AppError.badRequest('E-mail inválido.', 'INVALID_EMAIL');
  }

  const tenantId = tenant ? tenant.id : null;

  // Checagem de CONFIGURAÇÃO antes da busca do cadastro — e não depois do envio.
  // Se deixássemos o 503 sair só quando há alguém para notificar, a diferença
  // entre 503 (existe) e 202 (não existe) viraria um oráculo de enumeração:
  // bastaria testar e-mails para descobrir quem tem conta. Verificando antes, a
  // resposta é a mesma para todo mundo enquanto o e-mail não estiver configurado.
  const smtpConfig = await tenantSmtpFor(tenantId);
  if (!emailProvider().isConfigured(smtpConfig)) {
    throw new AppError(
      'Não é possível enviar o código: o e-mail da plataforma não está configurado.',
      503,
      'EMAIL_NOT_CONFIGURED'
    );
  }

  const target = await resolveTarget(origin, normalizedEmail, tenantId);

  // E-mail sem cadastro: nada é criado nem enviado, mas a resposta é IDÊNTICA
  // à do caminho feliz — o cliente não consegue distinguir os dois casos.
  if (!target) {
    audit.record({
      action: audit.ACTIONS.EDICAO,
      entityType: 'Recuperação de Senha',
      description: `Código de recuperação solicitado para e-mail sem cadastro (${origin}).`,
      tenantId,
    });
    return { accepted: true };
  }

  // Um código por vez.
  await invalidatePrevious(normalizedEmail);

  const code = generateCode();
  const reset = await PasswordReset.create(
    {
      tenantId: target.tenantId || tenantId,
      origin,
      email: normalizedEmail,
      targetId: target.id,
      codeHash: await hashPassword(code), // só o hash — o código cru some da memória
      expiresAt: new Date(Date.now() + CODE_TTL_MS),
      requestIp: ip,
    },
    { skipAudit: true } // o hook gravaria a linha inteira; auditamos sem o segredo
  );

  // Branding do e-mail (cor/logo da cidade). Best-effort: nunca derruba o envio.
  let brandingTenant = tenant;
  if (!brandingTenant && target.tenantId) {
    brandingTenant = await Tenant.findByPk(target.tenantId).catch(() => null);
  }

  try {
    await sendCodeEmail({
      tenant: brandingTenant,
      tenantId: target.tenantId || tenantId,
      origin,
      to: normalizedEmail,
      name: target.name,
      code,
    });
  } catch (err) {
    // Não entregou → o código não pode ficar vivo esperando alguém adivinhar.
    await reset.update({ invalidatedAt: new Date() }, { skipAudit: true }).catch(() => {});
    throw err;
  }

  audit.record({
    action: audit.ACTIONS.EDICAO,
    entityType: 'Recuperação de Senha',
    entityId: reset.id,
    description: `Código de recuperação de senha enviado para ${normalizedEmail} (${origin}).`,
    tenantId: target.tenantId || tenantId,
  });

  return { accepted: true };
}

/**
 * Busca o código VIVO do e-mail e confere o valor apresentado.
 * Toda falha vira o mesmo 400 genérico; tentativa errada incrementa o contador
 * e, ao chegar em MAX_ATTEMPTS, o código morre (não adianta continuar tentando).
 */
async function findAndCheck(email, code) {
  const normalizedEmail = normalizeEmail(email);
  const digits = String(code || '').trim();

  const reset = await PasswordReset.scope('withCode').findOne({
    where: { email: normalizedEmail, usedAt: null, invalidatedAt: null },
    order: [['createdAt', 'DESC']],
  });

  if (!reset) throw AppError.badRequest(GENERIC_INVALID, 'INVALID_CODE');

  // Expirado: invalida para não ficar sendo consultado e responde genérico.
  if (reset.expiresAt <= new Date()) {
    await reset.update({ invalidatedAt: new Date() }, { skipAudit: true });
    throw AppError.badRequest(GENERIC_INVALID, 'INVALID_CODE');
  }

  // Trava ANTES de comparar: um código que já esgotou tentativas nunca mais
  // deve ser comparado, mesmo que o valor certo apareça depois.
  if (reset.attempts >= MAX_ATTEMPTS) {
    await reset.update({ invalidatedAt: new Date() }, { skipAudit: true });
    throw AppError.badRequest(
      'Número máximo de tentativas excedido. Solicite um novo código.',
      'TOO_MANY_ATTEMPTS'
    );
  }

  const matches = await comparePassword(digits, reset.codeHash);
  if (!matches) {
    const attempts = reset.attempts + 1;
    const patch = { attempts };
    if (attempts >= MAX_ATTEMPTS) patch.invalidatedAt = new Date(); // queimou o código
    await reset.update(patch, { skipAudit: true });
    if (attempts >= MAX_ATTEMPTS) {
      throw AppError.badRequest(
        'Número máximo de tentativas excedido. Solicite um novo código.',
        'TOO_MANY_ATTEMPTS'
      );
    }
    throw AppError.badRequest(GENERIC_INVALID, 'INVALID_CODE');
  }

  return reset;
}

/* =========================================================================
 * 2) VERIFICAR CÓDIGO — não consome (o consumo é no confirm)
 * ========================================================================= */
async function verify({ email, code } = {}) {
  await findAndCheck(email, code);
  return { valid: true };
}

/* =========================================================================
 * 3) CONFIRMAR — troca a senha e queima o código
 * ========================================================================= */
async function confirm({ email, code, password } = {}) {
  if (!password || String(password).length < MIN_PASSWORD_LEN) {
    throw AppError.badRequest(
      `Senha deve ter no mínimo ${MIN_PASSWORD_LEN} caracteres.`,
      'WEAK_PASSWORD'
    );
  }

  // Revalida o código no confirm: o verify é só conveniência de UI e não
  // autoriza nada por si só (um cliente poderia pular direto para cá).
  const reset = await findAndCheck(email, code);

  const target = await resolveTarget(reset.origin, reset.email, reset.tenantId);
  // Alvo sumiu/foi desativado entre o pedido e a confirmação: nada a trocar.
  if (!target) {
    await reset.update({ invalidatedAt: new Date() }, { skipAudit: true });
    throw AppError.badRequest(GENERIC_INVALID, 'INVALID_CODE');
  }

  // Mesmo hashing do login (bcrypt via utils/password) — senha trocada aqui
  // funciona nos dois fluxos sem nenhuma conversão.
  const passwordHash = await hashPassword(String(password));
  if (reset.origin === 'admin') {
    // mustChangePassword cai: o dono acabou de definir a senha dele mesmo.
    await target.record.update({ passwordHash, mustChangePassword: false });
  } else {
    await target.record.update({ passwordHash });
  }

  await reset.update({ usedAt: new Date() }, { skipAudit: true });
  await invalidatePrevious(reset.email, reset.id);

  audit.record({
    action: audit.ACTIONS.EDICAO,
    entityType: 'Recuperação de Senha',
    entityId: reset.id,
    description: `Senha redefinida por código de recuperação (${reset.origin}) para ${reset.email}.`,
    tenantId: reset.tenantId,
    userId: reset.origin === 'admin' ? target.id : null,
    portalAccountId: reset.origin === 'portal' ? target.id : null,
  });

  return { updated: true };
}

module.exports = { request, verify, confirm, MAX_ATTEMPTS, CODE_TTL_MS };
