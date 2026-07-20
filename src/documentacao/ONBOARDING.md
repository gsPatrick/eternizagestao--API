# Onboarding — rodar a API localmente

## Pré-requisitos
- Node.js ≥ 18
- PostgreSQL ≥ 13 (testado com 16)

## Passo a passo

```bash
# 1. Instalar dependências
npm install

# 2. Configurar ambiente
cp .env.example .env
# edite .env com as credenciais do seu Postgres local

# 3. Criar o banco e aplicar o schema (12 migrations + seed de statuses)
npm run db:create        # ou: createdb eterniza_gestao_dev
npm run migrate

# 4. Subir a API
npm run dev              # com --watch (reinicia ao salvar)
# ou: npm start
```

## Verificando

```bash
curl http://localhost:3000/api/health    # => { "status": "ok", ... }
curl http://localhost:3000/api/v1/ping   # => { "pong": true, ... }
```

## Banco de dados

| Comando | Efeito |
|---|---|
| `npm run migrate` | Aplica migrations pendentes |
| `npm run migrate:undo` | Reverte a última migration |
| `npm run migrate:undo:all` | Reverte TUDO (drop de tabelas e enums) |

- O seed dos 6 statuses de sepultura (livre, ocupada, reservada, em_manutencao,
  interditada, em_perpetuidade) acontece dentro da migration 3 — não há passo extra.
- Alterou schema? **Sempre** nova migration (nunca só o model) + nota no
  [Registro_Migracoes.md](./Registro_Migracoes.md).

## Primeiro usuário / tenant

A feature `sessions`/`tenants` ainda não foi implementada. Quando existir, o fluxo
será documentado aqui (seed de tenant demo + usuário admin). Por enquanto o banco
pode ser populado via `src/models` em um script Node ou SQL direto.

## Logs
- Desenvolvimento: stdout do processo (`npm run dev`).
- SQL do Sequelize: `DB_LOGGING=true` no `.env`.
- Erros não tratados aparecem como `[ERRO NÃO TRATADO]` no console (ver `src/middlewares/error-handler.js`).
