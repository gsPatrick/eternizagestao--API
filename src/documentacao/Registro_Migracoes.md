# Registro de Migrations (changelog do schema)

> Toda alteração de schema entra aqui, com data e motivo. Nunca alterar migration
> já aplicada em outro ambiente — criar uma nova.

## 2026-07-16 — Schema inicial (12 migrations, 40 tabelas)

| Migration | Tabelas | Observações |
|---|---|---|
| `20260716000001-create-tenants-and-users` | tenants, users | Habilita `pgcrypto` (gen_random_uuid). Roles: super_admin/admin/operador/consulta |
| `20260716000002-create-cemetery-structure` | cemeteries, orthophotos, map_paths, blocks, streets, lots | Hierarquia física + georreferenciamento base |
| `20260716000003-create-grave-statuses-and-graves` | grave_statuses, graves | **Seed**: 6 statuses de sistema (tenant_id NULL). Gaveta via parent_grave_id |
| `20260716000004-create-people` | people, person_relationships, family_portal_accounts | CPF único por tenant |
| `20260716000005-create-concessions` | concessions, concession_transfers | Histórico de proprietários |
| `20260716000006-create-deceased-and-burials` | deceased, burials | Localização atual do sepultado |
| `20260716000007-create-ossuary-and-exhumations` | ossuaries, ossuary_niches, exhumations, remains_deposits | Rastreabilidade de restos mortais |
| `20260716000008-create-grave-history` | grave_events, grave_maintenances | grave_events é IMUTÁVEL |
| `20260716000009-create-financial` | fee_types, maintenance_fees, billings, payments, payment_gateway_events | Boleto/PIX, 2ª via, baixa automática |
| `20260716000010-create-scheduling` | chapels, schedules | Índices p/ detecção de conflito de horário |
| `20260716000011-create-documents` | document_templates, document_sequences, documents, document_signatures | Numeração sequencial por tenant/tipo/ano |
| `20260716000012-create-support-tables` | attachments, notifications, audit_logs, import_batches, import_records, data_exports | audit_logs sem updated_at (imutável) |

Validação executada em 2026-07-16: migrate ✔ · undo:all ✔ · re-migrate ✔ · smoke test transacional ✔ (PostgreSQL 16).
