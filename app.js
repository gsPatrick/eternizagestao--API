'use strict';

// Entrada da aplicação: .env, Express, middlewares globais, rotas, erro, listen.
// Regras de negócio NÃO vivem aqui — ver src/features/.
require('dotenv').config();

const express = require('express');
const cors = require('cors');

const routes = require('./src/routes');
const { notFoundHandler, errorHandler } = require('./src/middlewares/error-handler');

const app = express();

// Atrás de proxy/load balancer (Nginx, ELB, Cloudflare): confia em X-Forwarded-For
// para que o rate-limit e logs enxerguem o IP real do cliente, não o do proxy.
// TRUST_PROXY_HOPS = número de proxies confiáveis à frente da app.
app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS || 1));

// Não expor o header X-Powered-By (reduz superfície de fingerprinting).
app.disable('x-powered-by');

// Hardening de headers HTTP e compressão de resposta.
// try-require gracioso: o app sobe mesmo se a dep ainda não estiver instalada.
let helmet;
try {
  helmet = require('helmet');
} catch {
  // dep opcional ausente — segue sem hardening de headers
}
if (helmet) {
  app.use(
    helmet({
      // Cross-Origin-Resource-Policy: o padrão do helmet é 'same-origin', que
      // faz o NAVEGADOR bloquear qualquer recurso desta API embutido no front —
      // que roda em outro domínio. O arquivo respondia 200 e mesmo assim a
      // ortofoto não aparecia no mapa (ERR_BLOCKED_BY_RESPONSE.NotSameOrigin);
      // curl não aplica a política, então o problema só existia no navegador.
      //
      // 'cross-origin' libera o EMBUTIMENTO. Não afrouxa o acesso: os arquivos
      // continuam exigindo URL assinada (HMAC + expiração) ou sessão do tenant,
      // exatamente como antes — ver o handler de storage.PUBLIC_PREFIX abaixo.
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    })
  );
}

let compression;
try {
  compression = require('compression');
} catch {
  // dep opcional ausente — segue sem compressão
}
if (compression) app.use(compression());

// CORS: sistema multi-tenant white-label — cada cidade pode ter o seu próprio
// domínio/subdomínio. Liberamos TODAS as origens SEMPRE (hardcoded, sem depender
// de env): a segurança real é o JWT + o tenant do token, não o CORS.
// `origin: true` reflete o Origin da requisição e `credentials: true` mantém o
// Access-Control-Allow-Origin correto mesmo quando o front usa Authorization.
app.use(
  cors({
    origin: true,
    credentials: true,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Tenant-Subdomain'],
  })
);
app.options('*', cors({ origin: true, credentials: true }));

// limite maior por causa de uploads em base64 (ortofotos, certidões, anexos).
// verify captura o corpo BRUTO em req.rawBody (Buffer) para verificação HMAC
// de webhooks — providers validam a assinatura sobre esse buffer intacto.
app.use(
  express.json({
    limit: '25mb',
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  })
);
app.use(express.urlencoded({ extended: true }));

// Arquivos do storage local (certidões, exports com CPF, ortofotos, anexos).
// LGPD: NÃO servimos mais como estático aberto — a leitura exige uma URL
// ASSINADA (HMAC token+exp, ver storage.signedUrl) OU uma sessão autenticada
// cujo tenant case com o prefixo <tenantId>/ do caminho. Preserva o isolamento
// por tenant e mantém compat com o rewrite /files/:path* do next (a query
// ?token&exp passa pelo proxy).
const path = require('path');
const fs = require('fs');
const storage = require('./src/providers/storage');
const { verifyToken } = require('./src/utils/jwt');

app.use(storage.PUBLIC_PREFIX, (req, res) => {
  // Só GET/HEAD leem arquivos.
  if (req.method !== 'GET' && req.method !== 'HEAD') return res.status(405).end();

  // Caminho relativo pedido (após o mount /files), já decodificado.
  let relPath;
  try {
    relPath = decodeURIComponent(req.path.replace(/^\/+/, ''));
  } catch {
    return res.status(404).end();
  }
  if (!relPath) return res.status(404).end();

  // Barreira anti path traversal: o alvo tem que ficar dentro de LOCAL_DIR.
  const fullPath = path.resolve(storage.LOCAL_DIR, relPath);
  if (fullPath !== storage.LOCAL_DIR && !fullPath.startsWith(storage.LOCAL_DIR + path.sep)) {
    return res.status(404).end();
  }

  let authorized = false;

  // 1) URL assinada (token+exp) — caminho usado pelo visualizador (iframe/img,
  //    sem header Authorization) e pelos downloads públicos.
  const { token, exp } = req.query;
  if (token && exp && storage.verifySignedUrl(relPath, token, exp)) {
    authorized = true;
  }

  // 2) Alternativa: sessão administrativa (Bearer) cujo tenant case com o
  //    prefixo <tenantId>/ do caminho (isolamento multi-tenant preservado).
  if (!authorized) {
    const [scheme, bearer] = (req.headers.authorization || '').split(' ');
    if (scheme === 'Bearer' && bearer) {
      try {
        const payload = verifyToken(bearer);
        const tenantSeg = relPath.split('/')[0];
        if (payload.kind === 'user' && payload.tenantId && payload.tenantId === tenantSeg) {
          authorized = true;
        }
      } catch {
        // token inválido/expirado — segue negando
      }
    }
  }

  if (!authorized) return res.status(403).end();

  if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
    return res.status(404).end();
  }
  return res.sendFile(fullPath);
});

// Todas as rotas públicas sob o prefixo da API (ex.: /api/v1/...)
// audit: registra toda mutação bem-sucedida em audit_logs (rastreabilidade)
const audit = require('./src/middlewares/audit');
const apiPrefix = process.env.APP_API_PREFIX || '/api';
app.use(apiPrefix, audit, routes);

