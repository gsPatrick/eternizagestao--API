# Models — mapa das 40 entidades

> Detalhes campo a campo: ver os arquivos em `src/models/` e as migrations.
> Decisões de modelagem: `/Maturacao/02-MODELAGEM-BANCO-DE-DADOS.md` (raiz do projeto).

## Convenções
- PK UUID (`gen_random_uuid`), `tenant_id` em toda tabela de negócio, snake_case no
  banco / camelCase nos models (`underscored: true`).
- Soft delete (`paranoid`) apenas em cadastros-mestres; eventos/logs/financeiro são
  imutáveis ou cancelados por status.
- Polimorfismo sem FK (`reference_type` + `reference_id`) em attachments, documents,
  notifications, grave_events, audit_logs.

## Por domínio

| Domínio | Models |
|---|---|
| Plataforma | Tenant, User |
| Estrutura física | Cemetery, Orthophoto, MapPath, Block, Street, Lot, GraveStatus, Grave |
| Pessoas | Person, PersonRelationship, FamilyPortalAccount |
| Concessões | Concession, ConcessionTransfer |
| Sepultados | Deceased, Burial |
| Exumações/Ossário | Ossuary, OssuaryNiche, Exhumation, RemainsDeposit |
| Histórico do jazigo | GraveEvent (imutável), GraveMaintenance |
| Financeiro | FeeType, MaintenanceFee, Billing, Payment, PaymentGatewayEvent |
| Agenda | Chapel, Schedule |
| Documentos | DocumentTemplate, DocumentSequence, Document, DocumentSignature |
| Suporte | Attachment, Notification, AuditLog (imutável), ImportBatch, ImportRecord, DataExport |

## Relações-chave
- `Cemetery → Block → Street → Lot → Grave` (+ `Grave.parentGrave` para gavetas).
- `Grave ↔ Concession ↔ Person` (histórico de proprietários via ConcessionTransfer).
- `Deceased ↔ Burial ↔ Grave`; exumação encadeia `Exhumation → RemainsDeposit → OssuaryNiche`.
- `MaintenanceFee → Billing → Payment` (+ `PaymentGatewayEvent` para baixa automática).
- `Document → DocumentSignature`; numeração via `DocumentSequence`.
- Timeline: qualquer movimentação relevante gera `GraveEvent` no jazigo.
