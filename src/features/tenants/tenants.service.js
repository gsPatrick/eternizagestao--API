'use strict';

const crypto = require('crypto');
const AppError = require('../../utils/app-error');
const { getPagination, buildPageMeta } = require('../../utils/pagination');
const { hashPassword, generateTempPassword } = require('../../utils/password');
const { encryptSecret } = require('../../utils/secret-crypto');
const { panelLoginUrl } = require('../../utils/tenant-url');
const { sequelize, Tenant, User } = require('../../models');
const notifications = require('../notifications/notifications.service');
const storage = require('../../providers/storage');

// Logo do tenant: formatos aceitos e teto de tamanho (upload é imagem de marca).
const LOGO_MIME_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/svg+xml'];
const LOGO_MAX_BYTES = 3 * 1024 * 1024; // 3 MB

// Imagens da página pública (hero/rodapé): fotos grandes, sem SVG, teto maior.
const PUBLIC_IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
const PUBLIC_IMAGE_MAX_BYTES = 12 * 1024 * 1024; // 12 MB
const PUBLIC_IMAGE_FIELDS = { hero: 'heroImageUrl', footer: 'footerImageUrl' };

// TTL longo (7 dias) para a URL assinada da logo devolvida ao front: é branding
// exibido via <img>; o painel recarrega antes de expirar. URLs externas (http da
// cidade) passam intactas por signedUrl.
const LOGO_URL_TTL_SECONDS = Number(process.env.LOGO_URL_TTL_SECONDS || 7 * 24 * 3600);

// Assina o logoUrl LOCAL (/files/...) para exibição no front; externo passa intacto.
function signLogo(logoUrl) {
  return logoUrl ? storage.signedUrl(logoUrl, { ttlSeconds: LOGO_URL_TTL_SECONDS }) : logoUrl;
}

const EDITABLE_FIELDS = [
  'name', 'legalName', 'cnpj', 'logoUrl', 'primaryColor', 'secondaryColor',
  'email', 'phone', 'whatsapp', 'addressStreet', 'addressNumber', 'addressComplement',
  'addressDistrict', 'addressCity', 'addressState', 'addressZipcode',
  'documentHeader', 'settings', 'active',
];

// Marca/config que o super_admin pode gravar já na criação (modo 'completo').
// 'active' e 'onboardingStatus' são controlados pelo fluxo, não vêm do input aqui.
const TENANT_CONFIG_FIELDS = EDITABLE_FIELDS.filter((f) => f !== 'active');

// Campos que o ADMIN da cidade preenche no onboarding delegado (marca + órgão
// gestor + contato/endereço). NÃO inclui subdomínio (imutável) nem active.
const ONBOARDING_FIELDS = [
  'legalName', 'cnpj', 'logoUrl', 'heroImageUrl', 'footerImageUrl',
  'primaryColor', 'secondaryColor',
  'email', 'phone', 'whatsapp', 'addressStreet', 'addressNumber', 'addressComplement',
  'addressDistrict', 'addressCity', 'addressState', 'addressZipcode',
  'documentHeader',
];

const MODES = ['completo', 'delegado'];
const ROLE_LABELS = { admin: 'Administrador', operador: 'Operador', consulta: 'Consulta' };

// Domínio base p/ EXIBIR o domínio da cidade (<sub>.<BASE_DOMAIN>). Só saída —
// a entrada resolve o tenant pelo subdomínio, ignorando o domínio raiz.
// Trocável por env BASE_DOMAIN. DNS wildcard + TLS é INFRAESTRUTURA.
const BASE_DOMAIN = process.env.BASE_DOMAIN || 'eternizagestao.com.br';

function computeDomain(subdomain) {
  return `${subdomain}.${BASE_DOMAIN}`;
}

// Normaliza e valida o subdomínio: minúsculas, [a-z0-9-], 2..63 chars.
function normalizeSubdomain(raw) {
  const subdomain = String(raw || '').toLowerCase().trim();
  if (!/^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/.test(subdomain)) {
    throw AppError.badRequest(
      'Subdomínio inválido (use letras minúsculas, números e hífens; 2 a 63 caracteres).',
      'INVALID_SUBDOMAIN'
    );
  }
  return subdomain;
}

