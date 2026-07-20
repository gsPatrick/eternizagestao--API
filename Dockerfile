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

# Dependências (npm ci instala tudo, inclusive sequelize-cli p/ as migrations).
# PUPPETEER_SKIP_DOWNLOAD acima evita o download do Chromium no postinstall.
COPY package*.json ./
RUN npm ci

# Código da aplicação
COPY . .

ENV NODE_ENV=production
EXPOSE 3333

# Aplica as migrations, garante o super_admin padrão (idempotente) e sobe a API.
# (Postgres precisa estar acessível via as variáveis DB_* no start.)
CMD ["sh", "-c", "npm run migrate && node scripts/seed-admin.js && node app.js"]
