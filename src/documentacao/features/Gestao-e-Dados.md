# Gestão e Dados (Fase 6)

Features: `dashboard` · `reports` · `imports` · `data-exports` · `audit-logs`

## Dashboard e relatórios

| Método | Rota | Descrição |
|---|---|---|
| GET | `/v1/dashboard?cemeteryId=` | Painel: ocupação por status, sepultamentos/exumações (mês/ano), financeiro (recebido, a receber, em atraso), % inadimplência, concessões ativas |
| GET | `/v1/reports/occupancy` | Ocupação por quadra |
| GET | `/v1/reports/burials?from=&to=` | Sepultamentos por período |
| GET | `/v1/reports/exhumations` | Exumações |
| GET | `/v1/reports/revenue` | Arrecadação (pagamentos) |
| GET | `/v1/reports/delinquency` | Inadimplência detalhada |
| GET | `/v1/reports/concessions` | Concessões por período |

Todos aceitam `?format=json|csv` (CSV pronto para Excel, separador `;`).

## Importação de legado (`/v1/imports`)

```
POST /v1/imports {entityScope: sepultados|sepulturas|proprietarios, rows: [...]}  → lote 'pendente'
POST /v1/imports/:id/validate   → valida linha a linha (valido/invalido + erros)
POST /v1/imports/:id/commit     → (admin) efetiva os válidos; erro em 1 linha NÃO aborta o lote
GET  /v1/imports/:id/records?status=invalido  → revisão dos rejeitados
```
- `sepultados` com `row.graveCode` → vincula à sepultura e cria o sepultamento automaticamente
- Linha original preservada em `raw_data` (auditoria da migração)

## Exportações para órgãos públicos (`/v1/data-exports`)

| Tipo | Conteúdo |
|---|---|
| `cartorio` | Óbitos do período com dados de certidão (nome, filiação, cartório, sepultura) |
| `orgao_municipal` | Sepultamentos com autorização/declarante |
| `sepultamentos` / `exumacoes` / `financeiro` / `inadimplencia` / `ocupacao` | Operacionais |

`POST /v1/data-exports {exportType, format: csv|json, periodStart?, periodEnd?}` → gera arquivo
(baixável via `fileUrl`). PDF/XLSX: reservados para provider futuro (400 UNSUPPORTED_FORMAT).

## Auditoria (`/v1/audit-logs` — admin)
- Toda mutação HTTP bem-sucedida é logada automaticamente (middleware `audit`): quem
  (usuário ou conta do portal), o quê, de onde (IP/user-agent).
- `GET /v1/audit-logs?userId=&entityType=&from=&to=` — consulta paginada.
- Registros imutáveis (sem update/delete).
