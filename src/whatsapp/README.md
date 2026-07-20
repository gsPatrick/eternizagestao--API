# WhatsApp templates (white label por cidade)

Mensagens de WhatsApp em **texto puro** (formato do app: `*negrito*`, quebras de
linha, emojis com moderação), no mesmo padrão de `src/emails`. Cada mensagem se
identifica no topo com a **cidade** (`*{{tenant_name}}*`) — white label.

## Uso

```js
const { renderWhatsapp } = require('./src/whatsapp/render');

const texto = renderWhatsapp('fee-reminder', {
  nome: 'João', jazigo: 'A-12', valor: 'R$ 150,00',
  vencimento: '21/07/2026', cta_url: 'https://cidade.eterniza.app/2via/abc',
}, { tenant }); // tenant.name = nome da cidade
```

- Variáveis ausentes viram string vazia — **nunca vaza `{{...}}`**.
- Linhas em branco órfãs (deixadas por variáveis vazias) são absorvidas.
- Sem `tenant` → cai no rótulo padrão `Eterniza Gestão`.
- As **chaves espelham `src/emails/index.js`**, então
  `notifications.service.templateFor(notificationType)` serve para os dois canais.

## Templates e variáveis

| Chave                | Uso                         | Variáveis usadas |
|----------------------|-----------------------------|------------------|
| `activation`         | ativar acesso ao portal     | `nome`, `cta_url` |
| `password-reset`     | redefinição de senha        | `nome`, `cta_url` |
| `user-invite`        | convite de usuário          | `nome`, `perfil`, `cta_url` |
| `otp`                | código de verificação       | `nome`, `codigo`, `validade` |
| `fee-reminder`       | taxa a vencer               | `nome`, `jazigo`, `valor`, `vencimento`, `cta_url` |
| `billing-overdue`    | cobrança vencida            | `nome`, `jazigo`, `valor`, `vencimento`, `cta_url` |
| `payment-confirmed`  | pagamento / recibo          | `nome`, `jazigo`, `valor`, `recibo`, `cta_url` |
| `schedule-reminder`  | velório / sepultamento      | `nome`, `tipo`, `nome_cerimonia`, `data_hora`, `local` |
| `document-issued`    | autorização / certidão      | `nome`, `tipo_documento`, `numero`, `assinatura`, `cta_url` |
| `generic`            | mensagem avulsa             | `titulo`, `mensagem` |

`{{tenant_name}}` é injetado automaticamente a partir de `tenant.name` em todas.
