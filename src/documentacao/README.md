# Eterniza Gestão — API · Documentação

> Comece aqui. Documentação viva — atualizada junto com o código, no mesmo commit.

## O que é

API do **Sistema de Gestão de Cemitérios Eterniza Gestão**: plataforma multi-tenant
(white label, subdomínio por cidade) para gestão completa de cemitérios — estrutura
física, concessões, sepultados, exumações/ossário, financeiro (boleto/PIX com baixa
automática), agendamentos, documentos oficiais com assinatura digital, notificações
WhatsApp, portais público e da família, mapa georreferenciado sobre ortofoto.

**Stack:** Node.js · JavaScript · Express · PostgreSQL · Sequelize.

## Índice

| Documento | Conteúdo |
|---|---|
| [ONBOARDING.md](./ONBOARDING.md) | Rodar local, migrar o banco, primeiro request |
| [ENV_REFERENCE.md](./ENV_REFERENCE.md) | Todas as variáveis de ambiente |
| [MAPA-DE-FEATURES.md](./MAPA-DE-FEATURES.md) | **Roadmap completo: as 36 features, fases e dependências** |
| [Registro_Migracoes.md](./Registro_Migracoes.md) | Changelog do schema (12 migrations) |
| [models/README.md](./models/README.md) | Mapa das 40 entidades do banco |
| [middlewares/README.md](./middlewares/README.md) | Middlewares transversais |
| `features/<Nome>.md` | Uma página por feature (criada junto com a feature) |

## Arquitetura (resumo)

```
Request → routes/index.js → <feature>.routes → <feature>.controller → <feature>.service → models / providers
```

- `app.js` (raiz): env, Express, middlewares globais, prefixo `/api`, erro, listen.
- `src/features/<nome>/`: routes + controller (só HTTP) + service (negócio/transações).
- `src/providers/`: integrações externas (gateway, WhatsApp, assinatura, storage).
- `src/middlewares/`: erro (pronto), auth, tenant-resolver, authorize... (ver mapa).
- `src/utils/`: `AppError`, `catchAsync`, resposta HTTP padronizada.
- Erro padronizado: `{ success: false, error: { code, message, details? } }`.
- Sucesso padronizado: `{ success: true, data, meta? }`.

## Estado atual

- ✅ Camada de dados completa (40 tabelas, migrations reversíveis, models + associações)
- ✅ **TODAS as 36 features implementadas** (ver [MAPA-DE-FEATURES.md](./MAPA-DE-FEATURES.md))
- ✅ 6 middlewares + 4 providers (driver mock → trocar por real sem tocar nas features)
- ✅ Validado E2E com servidor + Postgres reais: smoke 16/16 + estendido 8/8
  (`npm run seed:dev` + `npm start` + `npm run smoke:test`)
- 🔜 Produção: drivers reais (gateway/WhatsApp/assinatura/S3), jobs agendados, PDF real