// Serializa o tenant SEM dados sensíveis + domínio computado + status.
function serialize(tenant) {
  if (!tenant) return null;
  const t = typeof tenant.toJSON === 'function' ? tenant.toJSON() : tenant;
  return {
    id: t.id,
    name: t.name,
    legalName: t.legalName,
    cnpj: t.cnpj,
    subdomain: t.subdomain,
    domain: computeDomain(t.subdomain),
    logoUrl: signLogo(t.logoUrl),
    // imagens da página pública da cidade (assinadas p/ exibição no painel)
    heroImageUrl: signLogo(t.heroImageUrl),
    footerImageUrl: signLogo(t.footerImageUrl),
    primaryColor: t.primaryColor,
    secondaryColor: t.secondaryColor,
    email: t.email,
    phone: t.phone,
    whatsapp: t.whatsapp,
    addressStreet: t.addressStreet,
    addressNumber: t.addressNumber,
    addressComplement: t.addressComplement,
    addressDistrict: t.addressDistrict,
    addressState: t.addressState,
    addressCity: t.addressCity,
    addressZipcode: t.addressZipcode,
    documentHeader: t.documentHeader,
    settings: t.settings,
    active: t.active,
    onboardingStatus: t.onboardingStatus,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}

function serializeAdmin(user) {
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}

// Enfileira (via camada de filas/notifications) o e-mail de convite ao primeiro
// admin da cidade — reutiliza o template 'user-invite' já usado no convite de
// usuários da equipe. Nunca lança pro fluxo (best-effort é responsabilidade do
// chamador); aqui só monta e chama notify.
async function sendAdminInvite(tenant, user, actor = {}, tempPassword = null) {
  await notifications.notify({
    tenantId: tenant.id,
    // Disparo da PLATAFORMA (super_admin criando a cidade) → marca AZUL (Eterniza)
    // + remetente da plataforma (Resend), NÃO a cor da cidade.
    platform: true,
    recipientUserId: user.id,
    contact: user.email,
    channel: 'email',
    notificationType: 'avulsa',
    subject: 'Convite de acesso ao Eterniza Gestão',
    message: `Convite enviado para ${user.email}.`,
    template: 'user-invite',
    vars: {
      nome: user.name,
      perfil: ROLE_LABELS[user.role] || user.role,
      convidado_por: actor.name || 'a plataforma Eterniza',
      // credenciais do 1º acesso (o admin troca a senha ao entrar)
      email: user.email,
      senha_temporaria: tempPassword || '',
      // Link branded da cidade (deriva do subdomínio; fallback env global).
      cta_url: panelLoginUrl(tenant),
    },
    referenceType: 'user',
    referenceId: user.id,
  });
}

async function list(query) {
  const { page, perPage, limit, offset } = getPagination(query);
  const { rows, count } = await Tenant.findAndCountAll({
    limit,
    offset,
    order: [['name', 'ASC']],
  });
  return { rows: rows.map(serialize), meta: buildPageMeta(count, page, perPage) };
}

async function getById(id) {
  const tenant = await Tenant.findByPk(id);
  if (!tenant) throw AppError.notFound('Tenant não encontrado.');
  return tenant;
}

/**
 * Cria a CIDADE (tenant) + o PRIMEIRO ADMIN, transacional, em 2 modos.
 *
 * @param {object} payload { tenant:{name,subdomain,...marca}, admin:{name,email}, mode }
 * @param {object} actor  usuário super_admin autenticado (para o e-mail de convite)
 * @returns { tenant, admin, domain }
 */
async function create(payload = {}, actor = {}) {
  const { tenant: tenantInput = {}, admin: adminInput = {}, mode = 'completo' } = payload;

  if (!MODES.includes(mode)) {
    throw AppError.badRequest(`Modo inválido. Permitidos: ${MODES.join(', ')}`, 'INVALID_MODE');
  }
  if (!tenantInput.name || !tenantInput.subdomain) {
    throw AppError.badRequest('Informe tenant.name e tenant.subdomain.', 'MISSING_FIELDS');
  }
  if (!adminInput.name || !adminInput.email) {
    throw AppError.badRequest('Informe admin.name e admin.email.', 'MISSING_FIELDS');
  }

  const subdomain = normalizeSubdomain(tenantInput.subdomain);
  const adminEmail = String(adminInput.email).toLowerCase().trim();

  // Pré-checagem amigável: só cidades ATIVAS (não apagadas) bloqueiam o
  // subdomínio. Ao apagar uma cidade, o subdomínio é LIBERADO (ver remove()),
  // então recriar com o mesmo nome/subdomínio funciona. A transação abaixo é a
  // garantia real contra corrida.
  const existing = await Tenant.findOne({ where: { subdomain } });
  if (existing) {
    throw AppError.conflict(
      `Subdomínio '${subdomain}' já está em uso por outra cidade.`,
      'SUBDOMAIN_IN_USE'
    );
  }

  // Monta os dados do tenant conforme o modo.
  const tenantData = { name: tenantInput.name, subdomain, active: true };
  if (mode === 'completo') {
    // super_admin já configura tudo → grava marca/config e conclui o onboarding.
    for (const f of TENANT_CONFIG_FIELDS) {
      if (tenantInput[f] !== undefined) tenantData[f] = tenantInput[f];
    }
    tenantData.name = tenantInput.name; // garante que config não sobrescreva
    tenantData.onboardingStatus = 'concluido';
  } else {
    // delegado → mínimo; o admin da cidade preenche depois.
    tenantData.onboardingStatus = 'pendente';
  }

  // Senha TEMPORÁRIA legível (o admin digita no 1º acesso e troca em seguida).
  const tempPassword = generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);

  let tenant;
  let user;
  try {
    await sequelize.transaction(async (t) => {
      tenant = await Tenant.create(tenantData, { transaction: t });
      user = await User.create(
        {
          tenantId: tenant.id,
          name: adminInput.name,
          email: adminEmail,
          phone: adminInput.phone ?? null,
          passwordHash,
          role: 'admin',
          mustChangePassword: true, // obriga a definir a senha no 1º login
        },
        { transaction: t }
      );
    });
  } catch (err) {
    // Colisão de índice unique (subdomínio) em corrida → 409 amigável.
    if (err.name === 'SequelizeUniqueConstraintError') {
      throw AppError.conflict(
        `Subdomínio '${subdomain}' já está em uso por outra cidade.`,
        'SUBDOMAIN_IN_USE'
      );
    }
    throw err;
  }

  // Após o COMMIT: enfileira o convite ao primeiro admin (best-effort — uma
  // falha de e-mail não desfaz a cidade já criada). Leva a senha temporária.
  try {
    await sendAdminInvite(tenant, user, actor, tempPassword);
  } catch (err) {
    console.error('[tenants] convite ao primeiro admin falhou:', err.message);
  }

  return {
    tenant: serialize(tenant),
    admin: serializeAdmin(user),
    domain: computeDomain(subdomain),
  };
}

