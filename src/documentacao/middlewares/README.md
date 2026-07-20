# Middlewares transversais

## Implementados

### `error-handler` (`src/middlewares/error-handler.js`)
- `notFoundHandler`: transforma rota inexistente em `AppError` 404 (`ROUTE_NOT_FOUND`).
- `errorHandler`: handler único da API (sempre o último middleware do `app.js`).
  - Converte erros do Sequelize: unique → 409 `UNIQUE_VIOLATION`; validação → 400
    `VALIDATION_ERROR`; FK → 400 `FK_VIOLATION`.
  - `AppError` (operacional) devolve a própria mensagem; qualquer outro erro devolve
    500 genérico e loga o stack no servidor (`[ERRO NÃO TRATADO]`).
  - Formato de erro: `{ success: false, error: { code, message, details? } }`.

Uso nos controllers: lançar `AppError` (helpers: `badRequest`, `unauthorized`,
`forbidden`, `notFound`, `conflict`) e envolver handlers com `catchAsync`.

## Planejados (criados junto com as respectivas features)

| Middleware | Feature que o introduz | Responsabilidade |
|---|---|---|
| `auth` | sessions | Validar JWT, popular `req.user` |
| `tenant-resolver` | tenants | Resolver tenant pelo subdomínio/header, popular `req.tenant` |
| `authorize` | users | RBAC: `authorize('admin', 'operador')` |
| `portal-auth` | family-portal | Auth de contas do Portal da Família |
| `rate-limit` | public-search | Proteção das rotas públicas e webhooks |
| `audit` | transversal | Gravar `audit_logs` nas mutações |
