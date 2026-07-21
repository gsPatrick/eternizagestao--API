'use strict';

const { execFile } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

/**
 * Aplica as migrations PENDENTES no boot da API (mesmo mecanismo do
 * `npm run migrate` — sequelize-cli db:migrate, honrando o .sequelizerc).
 *
 * Idempotente: se não há pendências, o sequelize-cli não faz nada. Resolve com
 * a saída; rejeita em erro (o caller decide se derruba a app ou só loga —
 * em produção o app.js ABORTA o boot, ver applyMigrations).
 *
 * TIMEOUT: uma migration travada (ex.: lock de tabela esperando outra conexão)
 * deixaria o boot pendurado para sempre, e o EasyPanel só veria um container que
 * nunca fica pronto, sem log de erro. Com o timeout o processo é morto e a
 * promise REJEITA — o boot falha rápido e visível. Ajustável por
 * MIGRATE_TIMEOUT_MS (default 120s; 0 desativa).
 */
const TIMEOUT_MS = Number(process.env.MIGRATE_TIMEOUT_MS ?? 120000);

function runMigrations() {
  return new Promise((resolve, reject) => {
    // binário local do sequelize-cli (instalado via npm ci na imagem)
    const bin = path.join(ROOT, 'node_modules', '.bin', 'sequelize-cli');
    const child = execFile(
      bin,
      ['db:migrate'],
      {
        cwd: ROOT,
        env: process.env,
        maxBuffer: 10 * 1024 * 1024,
        timeout: Number.isFinite(TIMEOUT_MS) && TIMEOUT_MS > 0 ? TIMEOUT_MS : 0,
        killSignal: 'SIGKILL',
      },
      (err, stdout, stderr) => {
        if (stdout) process.stdout.write(stdout);
        if (stderr) process.stderr.write(stderr);
        if (err) {
          // Mensagem acionável quando foi o timeout que matou o processo.
          if (err.killed) {
            return reject(new Error(
              `db:migrate excedeu ${TIMEOUT_MS}ms e foi interrompido `
              + '(possível lock no banco). Ajuste com MIGRATE_TIMEOUT_MS.'
            ));
          }
          return reject(err);
        }
        resolve();
      }
    );
    child.on('error', reject);
  });
}

module.exports = { runMigrations };