async function update(id, data) {
  const tenant = await getById(id);
  // subdomínio é imutável após criação — quebra de URL dos clientes
  return serialize(await tenant.update(data));
}

async function remove(id) {
  const tenant = await getById(id);
  // LIBERA o subdomínio ao apagar. A coluna `subdomain` tem índice unique que
  // inclui linhas soft-deleted (paranoid), então, sem isto, o valor ficaria
  // "preso" e recriar a cidade com o mesmo nome falharia. Renomeamos o
  // subdomínio da cidade removida (sufixo único) para devolver o original ao
  // pool, e desativamos antes do soft delete.
  const freed = `${tenant.subdomain}-del-${Date.now().toString(36)}`.slice(0, 63);
  await tenant.update({ subdomain: freed, active: false });
  await tenant.destroy(); // soft delete (paranoid)
}

// Ativa/desativa a cidade (super_admin). active=false bloqueia login/resolução.
async function setActive(id, active) {
  const tenant = await getById(id);
  await tenant.update({ active: Boolean(active) });
  return serialize(tenant);
}

/**
 * Reenvia o convite ao primeiro admin da cidade (ou a um e-mail informado).
 * Sem e-mail explícito, usa o admin mais antigo do tenant.
 */
async function resendInvite(id, emailOverride, actor = {}) {
  const tenant = await getById(id);

  let user;
  if (emailOverride) {
    const email = String(emailOverride).toLowerCase().trim();
    user = await User.findOne({ where: { tenantId: tenant.id, email }, order: [['createdAt', 'ASC']] });
    if (!user) {
      throw AppError.notFound(`Nenhum usuário '${email}' nesta cidade.`, 'ADMIN_NOT_FOUND');
    }
  } else {
    user = await User.findOne({
      where: { tenantId: tenant.id, role: 'admin' },
      order: [['createdAt', 'ASC']],
    });
    if (!user) {
      throw AppError.notFound('Esta cidade não tem um admin para reconvite.', 'ADMIN_NOT_FOUND');
    }
  }

  // Reconvite REDEFINE a senha para uma nova temporária e reexige a troca no
  // 1º acesso — assim o link do e-mail sempre dá acesso (a senha antiga pode
  // já ter sido trocada/perdida).
  const tempPassword = generateTempPassword();
  await user.update({
    passwordHash: await hashPassword(tempPassword),
    mustChangePassword: true,
  });

  await sendAdminInvite(tenant, user, actor, tempPassword);
  return { tenant: serialize(tenant), admin: serializeAdmin(user), domain: computeDomain(tenant.subdomain) };
}

