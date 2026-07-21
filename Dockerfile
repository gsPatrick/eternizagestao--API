# Eterniza Gestão — API (Node 20 + Chromium para o PDF dos documentos)
FROM node:20-bookworm-slim

# Chromium (Puppeteer renderiza os documentos oficiais em PDF) + fontes/certs.
# Instalamos o Chromium do sistema e dizemos ao Puppeteer para usá-lo (sem baixar).
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      chromium \
      fonts-liberation \
      fonts-noto-core \
      ca-certificates \
 && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

# ARMAZENAMENTO DOS ARQUIVOS (ortofotos, fotos, PDFs, anexos).
#
# Ficavam em ./uploads DENTRO do container: a cada deploy/restart o sistema de
# arquivos é recriado e TUDO se perdia — ortofotos enviadas voltavam 404 e a
# certidão já emitida sumia. O caminho passa a ser explícito e fora do código
# da aplicação, para poder ser montado num volume persistente.
#
# NO EASYPANEL: crie um volume e monte em /app/storage. Sem isso, os arquivos
# continuam sumindo a cada deploy — o VOLUME abaixo só declara a intenção.
ENV STORAGE_LOCAL_DIR=/app/storage
VOLUME ["/app/storage"]

# Dependências (npm ci instala tudo, inclusive sequelize-cli p/ as migrations).
# PUPPETEER_SKIP_DOWNLOAD acima evita o download do Chromium no postinstall.
COPY package*.json ./
RUN npm ci

# Código da aplicação
COPY . .

ENV NODE_ENV=production
EXPOSE 3333

# A MESMA imagem serve como API ou como WORKER, decidido no start pela env WORKER:
#   - WORKER=true  → sobe SÓ o worker (processa a fila de e-mails/notificações e
#                    roda os agendamentos). NÃO aplica migrations nem seed.
#   - caso contrário → API: aplica migrations, garante o super_admin (idempotente)
#                    e sobe o servidor HTTP.
# No EasyPanel: crie um 2º serviço com esta mesma imagem/repo e a env WORKER=true
# (mesmas envs de DB/REDIS/RESEND da API). O worker não precisa expor porta.
# (Postgres/Redis precisam estar acessíveis via as variáveis do ambiente no start.)
#
# FALHA RÁPIDA no start da API (os `&&` são intencionais — não troque por `;`):
#   - `npm run migrate` falhando   → não sobe a API com schema fora de sincronia;
#   - `seed-admin` falhando        → não sobe a API sem super_admin válido. Em
#     produção esse seed EXIGE a env SEED_ADMIN_PASSWORD (senha forte, >=12
#     caracteres); sem ela o container aborta de propósito, para nenhum ambiente
#     nascer com a senha padrão pública do repositório.
# Envs relevantes: SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD (obrigatória em prod),
# AUTO_MIGRATE=false (escape hatch), PERPETUITY_BACKFILL=true (opt-in pontual).
CMD ["sh", "-c", "if [ \"$WORKER\" = \"true\" ]; then echo '[start] modo WORKER'; node src/queues/worker.js; else echo '[start] modo API'; npm run migrate && node scripts/seed-admin.js && node app.js; fi"]
