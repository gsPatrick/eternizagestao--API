# Referência de Variáveis de Ambiente

> Nunca commitar `.env`. Este arquivo e o `.env.example` são atualizados **no mesmo
> commit** em que uma variável nova aparece.

## Aplicação

| Variável | Obrigatória | Default | Descrição / exemplo seguro |
|---|---|---|---|
| `NODE_ENV` | não | `development` | `development` \| `test` \| `production` |
| `APP_PORT` | não | `3000` | Porta HTTP da API |
| `APP_API_PREFIX` | não | `/api` | Prefixo público (rotas ficam `/api/v1/...`) |
| `CORS_ORIGINS` | não | `*` | Origens liberadas, separadas por vírgula. Em produção SEMPRE preencher. Ex.: `https://cidade.plataforma.com` |

## Banco de dados (PostgreSQL)

| Variável | Obrigatória | Default | Descrição |
|---|---|---|---|
| `DB_HOST` | sim | `localhost` | Host do Postgres |
| `DB_PORT` | sim | `5432` | Porta |
| `DB_NAME` | sim | `eterniza_gestao_dev` | Nome do banco |
| `DB_USER` | sim | `postgres` | Usuário |
| `DB_PASSWORD` | sim | — | Senha (nunca commitar valor real) |
| `DB_NAME_TEST` | não | `eterniza_gestao_test` | Banco usado quando `NODE_ENV=test` |
| `DB_SSL` | não | `false` | `true` em provedores gerenciados (RDS etc.) |
| `DB_POOL_MAX` | não | `10` | Máximo de conexões no pool |
| `DB_POOL_MIN` | não | `0` | Mínimo de conexões |
| `DB_POOL_ACQUIRE` | não | `30000` | Timeout (ms) para obter conexão |
| `DB_POOL_IDLE` | não | `10000` | Tempo (ms) até liberar conexão ociosa |
| `DB_LOGGING` | não | `false` | `true` loga SQL no console (só debug local) |

## Autenticação (JWT) — feature `sessions`

| Variável | Obrigatória | Default | Descrição |
|---|---|---|---|
| `JWT_SECRET` | **sim em produção** | `dev-secret-...` (só dev) | Segredo de assinatura dos tokens. A API **não sobe** em produção sem ela |
| `JWT_EXPIRES_IN` | não | `1d` | Validade do access token |
| `JWT_REFRESH_EXPIRES_IN` | não | `7d` | Validade do refresh token |

## Storage de arquivos — providers `storage`

| Variável | Obrigatória | Default | Descrição |
|---|---|---|---|
| `STORAGE_DRIVER` | não | `local` | Driver de armazenamento (`local`; futuros: `s3`, `gcs`) |
| `STORAGE_LOCAL_DIR` | não | `uploads` | Pasta local dos arquivos (servida em `/files`) |

## Gateway de pagamento — provider `payment-gateway`

| Variável | Obrigatória | Default | Descrição |
|---|---|---|---|
| `PAYMENT_GATEWAY_PROVIDER` | não | `mock` | Driver do gateway (mock em dev; real em produção) |
| `PAYMENT_GATEWAY_API_KEY` | prod | — | Credencial do gateway real |
| `PAYMENT_GATEWAY_WEBHOOK_SECRET` | sim | `mock-webhook-secret` | Valida a assinatura dos webhooks (header `x-webhook-signature`) |

## WhatsApp — provider `whatsapp`

| Variável | Obrigatória | Default | Descrição |
|---|---|---|---|
| `WHATSAPP_PROVIDER` | não | `mock` | Driver de envio (mock só loga) |
| `WHATSAPP_API_URL` / `WHATSAPP_API_TOKEN` | prod | — | Credenciais do provedor real |

## Assinatura digital — provider `digital-signature`

| Variável | Obrigatória | Default | Descrição |
|---|---|---|---|
| `SIGNATURE_PROVIDER` | não | `mock` | Driver (Clicksign/D4Sign/ZapSign futuros) |
| `SIGNATURE_API_KEY` | prod | — | Credencial do provedor |
| `SIGNATURE_WEBHOOK_SECRET` | sim | `mock-signature-secret` | Valida webhooks de assinatura |