// ---------------------------------------------------------------------------
// ONBOARDING pelo ADMIN da cidade (isolado ao tenant do token)
// ---------------------------------------------------------------------------

// Status + config atual do tenant do usuário logado.
async function getOnboarding(tenantId) {
  const tenant = await getById(tenantId);
  return serialize(tenant);
}

/**
 * O admin configura o PRÓPRIO tenant (marca, órgão gestor, contato/endereço).
 * Isolado: opera SEMPRE no tenantId do token — nunca aceita id de outro tenant.
 * Por padrão conclui o onboarding; passe { concluir: false } para salvar rascunho.
 */
async function updateOnboarding(tenantId, data = {}) {
  const tenant = await getById(tenantId);

  const patch = {};
  for (const f of ONBOARDING_FIELDS) {
    if (data[f] !== undefined) patch[f] = data[f];
  }
  if (data.name !== undefined && data.name !== null && data.name !== '') {
    patch.name = data.name;
  }

  const finish = data.concluir !== false;
  if (finish) patch.onboardingStatus = 'concluido';

  await tenant.update(patch);
  return serialize(tenant);
}

/**
 * Faz upload da LOGO do tenant do token (isolado). Recebe o arquivo em base64,
 * valida tipo/tamanho, persiste via provider de storage (servido em /files/...)
 * e grava tenant.logoUrl (persistente). Reaproveita a MESMA infra de storage
 * das ortofotos. Retorna { logoUrl }.
 */
async function uploadLogo(tenantId, { contentBase64, fileName, mimeType } = {}) {
  const tenant = await getById(tenantId);

  if (!contentBase64) {
    throw AppError.badRequest('Envie o arquivo da logo (contentBase64).', 'MISSING_FILE');
  }
  const mime = String(mimeType || '').toLowerCase();
  if (!LOGO_MIME_TYPES.includes(mime)) {
    throw AppError.badRequest(
      'Formato inválido. Envie uma imagem PNG, JPEG ou SVG.',
      'INVALID_IMAGE_TYPE'
    );
  }
  const buffer = Buffer.from(contentBase64, 'base64');
  if (!buffer.length) {
    throw AppError.badRequest('Arquivo de logo vazio ou inválido.', 'INVALID_FILE');
  }
  if (buffer.length > LOGO_MAX_BYTES) {
    throw AppError.badRequest('Imagem muito grande. O limite é 3 MB.', 'FILE_TOO_LARGE');
  }

  const saved = await storage.saveFile({
    tenantId,
    fileName: fileName || 'logo.png',
    content: buffer,
    mimeType: mime,
  });

  await tenant.update({ logoUrl: saved.fileUrl });
  // Devolve ASSINADA (TTL longo) — o painel exibe a logo recém-enviada via <img>.
  return { logoUrl: signLogo(saved.fileUrl) };
}

/**
 * Upload de uma IMAGEM DA PÁGINA PÚBLICA da cidade (hero ou rodapé).
 * Cada cidade pode ter a própria arte; sem upload, a landing usa a da plataforma.
 * @param {'hero'|'footer'} kind
 */
