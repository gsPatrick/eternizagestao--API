# Operação do Cemitério (Fase 2)

Features: `people` · `concessions` · `deceased` · `burials` · `exhumations` · `ossuaries` · `grave-maintenances` · `grave-timeline` · `attachments`

## Pessoas e concessões

| Método | Rota | Descrição |
|---|---|---|
| CRUD | `/v1/people` | Proprietários/responsáveis (`?search=` nome/CPF/email). Vínculos: `POST /:id/relationships` |
| POST | `/v1/graves/:graveId/concessions` | Emitir concessão `{personId, concessionType: perpetua\|temporaria, startDate, endDate?}`. Perpétua muda status do jazigo p/ `em_perpetuidade` |
| GET | `/v1/graves/:graveId/concessions` | **Histórico de proprietários** |
| POST | `/v1/concessions/:id/transfer` | `{toPersonId, transferReason: venda\|doacao\|heranca\|decisao_judicial\|regularizacao\|outro, familyRelationship?}` — encerra origem, cria destino, registra transferência + evento |
| PATCH | `/v1/concessions/:id/terminate` | Encerra concessão |

## Sepultados e sepultamentos

| Método | Rota | Descrição |
|---|---|---|
| CRUD | `/v1/deceased` | Sepultados (`?search=`, `?deathFrom/deathTo`) |
| POST | `/v1/burials` | Registrar sepultamento — validações em transação: status permite (`allowsBurial`), jazigo não bloqueado, **sem inadimplência**, capacidade livre, concessão ativa, sepultado não enterrado. `force: true` (admin) pula inadimplência/concessão |
| GET | `/v1/burials` | Filtros: graveId, deceasedId, período |

Erros: `422 GRAVE_BLOCKED` · `422 STATUS_FORBIDS_BURIAL` · `422 GRAVE_DELINQUENT` · `422 GRAVE_FULL` · `422 NO_ACTIVE_CONCESSION` · `409 ALREADY_BURIED`

## Exumações (fluxo de estados) e ossário

```
POST /v1/exhumations            → solicitada
PATCH /v1/exhumations/:id/authorize → autorizada (registra quem autorizou)
PATCH /v1/exhumations/:id/schedule  → agendada {scheduledDate}
PATCH /v1/exhumations/:id/perform   → realizada {destinationType, destination...}
PATCH /v1/exhumations/:id/cancel    → cancelada
```
Destinos em `perform`: `ossario` (nicho livre → cria depósito + ocupa nicho), `outro_jazigo`
(novo sepultamento no destino), `cremacao`/`translado_externo`. Tudo atualiza a localização
do sepultado e gera eventos na timeline (origem e destino).

| Método | Rota | Descrição |
|---|---|---|
| CRUD | `/v1/cemeteries/:id/ossuaries` + `/v1/ossuaries/:id` | Ossários |
| POST | `/v1/ossuaries/:id/niches` | Nichos (aceita lote `{niches: [...]}`) |
| GET | `/v1/niches/:id/deposits` | Rastreabilidade do nicho |
| POST | `/v1/deposits/:id/remove` | Retirada de restos (libera nicho) |

## Manutenções, timeline e anexos

| Método | Rota | Descrição |
|---|---|---|
| POST | `/v1/graves/:graveId/maintenances` | Reforma/obra — **bloqueada se inadimplente** |
| PATCH | `/v1/maintenances/:id/status` | solicitada→autorizada→em_andamento→concluida (ou cancelada) |
| GET | `/v1/graves/:graveId/timeline` | **Linha do tempo imutável** (`?eventType=` filtra). Sem endpoint de escrita |
| POST | `/v1/attachments` | `{attachableType, attachableId, fileName, contentBase64, category}` — fotos, certidões de óbito, docs de exumação |
| GET | `/v1/attachments?attachableType=deceased&attachableId=...` | Anexos do alvo |
