# src/providers/email/

Provider de e-mail no padrão **driver** (mock ↔ real por env), igual aos demais
providers (`whatsapp/`, `payment-gateway/`). Entrega e-mails transacionais já
renderizados — os corpos vêm prontos de `src/emails/render.js` (`renderEmail`
devolve `{ subject, html, text }`).

Regra do projeto: `controller → service → provider`. O service de notificações
consome este provider; nunca chame o provider direto do controller.

## Interface (idêntica entre todos os drivers)

```js
const email = require('./src/providers/email');

email.name; // string do driver ativo: 'mock' | 'smtp' | ...

await email.sendEmail({ to, subject, html, text });
// => { providerMessageId }
```

- `sendEmail({ to, subject, html, text }) => Promise<{ providerMessageId }>`
  - **assíncrono**;
  - **lança em falha** — a fila de notificações depende disso para reter/retentar;
  - retorna o `providerMessageId` do provedor (para rastreio/idempotência).
- `name` — string do driver ativo.

## Seleção de driver

Por `EMAIL_PROVIDER`:

| valor | driver | envio real? | requisitos |
|---|---|---|---|
| `mock` (default fora de produção) | `drivers/mock.js` | não | nenhum — **nunca falha** |
| `smtp` | `drivers/smtp.js` | sim | pacote `nodemailer` + `SMTP_HOST` |

- **Default `mock`** apenas fora de produção. Em produção (`NODE_ENV=production`)
  `EMAIL_PROVIDER` é **obrigatório**: sem ele, falha no carregamento (padrão do
  `src/utils/jwt.js`).
- Driver desconhecido → erro no carregamento.

### Driver `mock`

Não envia nada. Loga `[email:mock] -> to (subject)` e devolve
`{ providerMessageId: 'mock-<timestamp>-<uuid>' }`. Nunca falha. É o default em
dev/teste.

### Driver `smtp` (real, opcional)

Usa [`nodemailer`](https://nodemailer.com), que é uma **dependência opcional** e
**não está no `package.json`** (pertence a outro dono). Para habilitar:

```bash
npm i nodemailer
```

Se `EMAIL_PROVIDER=smtp` e `nodemailer` não estiver instalado, o driver **falha
no carregamento** com mensagem clara. Também exige `SMTP_HOST` (e credenciais
`SMTP_USER`/`SMTP_PASS` quando o servidor pedir). Remetente via `EMAIL_FROM`
(cai em `SMTP_USER` se ausente).

## Novos drivers (SendGrid, SES, ...)

Crie `drivers/<nome>.js` exportando `{ name, async sendEmail(...) }` com a MESMA
interface, adicione o nome à lista `KNOWN` no `index.js`, e — se usar SDK próprio —
faça `try-require` e falhe no carregamento quando a dep/credencial faltar. Nenhuma
feature muda: só o driver.

## Variáveis de ambiente

Ver `.env.example` (seção *E-mail*): `EMAIL_PROVIDER`, `EMAIL_FROM`, `SMTP_HOST`,
`SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`.