async function uploadPublicImage(tenantId, kind, { contentBase64, fileName, mimeType } = {}) {
  const field = PUBLIC_IMAGE_FIELDS[kind];
  if (!field) throw AppError.badRequest("Imagem inválida. Use 'hero' ou 'footer'.", 'INVALID_IMAGE_KIND');

  const tenant = await getById(tenantId);
  if (!contentBase64) {
    throw AppError.badRequest('Envie o arquivo da imagem (contentBase64).', 'MISSING_FILE');
  }
  const mime = String(mimeType || '').toLowerCase();
  if (!PUBLIC_IMAGE_MIME_TYPES.includes(mime)) {
    throw AppError.badRequest('Formato inválido. Envie PNG, JPEG ou WEBP.', 'INVALID_IMAGE_TYPE');
  }
  const buffer = Buffer.from(contentBase64, 'base64');
  if (!buffer.length) throw AppError.badRequest('Arquivo vazio ou inválido.', 'INVALID_FILE');
  if (buffer.length > PUBLIC_IMAGE_MAX_BYTES) {
    throw AppError.badRequest('Imagem muito grande. O limite é 12 MB.', 'FILE_TOO_LARGE');
  }

  const saved = await storage.saveFile({
    tenantId,
    fileName: fileName || `${kind}.jpg`,
    content: buffer,
    mimeType: mime,
  });

  await tenant.update({ [field]: saved.fileUrl });
  return { [field]: signLogo(saved.fileUrl) };
}

// ---------------------------------------------------------------------------
// INTEGRAÇÕES POR CIDADE (isolado ao tenant do token)
// Cada cidade conecta o PRÓPRIO Asaas (financeiro), o PRÓPRIO SMTP (e-mail) e o
// PRÓPRIO WhatsApp (instância Evolution). Nada é compartilhado — tudo mora em
// Tenant.settings.integrations (JSONB), forma:
//   { asaas:   { apiKey, environment },
//     smtp:    { host, port, secure, user, password, fromName, fromEmail },
//     whatsapp:{ instanceName, status } }
//
// FASE 1 = só ARMAZENAMENTO + CONFIG. Os drivers reais (chamadas ao Asaas /
// Evolution / envio SMTP) são a FASE 2. Segredos (asaas.apiKey e smtp.password)
// NUNCA retornam em claro: o GET só devolve status mascarado.
// TODO(produção): criptografar os segredos em repouso (KMS/secret store) antes
// de persistir — hoje ficam em claro no JSONB do tenant.
// ---------------------------------------------------------------------------

