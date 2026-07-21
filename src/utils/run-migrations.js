'use strict';

const { execFile } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

/**
 * Aplica as migrations PENDENTES no boot da API (mesmo mecanismo do
 * `npm run migrate` — sequelize-cli db:migrate, honrando o .sequelizerc).
 *
 * Idempotente: se não há pendências, o sequelize-cli não faz nada. Resolve com
 * a saída; rejeita em erro (o caller decide se derruba a app ou só loga).
 */
function runMigrations() {
  return new Promise((resolve, reject) => {
    // binário local do sequelize-cli (instalado via npm ci na imagem)
    const bin = path.join(ROOT, 'node_modules', '.bin', 'sequelize-cli');
    const child = execFile(
      bin,
      ['db:migrate'],
      { cwd: ROOT, env: process.env, maxBuffer: 10 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (stdout) process.stdout.write(stdout);
        if (stderr) process.stderr.write(stderr);
        if (err) return reject(err);
        resolve();
      }
    );
    child.on('error', reject);
  });
}

module.exports = { runMigrations };
