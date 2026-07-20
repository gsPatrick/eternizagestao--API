'use strict';

const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const ROUNDS = 10;

async function hashPassword(plain) {
  return bcrypt.hash(plain, ROUNDS);
}

async function comparePassword(plain, hash) {
  if (!hash) return false;
  return bcrypt.compare(plain, hash);
}

// Token aleatório para ativação/reset (não é JWT — uso único, guardado no banco)
function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

// Senha TEMPORÁRIA legível (convite): sem caracteres ambíguos (0/O, 1/l/I),
// 10 chars com dígitos — fácil de ler/digitar. O convidado troca no 1º acesso.
function generateTempPassword(len = 10) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i += 1) out += chars[bytes[i] % chars.length];
  return out;
}

module.exports = { hashPassword, comparePassword, randomToken, generateTempPassword };
