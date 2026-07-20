# Eterniza Gestão — Mapa de Features (roadmap de implementação)

> Fonte: briefing do Sistema de Gestão de Cemitérios + modelagem em `/Maturacao`.
> O banco (40 tabelas) já está pronto — **nenhuma feature exige nova migration** para começar.
> Ordem de fases = ordem recomendada de implementação (cada fase destrava a seguinte).

## Visão geral

| # | Feature (pasta) | Fase | Depende de | Models principais | Provider |
|---|---|---|---|---|---|
| 1 | `sessions` | 0 | — | User, Tenant | — |
| 2 | `tenants` | 0 | sessions | Tenant | — |
| 3 | `users` | 0 | sessions | User | — |
| 4 | `cemeteries` | 1 | tenants | Cemetery | — |
| 5 | `cemetery-structure` | 1 | cemeteries | Block, Street, Lot | — |
| 6 | `grave-statuses` | 1 | tenants | GraveStatus | — |
| 7 | `graves` | 1 | cemetery-structure, grave-statuses | Grave | — |
| 8 | `people` | 1 | tenants | Person, PersonRelationship | — |
| 9 | `map` | 1 | cemeteries, graves | Orthophoto, MapPath, Grave | storage |
| 10 | `concessions` | 2 | graves, people | Concession, ConcessionTransfer | — |
| 11 | `deceased` | 2 | people | Deceased | storage |
| 12 | `burials` | 2 | graves, deceased | Burial, GraveEvent | — |
| 13 | `exhumations` | 2 | burials, ossuaries | Exhumation, RemainsDeposit, GraveEvent | — |
| 14 | `ossuaries` | 2 | cemeteries | Ossuary, OssuaryNiche, RemainsDeposit | — |
| 15 | `grave-maintenances` | 2 | graves, delinquency* | GraveMaintenance, GraveEvent | — |
| 16 | `grave-timeline` | 2 | graves | GraveEvent | — |
| 17 | `attachments` | 2 | (qualquer entidade) | Attachment | storage |
| 18 | `fee-types` | 3 | tenants | FeeType | — |
| 19 | `maintenance-fees` | 3 | fee-types, concessions | MaintenanceFee | — |
| 20 | `billings` | 3 | maintenance-fees | Billing | payment-gateway |
| 21 | `payments` | 3 | billings | Payment, PaymentGatewayEvent | payment-gateway |
| 22 | `delinquency` | 3 | billings | Billing, Grave, Person | — |
| 23 | `chapels` | 4 | cemeteries | Chapel | — |
| 24 | `schedules` | 4 | chapels, burials | Schedule | — |
| 25 | `document-templates` | 4 | tenants | DocumentTemplate | storage |
| 26 | `documents` | 4 | document-templates | Document, DocumentSequence | storage |
| 27 | `document-signatures` | 4 | documents | DocumentSignature | digital-signature |
| 28 | `notifications` | 5 | billings, schedules | Notification | whatsapp |
| 29 | `family-portal` | 5 | billings, people | FamilyPortalAccount + leitura de vários | payment-gateway |
| 30 | `public-search` | 5 | deceased, graves, map | Deceased, Grave (leitura pública) | — |
| 31 | `public-map` | 5 | map | Grave, MapPath, Cemetery (leitura pública) | — |
| 32 | `dashboard` | 6 | fases 2–3 | agregações (vários) | — |
| 33 | `reports` | 6 | fases 2–3 | agregações (vários) | — |
| 34 | `imports` | 6 | fases 1–2 | ImportBatch, ImportRecord | storage |
| 35 | `data-exports` | 6 | fases 2–3 | DataExport | storage |
| 36 | `audit-logs` | 6 | sessions | AuditLog | — |

\* `grave-maintenances` consulta a regra de bloqueio por inadimplência quando a fase 3 existir; antes disso funciona sem a trava.

## Middlewares transversais (src/middlewares/)