const ASAAS_ENVIRONMENTS = ['sandbox', 'producao'];
const WHATSAPP_STATES = ['desconectado', 'conectando', 'conectado'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Mascara um segredo mostrando só os últimos 4 caracteres (nunca o valor claro).
function maskSecret(value) {
  if (!value) return null;
  const s = String(value);
  if (s.length <= 4) return '••••';
  return `••••${s.slice(-4)}`;
}

// Status MASCARADO das integrações do tenant (sem vazar apiKey/senha).
function serializeIntegrations(tenant) {
  const settings = (tenant && tenant.settings) || {};
  const integrations = settings.integrations || {};
  const asaas = integrations.asaas || {};
  const smtp = integrations.smtp || {};
  const whatsapp = integrations.whatsapp || {};
  return {
    financeiro: {
      provider: 'asaas',
      configured: Boolean(asaas.apiKey),
      environment: ASAAS_ENVIRONMENTS.includes(asaas.environment) ? asaas.environment : 'sandbox',
      apiKeyMask: maskSecret(asaas.apiKey),
    },
    email: {
      configured: Boolean(smtp.host && smtp.fromEmail),
      host: smtp.host || '',
      port: Number.isInteger(smtp.port) ? smtp.port : null,
      secure: Boolean(smtp.secure),
      user: smtp.user || '',
      fromName: smtp.fromName || '',
      fromEmail: smtp.fromEmail || '',
      hasPassword: Boolean(smtp.password),
    },
    whatsapp: {
      configured: Boolean(whatsapp.instanceName),
      instanceName: whatsapp.instanceName || '',
      status: WHATSAPP_STATES.includes(whatsapp.status) ? whatsapp.status : 'desconectado',
    },
  };
}

// Clona o settings do tenant e devolve os ninhos mutáveis (settings/integrations)
// para gravação segura do JSONB (novo objeto → Sequelize detecta a mudança).
function cloneIntegrations(tenant) {
  const settings = { ...(tenant.settings || {}) };
  const integrations = { ...(settings.integrations || {}) };
  settings.integrations = integrations;
  return { settings, integrations };
}

// GET: status mascarado das integrações do tenant do token.
async function getIntegrations(tenantId) {
  const tenant = await getById(tenantId);
  return serializeIntegrations(tenant);
}

/**
 * FINANCEIRO (Asaas). apiKey só é gravada se enviada (senão mantém a atual);
 * environment é obrigatório e validado. Retorna o status MASCARADO.
 */
async function updateFinanceiro(tenantId, { apiKey, environment } = {}) {
  const tenant = await getById(tenantId);
  if (!ASAAS_ENVIRONMENTS.includes(environment)) {
    throw AppError.badRequest(
      "Ambiente inválido. Use 'sandbox' ou 'producao'.",
      'INVALID_ENVIRONMENT'
    );
  }
  const { settings, integrations } = cloneIntegrations(tenant);
  const asaas = { ...(integrations.asaas || {}) };
  asaas.environment = environment;
  if (typeof apiKey === 'string' && apiKey.trim()) {
    // segredo cifrado em repouso (AES-256-GCM); leitura em claro só via integration-config
    asaas.apiKey = encryptSecret(apiKey.trim());
  }
  integrations.asaas = asaas;
  await tenant.update({ settings });
  return serializeIntegrations(tenant);
}

/**
 * TESTE DE CONEXÃO do FINANCEIRO (Asaas) — valida a apiKey da PRÓPRIA cidade.
 * Lê a config em claro (integration-config), resolve o driver e chama
 * driver.testConnection. NUNCA lança por credencial inválida: devolve
 * { ok:false, message } amigável (key ruim → não vira 500).
 */
async function testFinanceiro(tenantId) {
  // require lazy: evita ciclo (providers → models) no load do módulo
  const { getIntegrationConfig } = require('./integration-config');
  const { resolveDriver } = require('../../providers/payment-gateway');

  const config = await getIntegrationConfig(tenantId);
  if (!config.asaas.apiKey) {
    return {
      ok: false,
      message: 'Nenhuma chave Asaas configurada. Salve a chave da sua conta antes de testar.',
    };
  }
  const driver = resolveDriver(config.asaas);
  return driver.testConnection(config.asaas);
}

/**
 * E-MAIL (SMTP). password só é gravada se enviada (senão mantém a atual).
 * Valida host, porta (1..65535) e e-mail do remetente. Retorna MASCARADO.
 */
async function updateEmail(tenantId, data = {}) {
  const tenant = await getById(tenantId);
  const { host, port, secure, user, password, fromName, fromEmail } = data;

  if (!host || !String(host).trim()) {
    throw AppError.badRequest('Informe o servidor SMTP (host).', 'MISSING_FIELDS');
  }
  const portNum = Number(port);
  if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
    throw AppError.badRequest('Porta SMTP inválida (use um valor entre 1 e 65535).', 'INVALID_PORT');
  }
  if (fromEmail && !EMAIL_RE.test(String(fromEmail).trim())) {
    throw AppError.badRequest('E-mail do remetente inválido.', 'INVALID_EMAIL');
  }

  const { settings, integrations } = cloneIntegrations(tenant);
  const smtp = { ...(integrations.smtp || {}) };
  smtp.host = String(host).trim();
  smtp.port = portNum;
  smtp.secure = Boolean(secure);
  smtp.user = user ? String(user).trim() : '';
  smtp.fromName = fromName ? String(fromName).trim() : '';
  smtp.fromEmail = fromEmail ? String(fromEmail).trim() : '';
  if (typeof password === 'string' && password) {
    // segredo cifrado em repouso (AES-256-GCM); leitura em claro só via integration-config
    smtp.password = encryptSecret(password);
  }
  integrations.smtp = smtp;
  await tenant.update({ settings });
  return serializeIntegrations(tenant);
}

