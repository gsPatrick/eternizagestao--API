# src/queues/

Camada de filas para escalar (tira trabalho pesado do request). **Redis/BullMQ
são OPCIONAIS**: sem eles, cada job roda de forma **síncrona no próprio request**
(fallback), com comportamento idêntico ao anterior — nada exige infra extra.

## Arquivos

- **`index.js`** — abstração `enqueue()` + registry de handlers + fallback síncrono.
- **`worker.js`** — processo separado que sobe os Workers BullMQ (só roda com Redis).

## Interface (`index.js`)

```js
const { enqueue, registerHandler } = require('../../queues');

// No topo do service: registra o handler (para o worker resolver no load).
registerHandler('minha-fila', 'meu-job', async (payload) => { /* ... */ });

// No request: enfileira (retorna rápido com Redis) OU roda síncrono (sem Redis).
const { enqueued } = await enqueue('minha-fila', 'meu-job', payload, handler);
// enqueued === true  -> job na fila, worker processa
// enqueued === false -> handler já executou aqui (fallback)
```

O handler é SEMPRE o próprio service da feature — o worker nunca duplica regra
de negócio, apenas chama o mesmo código.

Ligado quando: `bullmq` instalado **e** `getRedis()` (config/redis.js) retorna um
cliente (ou seja, `REDIS_URL` definido e `ioredis` instalado). Caso contrário,
`enqueue()` degrada para execução síncrona. Se o enfileiramento falhar em runtime
(Redis caiu), também cai para o fallback síncrono — o request nunca quebra.

## Jobs ligados

| Fila            | Job        | Service                                   |
| --------------- | ---------- | ----------------------------------------- |
| `data-exports`  | `generate` | `data-exports.service` → `generateExport` |
| `imports`       | `commit`   | `imports.service` → `processCommit`       |

## Rodando o worker

O worker é um processo **separado** do servidor HTTP. Com Redis configurado:

```bash
node src/queues/worker.js
```

> O `package.json` é de outro agente; quando o script for adicionado, rode com
> `npm run worker` (equivalente a `node src/queues/worker.js`). Sugestão de script:
> `"worker": "node src/queues/worker.js"`.

Sem `REDIS_URL` (ou sem `bullmq`/`ioredis` instalados) o worker encerra avisando
que não é necessário — o app já processa tudo síncrono no request.

## Candidatos futuros (ver MAPA-DE-FEATURES.md)

- Geração em lote de cobranças (taxas de manutenção com vencimento próximo)
- Envio de notificações WhatsApp (retry com backoff)

Regra: o worker SEMPRE chama o service da feature — nunca duplica regra de negócio.