| Middleware | Quando criar | Função |
|---|---|---|
| `error-handler` | ✅ criado | 404 + handler único (AppError, erros Sequelize) |
| `auth` | Fase 0 (sessions) | Valida JWT, popula `req.user` |
| `tenant-resolver` | Fase 0 (tenants) | Resolve tenant pelo subdomínio (`Host`) ou header `X-Tenant`, popula `req.tenant`; garante isolamento em TODAS as queries |
| `authorize` | Fase 0 (users) | RBAC por perfil: `authorize('admin', 'operador')` |
| `portal-auth` | Fase 5 (family-portal) | Auth separada para contas do Portal da Família |
| `rate-limit` | Fase 5 (rotas públicas) | Proteção de `public-search`/`public-map`/webhooks |
| `audit` | Fase 0+ (incremental) | Grava `audit_logs` em mutações relevantes |

---

## Fase 0 — Fundação (auth + multi-tenant)

### 1. `sessions`
- **O quê:** login/logout/refresh de usuários administrativos; `GET /me`.
- **Endpoints:** `POST /v1/sessions` (login) · `POST /v1/sessions/refresh` · `DELETE /v1/sessions` · `GET /v1/sessions/me`
- **Regras:** bcrypt no hash; JWT com `userId`, `tenantId`, `role`; atualiza `last_login_at`.
- **Novas envs:** `JWT_SECRET`, `JWT_EXPIRES_IN`, `JWT_REFRESH_EXPIRES_IN`.

### 2. `tenants`
- **O quê:** gestão de clientes white label (só `super_admin`); configuração visual e de subdomínio.
- **Endpoints:** CRUD `/v1/tenants` · `GET /v1/tenants/current` (dados do tenant do subdomínio, público p/ branding).
- **Regras:** subdomain único e imutável após criação; soft delete; settings JSONB (gateway, whatsapp).

### 3. `users`
- **O quê:** CRUD de usuários do tenant com perfis (admin, operador, consulta).
- **Endpoints:** CRUD `/v1/users` · `PATCH /v1/users/:id/password` · `PATCH /v1/users/:id/activate`.
- **Regras:** admin só gerencia usuários do próprio tenant; e-mail único por tenant.

## Fase 1 — Estrutura física e cadastros-base

### 4. `cemeteries` — CRUD de cemitérios do tenant (endereço, entrada GPS, logo próprio).
### 5. `cemetery-structure` — quadras, ruas e lotes (rotas aninhadas `/v1/cemeteries/:id/blocks`, `/v1/blocks/:id/streets`, `/v1/streets/:id/lots`); códigos únicos por pai; `geo_polygon` por nível (camadas do mapa).
### 6. `grave-statuses` — CRUD de status custom do tenant; statuses de sistema (`is_system`) são somente leitura.
### 7. `graves`
- **Endpoints:** CRUD `/v1/graves` (filtros: cemitério/quadra/rua/lote/status/tipo) · `PATCH /v1/graves/:id/status` · `PATCH /v1/graves/:id/block` e `/unblock` · `GET /v1/graves/:id/summary` (visão 360º).
- **Regras:** código único por cemitério; gaveta exige `parent_grave_id` jazigo; mudança de status/bloqueio gera `GraveEvent`.
### 8. `people` — CRUD de pessoas + vínculos familiares (`/v1/people/:id/relationships`); CPF único por tenant; busca por nome/CPF.
### 9. `map`
- **O quê:** upload de ortofotos (bounds de georreferenciamento), malha de caminhos (`map_paths`), demarcação de polígonos das sepulturas.
- **Endpoints:** `POST /v1/cemeteries/:id/orthophotos` · CRUD `map-paths` · `PATCH /v1/graves/:id/geometry` (polígono + lat/lng).
- **Provider:** `storage` (novas envs de bucket/credenciais).

## Fase 2 — Operação do cemitério

