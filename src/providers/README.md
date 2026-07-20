# src/providers/

Clientes de sistemas externos — um por pasta: `src/providers/<nome-do-sistema>/`.
Credenciais sempre via `.env` (documentadas em `documentacao/ENV_REFERENCE.md`).

Providers previstos (ver MAPA-DE-FEATURES.md):

| Provider | Uso | Consumido pelas features |
|---|---|---|
| `payment-gateway/` | Gerar boleto/PIX, receber webhooks de baixa | billings, payments |
| `whatsapp/` | Notificações automáticas | notifications |
| `digital-signature/` | Assinatura eletrônica de documentos | documents |
| `storage/` | Upload de arquivos (fotos, ortofotos, PDFs, anexos) | attachments, orthophotos, documents |

Regra: controller → service → provider. Nunca chamar provider direto do controller.

## Verificação de webhooks (HMAC-SHA256)

Providers que recebem webhooks (`payment-gateway/`, `digital-signature/`) expõem:

- `verifyWebhook(rawBody, signatureHeader) => boolean`
- `parseWebhookEvent(rawBodyOrBody) => evento | null`

Contrato:

- O corpo **bruto** do request chega como `Buffer` em `req.rawBody` (capturado pelo
  `verify` do `express.json` na app). É esse Buffer que deve ser assinado/verificado —
  não o objeto já parseado (o `JSON.parse` reordena/normaliza e quebra o HMAC).
- `verifyWebhook` calcula `HMAC-SHA256(rawBody)` usando o segredo do provider como
  chave e compara com o header `x-webhook-signature` (hex) em **tempo constante**
  (`crypto.timingSafeEqual`). Header ausente, tamanho diferente ou qualquer erro => `false`.
- `parseWebhookEvent` aceita o `Buffer` bruto **ou** um objeto já parseado (faz
  `JSON.parse` quando recebe Buffer) e normaliza para o formato interno.

Uso nos services:

```js
if (!provider.verifyWebhook(req.rawBody, req.get('x-webhook-signature'))) {
  // 401 — assinatura inválida
}
const evento = provider.parseWebhookEvent(req.rawBody);
```

Segredos (chave do HMAC), via `.env`, **sem default inseguro**:

- `PAYMENT_GATEWAY_WEBHOOK_SECRET`
- `SIGNATURE_WEBHOOK_SECRET`

Em produção (`NODE_ENV=production`) o módulo **falha no carregamento** se o segredo
faltar. Em desenvolvimento um default é usado apenas para conveniência, com aviso no log.
