'use strict';

/**
 * Provider de storage de arquivos (fotos, ortofotos, PDFs, anexos).
 * Driver selecionado por STORAGE_DRIVER (default: 'local').
 * Para S3/GCS: criar novo driver com a MESMA interface e registrar no mapa.
 *
 * Interface: saveFile({ tenantId, fileName, contentBase64|content, mimeType }) => { fileUrl, sizeBytes, storagePath }
 *            deleteFile(storagePath) => void
 *
 * SEGURANÇA (LGPD): os arquivos NÃO são mais servidos como estático aberto.
 * A rota de leitura (app.js) exige uma URL ASSINADA (HMAC token+exp) ou sessão
 * autenticada cujo tenant case com o prefixo <tenantId>/ do caminho. Use
 * `signedUrl(fileUrl, { ttlSeconds })` ao expor um fileUrl para o cliente.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const LOCAL_DIR = path.resolve(process.env.STORAGE_LOCAL_DIR || 'uploads');

/**
 * Diagnóstico do armazenamento, avaliado no boot.
 *
 * Existe porque a falha mais cara aqui é SILENCIOSA: se a API grava num caminho
 * que não é o volume persistente, tudo funciona — até o próximo deploy, quando
 * ortofotos, fotos e PDFs somem e voltam 404. Nada no sistema denuncia isso.
 * Agora o log do boot diz onde os arquivos vão parar e se aquilo sobrevive a um
 * restart, para a conferência ser uma linha de log em vez de investigação.
 */
function describeStorage() {
  const usandoPadrao = !process.env.STORAGE_LOCAL_DIR;
  let gravavel = false;
  try {
    fs.mkdirSync(LOCAL_DIR, { recursive: true });
    const teste = path.join(LOCAL_DIR, '.write-test');
    fs.writeFileSync(teste, 'ok');
    fs.unlinkSync(teste);
    gravavel = true;
  } catch {
    gravavel = false;
  }
  return { dir: LOCAL_DIR, usandoPadrao, gravavel };
}

function logStorageDiagnostics() {
  const d = describeStorage();
  console.log(`[storage] arquivos em: ${d.dir} (gravável: ${d.gravavel ? 'sim' : 'NÃO'})`);
  if (d.usandoPadrao) {
    console.warn(
      '[storage] ATENÇÃO: STORAGE_LOCAL_DIR não definida — usando o caminho padrão '
      + 'dentro do container. Se este caminho NÃO for um volume persistente, todos os '
      + 'arquivos (ortofotos, fotos, PDFs) serão PERDIDOS no próximo deploy. '
      + 'No EasyPanel: defina STORAGE_LOCAL_DIR=/app/storage e monte um volume nesse caminho.'
    );
  }
  if (!d.gravavel) {
    console.error(`[storage] ERRO: sem permissão de escrita em ${d.dir} — uploads vão falhar.`);
  }
}
const PUBLIC_PREFIX = '/files'; // prefixo da rota autenticada de leitura (app.js)

// Segredo do HMAC das URLs assinadas. Em produção cai no JWT_SECRET (obrigatório
// lá), garantindo um segredo real; em dev, um fallback estável.
const FILES_URL_SECRET =
  process.env.FILES_URL_SECRET ||
  process.env.JWT_SECRET ||
  'dev-files-url-secret-trocar-em-producao';

// TTL padrão das URLs assinadas devolvidas ao painel (segundos).
const DEFAULT_TTL_SECONDS = Number(process.env.FILES_URL_TTL_SECONDS || 3600);

const localDriver = {
  async saveFile({ tenantId, fileName, contentBase64, content, mimeType }) {
    const buffer = content || Buffer.from(contentBase64 || '', 'base64');
    const safeName = `${crypto.randomUUID()}-${String(fileName).replace(/[^\w.\-]/g, '_')}`;
    const relDir = tenantId ? String(tenantId) : 'shared';
    const dir = path.join(LOCAL_DIR, relDir);
    fs.mkdirSync(dir, { recursive: true });
    const storagePath = path.join(relDir, safeName);
    fs.writeFileSync(path.join(LOCAL_DIR, storagePath), buffer);
    return {
      fileUrl: `${PUBLIC_PREFIX}/${relDir}/${safeName}`,
      sizeBytes: buffer.length,
      storagePath,
      mimeType: mimeType || 'application/octet-stream',
    };
  },

  async deleteFile(storagePath) {
    const full = path.join(LOCAL_DIR, storagePath);
    if (full.startsWith(LOCAL_DIR) && fs.existsSync(full)) fs.unlinkSync(full);
  },
};