### 10. `concessions`
- **Endpoints:** `POST /v1/graves/:id/concessions` (emitir) · `POST /v1/concessions/:id/transfer` (venda/doação/herança + parentesco) · `PATCH .../terminate` · `GET /v1/graves/:id/concessions` (histórico de proprietários).
- **Regras:** 1 concessão ativa por sepultura; transferência = encerra origem + cria destino + `ConcessionTransfer` + `GraveEvent` (transação); perpétua ⇒ status do jazigo "em_perpetuidade".
### 11. `deceased` — CRUD de sepultados (dados civis completos, foto, certidão via attachments); busca forte (nome, CPF, datas).
### 12. `burials`
- **Regras críticas:** valida status permite sepultamento (`allows_burial`), capacidade disponível, jazigo não bloqueado (inadimplência) e concessão vigente; atualiza status da sepultura e `deceased.current_grave_id`; gera `GraveEvent`; tudo em transação.
### 13. `exhumations`
- **Endpoints:** fluxo `POST /v1/exhumations` (solicitar) → `.../authorize` → `.../schedule` → `.../perform` (com destino) → ou `.../cancel`.
- **Regras:** ao realizar: atualiza `Burial.status='exumado'`, destino (nicho do ossário ⇒ cria `RemainsDeposit` e ocupa nicho; outro jazigo ⇒ novo burial; translado/cremação ⇒ atualiza `current_location_type`), gera `GraveEvent` na origem e destino.
### 14. `ossuaries` — CRUD de ossários e nichos; consulta de ocupação; movimentação de restos entre nichos (`RemainsDeposit`).
### 15. `grave-maintenances` — fluxo solicitada → autorizada → em andamento → concluída; **bloqueada se jazigo inadimplente**; gera `GraveEvent`.
### 16. `grave-timeline` — `GET /v1/graves/:id/timeline` (paginada, filtro por tipo de evento). Escrita SEMPRE interna (services das outras features) — nunca endpoint de escrita.
### 17. `attachments` — upload/listagem/remoção polimórficos: `POST /v1/attachments` (`attachableType`, `attachableId`, categoria); usado por deceased (certidão de óbito, foto), exumações (docs obrigatórios), pagamentos (comprovantes) etc.

## Fase 3 — Financeiro

### 18. `fee-types` — catálogo de taxas (valor padrão, periodicidade).
### 19. `maintenance-fees` — aplicar taxa a jazigo (valor, periodicidade, vencimento, pagador); reajustes; suspender/encerrar.
### 20. `billings`
- **Endpoints:** `POST /v1/billings` (avulsa) · `POST /v1/billings/generate` (lote a partir das taxas com vencimento próximo — depois vira job em `queues/`) · `POST /v1/billings/:id/reissue` (2ª via) · `PATCH .../cancel` · `GET /v1/billings` (filtros por status/vencimento/pagador).
- **Provider:** `payment-gateway` (criar cobrança boleto/PIX). Novas envs: `PAYMENT_GATEWAY_*`.
- **Regras:** total = amount − discount + fine + interest; job diário marca `em_atraso`; gera `GraveEvent` (cobranca).
### 21. `payments`
- **Endpoints:** `POST /v1/billings/:id/payments` (baixa manual) · `POST /v1/webhooks/payment-gateway` (público + validação de assinatura — **baixa automática**) · `GET /v1/payments/:id/receipt`.
- **Regras:** webhook cru salvo em `PaymentGatewayEvent` ANTES de processar (idempotência por `gateway_charge_id` + event id); baixa: `Billing.status='pago'` + `Payment(is_automatic)` + recibo numerado (via `documents`) + `GraveEvent` + notificação.
### 22. `delinquency`
- **Endpoints:** `GET /v1/delinquency` (painel: devedores, valores, dias em atraso) · `GET /v1/delinquency/summary` (índices).
- **Regras:** serviço `isGraveDelinquent(graveId)` reutilizado por burials/grave-maintenances; bloqueio/desbloqueio automático de jazigos (`is_blocked`) com `GraveEvent`.

## Fase 4 — Agenda e documentos oficiais

