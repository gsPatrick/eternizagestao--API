'use strict';

/**
 * CRIPTOGRAFIA DE SEGREDOS EM REPOUSO (AES-256-GCM).
 * -----------------------------------------------------------------------------
 * Cifra os SEGREDOS das integrações por cidade (ex.: `asaas.apiKey`,
 * `smtp.password`) antes de persistir no JSONB `Tenant.settings.integrations`,
 * para que nunca fiquem em TEXTO no banco.
 *
 * Formato do valor cifrado (string única, autocontida):
 *     enc:v1:<iv_b64>:<authTag_b64>:<ciphertext_b64>
 *
 *  - `enc:v1:` é o prefixo/rótulo de versão do esquema.
 *  - IV aleatório de 12 bytes (recomendado para GCM), em base64.
 *  - authTag de 16 bytes (integridade/autenticidade), em base64.
 *  - ciphertext em base64.
 *
 * MIGRAÇÃO SUAVE (compat com legado): `decryptSecret` só descriptografa quando o
 * valor começa com `enc:v1:`. Qualquer outro valor (segredo legado gravado em
 * TEXTO) é devolvido inalterado — a leitura nunca quebra. Ao re-salvar via os
 * endpoints, o valor passa a ser cifrado.
 *
 * CHAVE: `process.env.SECRETS_ENC_KEY`, 32 bytes em base64 OU hex.
 *  - Em produção é OBRIGATÓRIA (throw se ausente, mesmo critério do JWT_SECRET).
 *  - Em dev cai num default fixo (apenas para não travar o ambiente local).
 */

const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const PREFIX = 'enc:v1:';
const IV_BYTES = 12; // 96 bits — tamanho recomendado para AES-GCM
const KEY_BYTES = 32; // AES-256

// Default fixo APENAS para dev (32 bytes). Em produção a env é obrigatória.
const DEV_DEFAULT_KEY_B64 = 'ZOSWa6UzlpKO/wsqDdxSsWl+pxV8EZBLIO+XzQwluVg='; // 32 bytes (apenas dev)

/**
 * Resolve a chave de 32 bytes a partir de SECRETS_ENC_KEY (base64 ou hex).
 * Lazy + memoizada: só valida quando o cripto é realmente usado, evitando
 * quebrar o boot de rotas que não tocam em segredos.
 */
let cachedKey = null;
function getKey() {
  if (cachedKey) return cachedKey;

  const raw = process.env.SECRETS_ENC_KEY;
  if (!raw) {
    if (process.env.NODE_ENV === 'production') {
      // decisão de segurança: nunca cifrar segredos com chave default em produção
      throw new Error('SECRETS_ENC_KEY é obrigatória em produção.');
    }
    cachedKey = Buffer.from(DEV_DEFAULT_KEY_B64, 'base64');
    return cachedKey;
  }

  const key = decodeKey(raw);
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `SECRETS_ENC_KEY inválida: esperado 32 bytes (base64 ou hex), obtido ${key.length}.`
    );
  }
  cachedKey = key;
  return cachedKey;
}

// Aceita chave em hex (64 chars hex) ou base64; escolhe o decode que der 32 bytes.
function decodeKey(raw) {
  const s = String(raw).trim();
  if (/^[0-9a-fA-F]{64}$/.test(s)) {
    return Buffer.from(s, 'hex');
  }
  return Buffer.from(s, 'base64');
}

/**
 * Cifra um segredo em texto. Devolve a string autocontida `enc:v1:...`.
 * - `null`/`undefined`/'' são devolvidos como estão (nada a cifrar).
 * - Se o valor JÁ estiver cifrado (`enc:v1:`), é devolvido inalterado
 *   (idempotente — evita dupla cifragem em re-saves).
 * @param {string|null|undefined} plain
 * @returns {string|null|undefined}
 */
function encryptSecret(plain) {
  if (plain == null || plain === '') return plain;
  if (typeof plain !== 'string') plain = String(plain);
  if (isEncrypted(plain)) return plain;

  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return (
    PREFIX
    + iv.toString('base64')
    + ':'
    + authTag.toString('base64')
    + ':'
    + ciphertext.toString('base64')
  );
}

/**
 * Descriptografa um valor.
 * - Se começar com `enc:v1:`, decifra e devolve o texto em claro.
 * - SENÃO devolve o próprio valor (compat com segredos legados em TEXTO).
 * - NUNCA lança para valor legado. Se um valor cifrado estiver corrompido/chave
 *   errada, também não lança — devolve `null` (fail-safe: driver trata como
 *   segredo ausente em vez de derrubar a requisição).
 * @param {string|null|undefined} value
 * @returns {string|null|undefined}
 */
function decryptSecret(value) {
  if (value == null || value === '') return value;
  if (typeof value !== 'string') return value;
  if (!isEncrypted(value)) return value; // legado em texto → passa direto

  try {
    const rest = value.slice(PREFIX.length);
    const parts = rest.split(':');
    if (parts.length !== 3) return null;
    const [ivB64, tagB64, dataB64] = parts;
    const iv = Buffer.from(ivB64, 'base64');
    const authTag = Buffer.from(tagB64, 'base64');
    const ciphertext = Buffer.from(dataB64, 'base64');

    const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
    decipher.setAuthTag(authTag);
    const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plain.toString('utf8');
  } catch (err) {
    // chave errada / valor adulterado → não vaza nem derruba a request
    return null;
  }
}

/** true se o valor está no formato cifrado deste esquema (`enc:v1:`). */
function isEncrypted(value) {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

module.exports = { encryptSecret, decryptSecret, isEncrypted };