const drivers = { local: localDriver };

const driverName = process.env.STORAGE_DRIVER || 'local';
const driver = drivers[driverName];
if (!driver) throw new Error(`STORAGE_DRIVER desconhecido: ${driverName}`);

/* ============================ URLs assinadas ============================ */

// Reduz um fileUrl (/files/<tenant>/<arquivo>) ao caminho relativo (<tenant>/<arquivo>).
function relFromFileUrl(fileUrl) {
  let p = String(fileUrl || '');
  if (p.startsWith(`${PUBLIC_PREFIX}/`)) p = p.slice(PUBLIC_PREFIX.length + 1);
  else if (p.startsWith(PUBLIC_PREFIX)) p = p.slice(PUBLIC_PREFIX.length);
  return p.replace(/^\/+/, '');
}

// HMAC do par (relPath, exp) — assinar o exp junto impede adulterar a validade.
function sign(relPath, exp) {
  return crypto
    .createHmac('sha256', FILES_URL_SECRET)
    .update(`${relPath}:${exp}`)
    .digest('hex');
}

/**
 * Devolve uma URL ASSINADA para um fileUrl local: /files/<path>?token=<hmac>&exp=<ts>.
 * URLs externas (http/https/data:) e valores vazios são devolvidos intactos.
 */
function signedUrl(fileUrl, { ttlSeconds = DEFAULT_TTL_SECONDS } = {}) {
  if (!fileUrl) return fileUrl;
  if (/^(https?:)?\/\//i.test(fileUrl) || String(fileUrl).startsWith('data:')) return fileUrl;
  const rel = relFromFileUrl(fileUrl);
  if (!rel) return fileUrl;
  const exp = Math.floor(Date.now() / 1000) + Math.max(1, Math.floor(ttlSeconds));
  const token = sign(rel, exp);
  return `${PUBLIC_PREFIX}/${rel}?token=${token}&exp=${exp}`;
}

/**
 * Valida um token+exp para um caminho relativo. Retorna true só se o token casa
 * (comparação em tempo constante) e não expirou.
 */
function verifySignedUrl(relPath, token, exp) {
  const expNum = Number(exp);
  if (!token || !Number.isFinite(expNum) || expNum <= 0) return false;
  if (expNum < Math.floor(Date.now() / 1000)) return false; // expirado
  const expected = sign(String(relPath || ''), expNum);
  const a = Buffer.from(String(token));
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/* ============================ Leitura local ============================ */

// Resolve o caminho físico de um fileUrl local, barrando path traversal.
function localPathFromUrl(fileUrl) {
  const rel = relFromFileUrl(fileUrl);
  if (!rel) return null;
  const full = path.resolve(LOCAL_DIR, rel);
  if (full !== LOCAL_DIR && !full.startsWith(LOCAL_DIR + path.sep)) return null;
  return full;
}

/**
 * Lê o conteúdo de um arquivo LOCAL a partir do seu fileUrl (/files/...).
 * Devolve Buffer, ou null se for URL externa/inexistente. Usado para embutir a
 * logo do órgão no HTML do documento (data URI), tornando-o auto-contido.
 */
function readLocalFile(fileUrl) {
  if (!fileUrl || /^(https?:)?\/\//i.test(fileUrl) || String(fileUrl).startsWith('data:')) return null;
  const full = localPathFromUrl(fileUrl);
  if (!full || !fs.existsSync(full) || !fs.statSync(full).isFile()) return null;
  try {
    return fs.readFileSync(full);
  } catch {
    return null;
  }
}

module.exports = {
  describeStorage,
  logStorageDiagnostics,
  ...driver,
  LOCAL_DIR,
  PUBLIC_PREFIX,
  DEFAULT_TTL_SECONDS,
  signedUrl,
  verifySignedUrl,
  readLocalFile,
  localPathFromUrl,
};
