# Estrutura Física e Mapa (Fase 1)

Features: `cemeteries` · `cemetery-structure` · `grave-statuses` · `graves` · `map`

## Rotas principais (todas Bearer + tenant)

| Método | Rota | Descrição |
|---|---|---|
| CRUD | `/v1/cemeteries` | Cemitérios do tenant (entrada GPS p/ rotas do visitante) |
| GET | `/v1/cemeteries/:id/structure` | Árvore completa: quadras → ruas → lotes |
| GET/POST | `/v1/cemeteries/:id/blocks` | Quadras |
| GET/POST | `/v1/blocks/:id/streets` | Ruas da quadra |
| GET/POST | `/v1/streets/:id/lots` | Lotes da rua |
| PATCH/DELETE | `/v1/blocks/:id` etc. | Edição/remoção por nível |
| GET/POST | `/v1/grave-statuses` | Status do jazigo — sistema + customizados do tenant (`allowsBurial` controla se aceita sepultamento) |
| CRUD | `/v1/graves` | Sepulturas. Filtros: `?cemeteryId=&lotId=&statusId=&unitType=&code=&blocked=&onlyRoot=true` |
| GET | `/v1/graves/:id/summary` | Visão 360º: hierarquia, concessão ativa, ocupação, gavetas |
| PATCH | `/v1/graves/:id/status` | `{slug: 'reservada'}` ou `{statusId}` + `reason` → gera evento na timeline |
| PATCH | `/v1/graves/:id/block` / `unblock` | Bloqueio operacional (admin) — trava sepultamento/reforma |
| GET/POST | `/v1/cemeteries/:id/orthophotos` | Ortofoto base do mapa (upload base64 + `bounds` de georreferência) |
| GET/POST | `/v1/cemeteries/:id/map-paths` | Malha de caminhos p/ GPS `[[lat,lng],...]` |
| PATCH | `/v1/graves/:id/geometry` | Demarcação: `{geoPolygon: [[lat,lng]x3+], latitude, longitude}` |

## Criar jazigo com gavetas
```json
POST /v1/graves { "lotId": "...", "code": "A-R1-L1-01", "unitType": "jazigo", "capacity": 4 }
POST /v1/graves { "lotId": "...", "code": "A-R1-L1-01-G1", "unitType": "gaveta", "parentGraveId": "<id do jazigo>" }
```

## Erros comuns
- `409 UNIQUE_VIOLATION` — código duplicado no mesmo cemitério/nível
- `400 INVALID_PARENT` — gaveta com pai que não é jazigo/túmulo
- `409 GRAVE_OCCUPIED` — tentativa de excluir sepultura com sepultamento ativo
- `409 HAS_CHILDREN` — excluir quadra/rua/lote com filhos
