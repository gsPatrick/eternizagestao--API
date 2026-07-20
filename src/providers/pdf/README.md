# Provider de PDF

Gera **documentos oficiais em PDF** a partir do HTML branded do órgão gestor
(logo embutida, cabeçalho do cemitério e cores da cidade). Abstração trocável:
a interface é sempre a mesma, o driver concreto é escolhido por env.

## Interface

```js
const pdf = require('../providers/pdf');
const buffer = await pdf.htmlToPdf(html, { format: 'A4', margin });
// buffer: Buffer com os bytes do PDF (começa em "%PDF-")
pdf.resolveDriverName(); // 'puppeteer' | 'fallback' (introspecção)
```

`htmlToPdf` **nunca lança**: se o driver primário falhar, degrada para o fallback.

## Drivers

- **`puppeteer`** (default) — headless Chrome. Fiel ao HTML/cores/logo. O browser
  é um **singleton** lançado sob demanda e reaproveitado entre documentos (cada
  emissão abre apenas uma aba nova). Requer o pacote `puppeteer` + Chromium.
- **`fallback`** — gera um PDF simples com o **texto** extraído do HTML (inclui o
  nome do órgão, o título e o número do documento) **sem browser**. Garante
  `application/pdf` mesmo onde o Chromium não está disponível.

Com `PDF_DRIVER=puppeteer`, se o pacote não carregar ou o Chromium não puder ser
lançado, o provider **cai automaticamente no `fallback`** — a emissão e o
download nunca quebram por causa do PDF (best-effort).

## Variáveis de ambiente

| Env | Default | Descrição |
|-----|---------|-----------|
| `PDF_DRIVER` | `puppeteer` | Driver ativo: `puppeteer` ou `fallback`. |
| `PDF_LAUNCH_TIMEOUT_MS` | `30000` | Timeout do launch do Chromium (ms). |
| `PDF_RENDER_TIMEOUT_MS` | `30000` | Timeout do render/`setContent` da página (ms). |

> A feature `documents` também usa `DOCUMENT_PDF_FORMAT` (default `A4`) ao chamar
> este provider — ver `src/features/documents`.
