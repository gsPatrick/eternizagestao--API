# Financeiro (Fase 3)

Features: `fee-types` · `maintenance-fees` · `billings` · `payments` · `delinquency`
Provider: `payment-gateway` (driver mock em dev — trocar driver = zero mudança nas features)

## Fluxo completo
```
fee-types (catálogo) → maintenance-fees (taxa no jazigo, vinculada ao pagador)
  → POST /v1/billings/generate (gera cobranças com boleto+PIX via gateway)
  → gateway confirma pagamento → webhook → BAIXA AUTOMÁTICA
  → payment + recibo (documents) + evento na timeline + notificação WhatsApp
```

## Rotas

| Método | Rota | Descrição |
|---|---|---|
| CRUD | `/v1/fee-types` | Catálogo de taxas (valor padrão, periodicidade) |
| CRUD | `/v1/maintenance-fees` | Taxa aplicada ao jazigo `{graveId, feeTypeId, payerPersonId, amount, periodicity, nextDueDate}`. Extras: `/suspend`, `/reactivate`, `/terminate` |
| POST | `/v1/billings` | Cobrança avulsa/serviço (gera boleto+PIX no ato) |
| POST | `/v1/billings/generate` | Lote pelas taxas com `nextDueDate <= until` (idempotente por fee+competência) |
| POST | `/v1/billings/:id/reissue` | **2ª via** (cancela original, nova cobrança/novo PIX) |
| PATCH | `/v1/billings/:id/cancel` | Cancela pendente/em atraso |
| POST | `/v1/billings/mark-overdue` | Marca vencidas como `em_atraso` (futuro: job diário) |
| POST | `/v1/billings/:billingId/payments` | Baixa manual `{method, amountPaid?, paidAt?}` |
| POST | `/v1/webhooks/payment-gateway` | **Público** (assinatura via header `x-webhook-signature`). Baixa automática idempotente |
| GET | `/v1/payments/:id/receipt` | Recibo emitido (número + arquivo) |
| GET | `/v1/delinquency` | Painel: devedores, valores, dias em atraso |
| GET | `/v1/delinquency/summary` | Índices consolidados |
| POST | `/v1/delinquency/sync-blocks` | (admin) Bloqueia jazigos inadimplentes / desbloqueia regularizados |

## Webhook do gateway (formato normalizado pelo provider)
```json
POST /v1/webhooks/payment-gateway
Header: x-webhook-signature: <PAYMENT_GATEWAY_WEBHOOK_SECRET>
{ "event": "charge.paid", "chargeId": "...", "paidAt": "...", "amountPaid": "150.00", "method": "pix" }
```
- Payload cru SEMPRE gravado em `payment_gateway_events` (auditoria)
- Idempotente: cobrança já paga → evento `ignorado`, responde 200
- Baixa: `payments.is_automatic=true`, billing `pago`, evento `pagamento` na timeline, recibo, WhatsApp

## Regra de inadimplência (reutilizada)
`delinquency.service.isGraveDelinquent()` é chamada por `burials` e `grave-maintenances`
— jazigo com cobrança em atraso não recebe sepultamento nem reforma (admin pode forçar).
