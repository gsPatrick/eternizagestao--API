# Agenda e Documentos Oficiais (Fase 4)

Features: `chapels` · `schedules` · `document-templates` · `documents` · `document-signatures`
Providers: `storage` · `digital-signature`

## Agenda (velórios e sepultamentos)

| Método | Rota | Descrição |
|---|---|---|
| CRUD | `/v1/cemeteries/:id/chapels` + `/v1/chapels/:id` | Capelas/salas de velório |
| POST | `/v1/schedules` | Agendar `{scheduleType: velorio\|sepultamento\|exumacao..., cemeteryId, startsAt, endsAt, chapelId?, graveId?, deceasedId?, responsiblePersonId?}` |
| GET | `/v1/schedules?from=&to=&chapelId=&status=` | Visão calendário |
| PATCH | `/v1/schedules/:id/status` | agendado→confirmado→em_andamento→concluido / cancelado |

**Anticonflito:** sobreposição de horário na MESMA capela ou MESMA sepultura →
`409 SCHEDULE_CONFLICT` com os agendamentos conflitantes em `details`.
Notificação automática ao responsável (best-effort via WhatsApp).

## Documentos oficiais

| Método | Rota | Descrição |
|---|---|---|
| CRUD | `/v1/document-templates` | Modelos do cliente por tipo (HTML com `{{placeholders}}` ou arquivo) |
| POST | `/v1/documents` | Emitir `{documentType, graveId?, deceasedId?, personId?, referenceType?, referenceId?, data?}` |
| POST | `/v1/documents/:id/reissue` | **2ª via** (novo número, aponta pro original) |
| PATCH | `/v1/documents/:id/cancel` | Cancela |
| GET | `/v1/documents?documentType=&year=&graveId=` | Consulta |

- **Numeração sequencial** por tenant + tipo + ano (`0001/2026`) com lock transacional — sem furos nem duplicatas.
- Enriquecimento automático: `certidao_perpetuidade` + graveId → puxa concessão ativa,
  proprietário e cemitério; `autorizacao_sepultamento` + burial → puxa sepultado e jazigo.
- Emissão gera evento `documento_emitido` na timeline do jazigo.
- Recibos de pagamento são emitidos automaticamente pela baixa (feature payments).

## Assinatura digital

| Método | Rota | Descrição |
|---|---|---|
| POST | `/v1/documents/:documentId/signatures` | Envia p/ assinatura `{signerName, signerEmail?, signerCpf?}` → retorna `signUrl` |
| GET | `/v1/documents/:documentId/signatures` | Status das assinaturas |
| POST | `/v1/webhooks/signature` | **Público** (header `x-webhook-signature`) — atualiza status: assinado/recusado/expirado. Todas assinadas → documento `assinado` |
