# src/providers/email/

Provider de e-mail no padrão **driver**, igual aos demais providers (`whatsapp/`,
`payment-gateway/`). Entrega e-mails transacionais já renderizados — os corpos
vêm prontos de `src/emails/render.js` (`renderEmail` devolve `{ subject, html, text }`).

Regra do projeto: `controller → service → provider`. O service de notificações
consome este provider; nunca chame o provider direto do controller.

## Interface

```js
const email = require('./src/providers/email');

email.resolveDriver(tenantSmtp).name; // 'smtp' | 'resend' | 'mock'
email.isConfigured(tenantSmtp);       // há caminho REAL de envio?

await email.sendEmail(tenantSmtp, { to, subject, html, text });
// => { providerMessageId }   |   lança AppError('EMAIL_NOT_CONFIGURED') se não configurado
```

- `sendEmail(tenantSmtp, { to, subject, html, text }) => Promise<{ providerMessageId }>`
  - **assíncrono**;
  - **lança em falha** — a fila de notificações depende disso para reter/retentar;
  - retorna o `providerMessageId` do provedor (para rastreio/idempotência).

`tenantSmtp` = `{ host, port, secure, user, password, fromName, fromEmail }`, vindo
de `features/tenants/integration-config.js` (`getIntegrationConfig`).

## Seleção de driver (por CHAMADA, precedência)

| ordem | driver | quando | envio real? |
|---|---|---|---|
| 1 | `smtp` (`drivers/smtp.js`) | a CIDADE tem SMTP salvo (host preenchido) | sim |
| 2 | `resend` (`drivers/resend.js`) | há `RESEND_API_KEY` na plataforma | sim |
| 3 | `mock` (`drivers/mock.js`) | nenhum dos dois | **não — recusa** |

Não existe `EMAIL_PROVIDER`: a escolha é derivada da config, não de env.

### Driver `mock` — sentinela de "não configurado"

Não envia nada e **não é um caminho de envio**: quando `resolveDriver` cai nele,
`sendEmail` lança `AppError(503, 'EMAIL_NOT_CONFIGURED')`. Antes ele devolvia um
`providerMessageId` sintético e a notificação era gravada como `enviada` sem que
ninguém recebesse nada — mentira que agora vira `falha` com a instrução de
configuração no `errorMessage`.

### Driver `smtp` (real)

Usa [`nodemailer`](https://nodemailer.com), **dependência opcional** (carregada
com `try-require` memoizado). Sem ela, o provider registra o aviso e segue a
precedência (Resend → mock/recusa).

### Driver `resend` (real, da plataforma)

Remetente da PLATAFORMA (convites/onboarding do super_admin). Ativado por
`RESEND_API_KEY`; remetente ajustável por `EMAIL_FROM` / `EMAIL_FROM_NAME`.

## Novos drivers (SendGrid, SES, ...)

Crie `drivers/<nome>.js` exportando `{ name, async sendEmail(config, message) }`
com a MESMA interface e adicione um branch em `resolveDriver`. Nenhuma feature
muda: só o driver.

## Variáveis de ambiente

Ver `.env.example` (seção *E-mail*): `RESEND_API_KEY`, `EMAIL_FROM`,
`EMAIL_FROM_NAME`. O SMTP **por cidade** não vem de env — é salvo no painel em
Configurações › Integrações.