/**
 * TESTE DE E-MAIL (SMTP) — envia um e-mail de teste pelo SMTP da PRÓPRIA cidade.
 * Lê a config em claro (integration-config), resolve o driver de e-mail e envia
 * para o remetente configurado. NUNCA lança: devolve { ok, message } amigável
 * (SMTP ausente/credencial ruim/host inválido → não vira 500).
 */
async function testEmail(tenantId) {
  // require lazy: evita ciclo (providers/integration-config → models) no load
  const { getIntegrationConfig } = require('./integration-config');
  const emailProvider = require('../../providers/email');

  const config = await getIntegrationConfig(tenantId);
  const smtp = config.smtp;
  if (!smtp.host) {
    return {
      ok: false,
      message: 'Nenhum servidor SMTP configurado. Salve o e-mail (SMTP) da sua cidade antes de testar.',
    };
  }
  const to = smtp.fromEmail || smtp.user;
  if (!to) {
    return {
      ok: false,
      message: 'Configure o e-mail do remetente (ou o usuário SMTP) para receber o e-mail de teste.',
    };
  }

  const driver = emailProvider.resolveDriver(smtp);
  try {
    // valida conexão/credenciais antes de enviar (quando o driver suporta)
    if (typeof driver.verify === 'function') await driver.verify(smtp);
    await emailProvider.sendEmail(smtp, {
      to,
      subject: 'Teste de e-mail · Eterniza Gestão',
      html: '<p>Este é um <strong>e-mail de teste</strong> do Eterniza Gestão.</p>'
        + '<p>Se você recebeu esta mensagem, o servidor SMTP da sua cidade está configurado corretamente.</p>',
      text: 'Este é um e-mail de teste do Eterniza Gestão. Se você recebeu esta mensagem, '
        + 'o servidor SMTP da sua cidade está configurado corretamente.',
    });
    const via = driver.name === 'mock' ? ' (modo demonstração — nenhum envio real)' : '';
    return { ok: true, message: `E-mail de teste enviado para ${to}${via}.` };
  } catch (err) {
    return { ok: false, message: friendlySmtpError(err) };
  }
}

// Traduz erros do nodemailer para mensagens acionáveis (nunca vaza stack).
function friendlySmtpError(err) {
  const code = err && err.code;
  if (code === 'EAUTH') return 'Usuário ou senha do SMTP inválidos. Confira as credenciais.';
  if (code === 'ECONNECTION' || code === 'ESOCKET' || code === 'ETIMEDOUT' || code === 'EDNS') {
    return 'Não foi possível conectar ao servidor SMTP. Confira o host, a porta e o modo seguro (SSL/TLS).';
  }
  return (err && err.message) || 'Falha ao enviar o e-mail de teste.';
}

// ---------------------------------------------------------------------------
// WHATSAPP (instância Evolution POR CIDADE) — conectar/status/desconectar.
// Reusa cloneIntegrations() e persiste em settings.integrations.whatsapp.
// ---------------------------------------------------------------------------

// URL pública do webhook desta instância (Evolution chama de volta a nossa API).
function evolutionWebhookUrl(instanceName) {
  const base = (process.env.APP_PUBLIC_URL || 'http://localhost:3333').replace(/\/+$/, '');
  const prefix = process.env.APP_API_PREFIX || '/api';
  return `${base}${prefix}/v1/webhooks/evolution/${encodeURIComponent(instanceName)}`;
}

// Persiste (merge) o bloco whatsapp em settings.integrations.
async function saveWhatsappSettings(tenant, patch) {
  const { settings, integrations } = cloneIntegrations(tenant);
  integrations.whatsapp = { ...(integrations.whatsapp || {}), ...patch };
  await tenant.update({ settings });
  return integrations.whatsapp;
}

/**
 * CONECTAR: garante a instância da cidade, configura o webhook e devolve o QR
 * (base64) para pareamento. NUNCA lança: erro vira { ok:false, message }.
 */
