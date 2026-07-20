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

module.exports = { hashPassword, comparePassword, randomToken };
