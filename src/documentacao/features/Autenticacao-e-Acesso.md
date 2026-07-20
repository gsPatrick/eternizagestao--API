# Autenticação e Acesso (Fase 0)

Features: `sessions` · `tenants` · `users` — Middlewares: `auth`, `tenant-resolver`, `authorize`

## Como a autenticação funciona
- JWT Bearer. Payload: `{ sub: userId, tenantId, role, kind: 'user' }`.
- O **tenant** é resolvido assim: usuário comum → sempre o tenant do próprio usuário
  (isolamento garantido); super_admin/rotas públicas → header `X-Tenant-Subdomain`
  ou subdomínio do Host.
- Perfis: `super_admin` (plataforma) > `admin` > `operador` > `consulta`.

## Rotas

| Método | Rota | Auth | Descrição |
|---|---|---|---|
| POST | `/v1/sessions` | — (rate-limit 10/min) | Login. Body: `{email, password}`. Retorna `{user, accessToken, refreshToken}` |
| POST | `/v1/sessions/refresh` | — | `{refreshToken}` → novos tokens |
| GET | `/v1/sessions/me` | Bearer | Dados do usuário + tenant (branding) |
| GET | `/v1/tenants/current` | — (tenant por subdomínio) | Branding público do tenant |
| CRUD | `/v1/tenants` | super_admin | Gestão de clientes white label (subdomain imutável) |
| CRUD | `/v1/users` | admin (leitura: todos) | Usuários do tenant. Extras: `PATCH /:id/password`, `/:id/activate`, `/:id/deactivate` |

## Exemplo de login
```bash
curl -X POST https://demo.plataforma.com/api/v1/sessions \
  -H 'Content-Type: application/json' \
  -d '{"email": "admin@demo.dev", "password": "senha12345"}'
```

## Erros comuns
- `401 INVALID_CREDENTIALS` — email/senha errados
- `401 TOKEN_EXPIRED` / `INVALID_TOKEN` — renovar via refresh
- `400 TENANT_NOT_RESOLVED` — faltou subdomínio/header em rota que exige tenant
- `403 INSUFFICIENT_ROLE` — perfil sem permissão