// 404 + handler de erro único (sempre por último)
app.use(notFoundHandler);
app.use(errorHandler);

// Sobe o servidor apenas quando executado diretamente (permite importar em testes)
if (require.main === module) {
  const port = Number(process.env.APP_PORT) || 3000;
  const { sequelize } = require('./src/models');
  const { runMigrations } = require('./src/utils/run-migrations');

  const IS_PRODUCTION = process.env.NODE_ENV === 'production';

  // AUTO-MIGRAÇÃO no boot: garante o schema do banco SEMPRE atualizado ao subir
  // a API (o cliente configura só via Dockerfile). Roda ANTES de aceitar tráfego.
  // Desligue com AUTO_MIGRATE=false.
  //
  // ENDURECIMENTO: antes a exceção era engolida e o servidor subia mesmo assim —
  // a API passava a aceitar tráfego com o schema desatualizado e quebrava em
  // runtime ("column ... does not exist"), com erro 500 espalhado e difícil de
  // diagnosticar. Agora:
  //   - PRODUÇÃO: falha de migration ABORTA o boot (process.exit(1)). O EasyPanel
  //     reinicia/marca o serviço como falho — melhor indisponível e visível do
  //     que "no ar" servindo erros silenciosos com dados possivelmente corrompidos.
  //   - DESENVOLVIMENTO: mantém o comportamento tolerante (loga e segue), para
  //     não travar o nodemon quando o Postgres local ainda está subindo.
  async function applyMigrations() {
    if (process.env.AUTO_MIGRATE === 'false') return;
    try {
      console.log('[boot] aplicando migrations pendentes...');
      await runMigrations();
      console.log('[boot] banco em dia (migrations aplicadas).');
    } catch (err) {
      console.error('[boot] falha ao aplicar migrations:', err.message);
      if (IS_PRODUCTION) {
        console.error(
          '[boot] ABORTANDO: em produção a API NÃO sobe com o schema fora de '
          + 'sincronia. Verifique a conectividade/credenciais do Postgres e a '
          + 'migration que falhou acima e refaça o deploy. '
          + '(Para subir mesmo assim, em último caso: AUTO_MIGRATE=false.)'
        );
        process.exit(1);
      }
      console.warn('[boot] seguindo mesmo assim (ambiente de desenvolvimento).');
    }
  }

  // BACKFILL das Certidões de Perpetuidade: emite as que faltam nas sepulturas
  // JÁ marcadas como "Perpétuo" (a emissão automática passou a existir depois, e
  // o bug do acento impedia até as novas). Idempotente e limitado por execução.
  //
  // ENDURECIMENTO (decisão): este backfill EMITE DOCUMENTOS OFICIAIS. Antes ele
  // era OPT-OUT (rodava sempre, salvo PERPETUITY_BACKFILL=false), ou seja, todo
  // restart de container — inclusive um restart automático do EasyPanel às 3h da
  // manhã — podia emitir certidões em lote, eventualmente no formato DEGRADADO
  // (fallback de PDF sem layout/logo, ver documents.service). Emissão de
  // documento oficial não pode ser efeito colateral de restart.
  // Passou a ser OPT-IN EXPLÍCITO: só roda com PERPETUITY_BACKFILL=true, que se
  // configura para um deploy pontual e se remove em seguida.
  // Uso manual (recomendado), sem depender do boot:
  //   node -e "require('./src/features/documents/backfill-perpetuity')
  //     .backfillPerpetuityCertificates().then(console.log)"
  async function runPerpetuityBackfill() {
    if (process.env.PERPETUITY_BACKFILL !== 'true') return;
    console.log('[boot] PERPETUITY_BACKFILL=true — emitindo certidões pendentes...');
    try {
      const { backfillPerpetuityCertificates } = require('./src/features/documents/backfill-perpetuity');
      const r = await backfillPerpetuityCertificates();
      if (r.pendentes) {
        console.log(
          `[boot] certidões de perpetuidade: ${r.emitidas} emitida(s), `
          + `${r.falhas} falha(s), ${Math.max(r.pendentes - r.emitidas - r.falhas, 0)} restante(s).`
        );
      } else {
        console.log('[boot] certidões de perpetuidade: nada pendente.');
      }
    } catch (err) {
      console.error('[boot] backfill de certidões falhou:', err.message);
    }
  }

  let server;
  applyMigrations().finally(() => {
    server = app.listen(port, async () => {
      console.log(`Eterniza Gestão API ouvindo na porta ${port} (prefixo ${apiPrefix})`);
      try {
        await sequelize.authenticate();
        console.log('Conexão com o PostgreSQL estabelecida.');
      } catch (err) {
        console.error('Falha ao conectar no PostgreSQL:', err.message);
      }
      // fora do caminho crítico: a API já está no ar quando isto começa
      runPerpetuityBackfill();
    });
  });

  // Graceful shutdown: para de aceitar novas conexões, drena as em andamento,
  // fecha o pool do Sequelize e sai. Timeout de segurança evita travar o deploy.
  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`Recebido ${signal}: iniciando graceful shutdown...`);

    const forceTimer = setTimeout(() => {
      console.error('Timeout de shutdown (10s): forçando saída.');
      process.exit(1);
    }, 10_000);
    forceTimer.unref();

    const done = async () => {
      try {
        await sequelize.close();
        console.log('Pool do PostgreSQL encerrado. Encerrando processo.');
      } catch (err) {
        console.error('Erro ao fechar o Sequelize:', err.message);
      } finally {
        clearTimeout(forceTimer);
        process.exit(0);
      }
    };
    // `server` pode ainda não existir se o sinal chegar durante a migração inicial.
    if (server) server.close(done);
    else done();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

module.exports = app;