async function whatsappConnect(tenantId) {
  const whatsapp = require('../../providers/whatsapp');
  const tenant = await getById(tenantId);
  try {
    await whatsapp.ensureInstance(tenant);
    const instanceName = whatsapp.instanceNameFor(tenant);
    // webhook é best-effort (não impede o pareamento)
    await whatsapp.setWebhook(tenant, evolutionWebhookUrl(instanceName));
    const qr = await whatsapp.getQrCode(tenant);
    const status = qr.status || 'conectando';
    await saveWhatsappSettings(tenant, { instanceName, status });
    return {
      ok: true,
      instanceName,
      qrCode: qr.qrCode || null,
      pairingCode: qr.pairingCode || null,
      status,
      mock: Boolean(qr.mock),
      message: qr.message || null,
    };
  } catch (err) {
    return {
      ok: false,
      status: 'desconectado',
      message: err.message || 'Não foi possível iniciar a conexão do WhatsApp. Tente novamente.',
    };
  }
}

/**
 * STATUS: consulta o estado da conexão e ATUALIZA settings. Nunca lança (o
 * driver trata seus próprios erros → 'desconectado').
 */
async function whatsappStatus(tenantId) {
  const whatsapp = require('../../providers/whatsapp');
  const tenant = await getById(tenantId);
  const res = await whatsapp.getStatus(tenant);
  await saveWhatsappSettings(tenant, { instanceName: res.instanceName, status: res.status });
  return { status: res.status, instanceName: res.instanceName, mock: Boolean(res.mock) };
}

/** DESCONECTAR: logout/limpa a instância e marca 'desconectado'. */
async function whatsappDisconnect(tenantId) {
  const whatsapp = require('../../providers/whatsapp');
  const tenant = await getById(tenantId);
  try {
    await whatsapp.logout(tenant);
  } catch (err) {
    console.warn('[tenants] whatsapp logout falhou:', err.message);
  }
  await saveWhatsappSettings(tenant, { status: 'desconectado' });
  return { ok: true, status: 'desconectado' };
}

/**
 * WEBHOOK do Evolution (sem auth). Em `connection.update` atualiza o status do
 * tenant dono da instância; ignora o resto. Valida pelo instanceName conhecido.
 * SEMPRE resolve (o webhook responde 200 para não gerar reentrega infinita).
 */
async function handleEvolutionWebhook(instance, body = {}) {
  const { subdomainFromInstance, mapState } = require('../../providers/whatsapp/shared');
  // normaliza 'CONNECTION_UPDATE' | 'connection.update' → 'connection.update'
  const event = String(body.event || '').toLowerCase().replace(/_/g, '.');
  if (event !== 'connection.update') return { ok: true, ignored: true };

  const state = (body.data && body.data.state) || body.state;
  const status = mapState(state);

  const subdomain = subdomainFromInstance(instance);
  const tenant = await Tenant.findOne({ where: { subdomain } });
  if (!tenant) return { ok: true, ignored: true, reason: 'tenant_desconhecido' };

  // Defesa: só aceita se o instanceName bate com o registrado (quando houver).
  const known = tenant.settings && tenant.settings.integrations
    && tenant.settings.integrations.whatsapp
    && tenant.settings.integrations.whatsapp.instanceName;
  if (known && known !== instance) {
    return { ok: true, ignored: true, reason: 'instancia_divergente' };
  }

  await saveWhatsappSettings(tenant, { instanceName: instance, status });
  return { ok: true, status };
}

// Branding público do tenant do subdomínio (login page, portal público)
function publicProfile(tenant) {
  return {
    id: tenant.id,
    name: tenant.name,
    subdomain: tenant.subdomain,
    domain: computeDomain(tenant.subdomain),
    logoUrl: signLogo(tenant.logoUrl),
    primaryColor: tenant.primaryColor,
    secondaryColor: tenant.secondaryColor,
  };
}

module.exports = {
  list,
  getById,
  create,
  update,
  remove,
  setActive,
  resendInvite,
  getOnboarding,
  updateOnboarding,
  uploadLogo,
  uploadPublicImage,
  getIntegrations,
  updateFinanceiro,
  testFinanceiro,
  updateEmail,
  testEmail,
  whatsappConnect,
  whatsappStatus,
  whatsappDisconnect,
  handleEvolutionWebhook,
  publicProfile,
  serialize,
  computeDomain,
  EDITABLE_FIELDS,
  BASE_DOMAIN,
};