### 23. `chapels` — CRUD de capelas/salas de velório.
### 24. `schedules`
- **Regras críticas:** detecção de conflito por sobreposição de intervalo (mesma capela OU mesma sepultura) antes de confirmar; visão calendário (`GET /v1/schedules?from=&to=`); vincula velório+sepultamento; notifica responsável.
### 25. `document-templates` — CRUD de modelos (HTML/arquivo) por tipo, com versão.
### 26. `documents`
- **Endpoints:** `POST /v1/documents` (emitir a partir de template + referência) · `POST /v1/documents/:id/reissue` (2ª via) · `PATCH .../cancel` · `GET /v1/documents` (por jazigo/sepultado/tipo).
- **Regras:** numeração sequencial transacional (`document_sequences` com `SELECT ... FOR UPDATE`); render PDF; `GraveEvent` (documento_emitido). Emissões específicas: Certidão de Perpetuidade (via concessions), Autorização de Sepultamento (via burials), recibos (via payments).
### 27. `document-signatures`
- **Endpoints:** `POST /v1/documents/:id/signatures` (enviar p/ assinatura) · webhook do provedor · consulta de status.
- **Provider:** `digital-signature`. Novas envs: `SIGNATURE_PROVIDER_*`.

## Fase 5 — Comunicação e portais

### 28. `notifications`
- **O quê:** disparo e rastreio de WhatsApp/e-mail (vencimento de taxa, cobrança gerada, pagamento confirmado, autorização, agendamento, lembretes).
- **Provider:** `whatsapp` (novas envs `WHATSAPP_*`); envio via fila (`queues/`) com retry.
- **Endpoints:** `GET /v1/notifications` (auditoria de envios) · `POST /v1/notifications/test`.
### 29. `family-portal`
- **O quê:** autoatendimento do proprietário/familiar (auth própria via `FamilyPortalAccount`).
- **Endpoints (prefixo `/v1/portal`):** `POST /portal/sessions` · `POST /portal/activate` · `GET /portal/me` · `PATCH /portal/me` (atualizar cadastro) · `GET /portal/debts` (débitos) · `POST /portal/billings/:id/reissue` (2ª via boleto/PIX) · `GET /portal/graves` (meus jazigos + histórico) · `GET /portal/deceased` (meus sepultados).
### 30. `public-search`
- **O quê:** portal público de consulta (sem auth, com rate-limit).
- **Endpoints:** `GET /v1/public/search?name=&cpf=&block=&lot=&code=` → cemitério, quadra, rua, lote, cova exatos + foto + posição no mapa.
### 31. `public-map`
- **O quê:** dados públicos para o app do visitante com GPS.
- **Endpoints:** `GET /v1/public/cemeteries/:id/map` (ortofoto ativa + bounds + camadas/polígonos) · `GET /v1/public/graves/:id/route` (entrada → sepultura usando `map_paths`).

## Fase 6 — Gestão, dados e integrações

### 32. `dashboard` — indicadores em tempo real: ocupação (por status/quadra), sepultamentos/exumações por período, arrecadação, % inadimplência (`GET /v1/dashboard`).
### 33. `reports` — relatórios gerenciais (ocupação, movimentações, financeiro por período/cemitério/tipo de taxa, histórico de proprietários) com export CSV/PDF.
### 34. `imports` — migração de legado: upload do lote → validação linha a linha (`import_records`) → revisão dos inválidos → efetivação transacional → vínculo ao mapeamento.
### 35. `data-exports` — geração de arquivos padronizados p/ cartórios e órgãos municipais (assíncrono; download quando `concluido`).
### 36. `audit-logs` — consulta do log de ações (filtros: usuário, entidade, período). Escrita é interna (middleware `audit`).

---

## Convenções que TODAS as features seguem
1. `routes → controller → service` (+ provider quando externo); controller nunca toca integração.
2. Toda query filtra por `req.tenant.id` (middleware `tenant-resolver`) — sem exceção.
3. Mutações relevantes de sepultura geram `GraveEvent` (timeline imutável) dentro da MESMA transação.
4. Nova env ⇒ atualizar `.env.example` + `documentacao/ENV_REFERENCE.md` no mesmo commit.
5. Nova feature ⇒ montar em `src/routes/index.js` + criar `documentacao/features/<Nome>.md`.
