# Portais e Comunicação (Fase 5)

Features: `notifications` · `family-portal` · `public-search` · `public-map`
Provider: `whatsapp`

## Notificações (WhatsApp/e-mail)

| Método | Rota | Descrição |
|---|---|---|
| GET | `/v1/notifications?status=&channel=&notificationType=` | Auditoria de envios |
| POST | `/v1/notifications/test` | (admin) `{personId, message}` — dispara teste |

`notifications.service.notifyPerson()` é usado internamente por payments (pagamento
confirmado, cobrança gerada) e schedules (agendamento) — nunca lança erro; falha de
envio fica registrada com `status='falha'` + `errorMessage`.

## Portal da Família (`/v1/portal` — auth própria, separada da administrativa)

| Método | Rota | Auth | Descrição |
|---|---|---|---|
| POST | `/register` | — | `{email, cpf}` → localiza a pessoa no cadastro e cria conta pendente (token de ativação) |
| POST | `/activate` | — | `{email, activationToken, password}` |
| POST | `/sessions` | — | Login do portal (JWT `kind: portal`) |
| GET/PATCH | `/me` | portal | Ver/atualizar dados cadastrais (campos de contato apenas) |
| GET | `/debts` | portal | Débitos pendentes/em atraso + totais |
| GET | `/billings` | portal | Histórico financeiro completo |
| POST | `/billings/:id/reissue` | portal | **2ª via de boleto/PIX** (só das próprias cobranças) |
| GET | `/graves` | portal | Meus jazigos (concessões + localização) |
| GET | `/deceased` | portal | Meus sepultados + histórico |

## Portal público (`/v1/public` — sem auth, rate-limited, tenant por subdomínio)

| Método | Rota | Descrição |
|---|---|---|
| GET | `/search?name=&cpf=&graveCode=` | Busca de sepultados → cemitério/quadra/rua/lote/cova exatos + foto + posição no mapa. **Nunca** expõe documentos/causa da morte |
| GET | `/cemeteries/:id/map` | Ortofoto ativa + camadas de polígonos (quadras/ruas/lotes/sepulturas) |
| GET | `/graves/:id/route` | Dados p/ navegação GPS: entrada do cemitério → sepultura + malha de caminhos |
