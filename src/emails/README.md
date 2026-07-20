# E-mails do sistema

Templates HTML de **todos os disparos de e-mail** do Eterniza Gestão, com a marca
do sistema (o mesmo visual navy do login/gate no cabeçalho) e **white label** por
tenant (o cabeçalho e os botões usam a cor primária do cliente).

## Estrutura

```
src/emails/
├─ layout.html          # moldura: cabeçalho da marca + rodapé (recebe {{body}})
├─ templates/*.html     # o CORPO de cada disparo (só o miolo)
├─ index.js             # registro: chave → { template, subject, preheader }
├─ render.js            # renderEmail(nome, vars, { tenant }) → { subject, html, text }
└─ README.md
```

## Uso

```js
const { renderEmail } = require('./src/emails/render');

const { subject, html, text } = renderEmail('fee-reminder', {
  nome: 'João Carlos',
  jazigo: 'A-12',
  valor: 'R$ 150,00',
  vencimento: '21/07/2026',
  cta_url: 'https://guarulhos.eterniza.com.br/2via/abc',
}, { tenant }); // tenant.primaryColor tinge o cabeçalho e os botões

await mailProvider.send({ to, subject, html, text });
```

Variáveis usam `{{chave}}`. Faltando uma variável, o render substitui por vazio
(nunca vaza `{{...}}`). O ano do rodapé e o pré-header são preenchidos sozinhos.

## Disparos disponíveis (chaves de `index.js`)

| Chave | Quando | Variáveis principais |
|---|---|---|
| `activation` | Ativação do Portal da Família | nome, cta_url |
| `password-reset` | Esqueci a senha | nome, cta_url |
| `user-invite` | Convite de usuário da equipe | nome, perfil, convidado_por, cta_url |
| `otp` | Código de verificação | nome, codigo, validade |
| `fee-reminder` | Lembrete de vencimento de taxa | nome, jazigo, valor, vencimento, cta_url |
| `billing-overdue` | Cobrança vencida | nome, jazigo, valor, vencimento, cta_url |
| `payment-confirmed` | Pagamento confirmado (recibo) | nome, jazigo, valor, recibo, cta_url |
| `schedule-reminder` | Lembrete de velório/sepultamento | nome, tipo, nome_cerimonia, data_hora, local |
| `document-issued` | Documento emitido/assinado | nome, tipo_documento, numero, cta_url |
| `generic` | Notificação avulsa (manual) | titulo, mensagem, cta_bloco (opcional) |

## Boas práticas de e-mail já aplicadas

- Layout em **tabelas** com **estilos inline** (compatível com Outlook/Gmail/Apple Mail).
- Largura fixa 600px, responsivo, `max-width` seguro.
- **Pré-header** invisível (prévia na caixa de entrada).
- Emblema em **texto** (◎), sem imagem — nunca quebra.
- Gradiente navy com **fallback sólido** (`background-color` + `background-image`).
- Versão **texto puro** gerada automaticamente (`text`).

## Próximo passo (envio real)

Falta o **provider de e-mail** (SMTP/SendGrid/SES) no padrão driver de
`src/providers/`. Quando existir, o service de notificações chama `renderEmail(...)`
e entrega `{ subject, html, text }` ao provider — de preferência **via fila**
(BullMQ) para disparos em massa não travarem o request.
