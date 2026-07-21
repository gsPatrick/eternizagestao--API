'use strict';

/**
 * Provider de WhatsApp (notificações + conexão da instância) — POR CIDADE.
 * -----------------------------------------------------------------------------
 * ABSTRAÇÃO TROCÁVEL. Arquitetura confirmada: UM servidor Evolution central
 * (EVOLUTION_API_URL + EVOLUTION_API_KEY globais) com UMA INSTÂNCIA por cidade
 * (isoladas), nomeada `cidade-<subdomain>`. Trocar de tecnologia (Z-API, Twilio,
 * Meta Cloud) = novo driver em ./drivers, MESMA interface.
 *
 * Seleção do driver (no load):
 *   - EVOLUTION_API_URL presente → driver `evolution` (real).
 *   - ausente                    → driver `mock`.
 *
 * O QUE O MOCK FAZ (e o que NÃO faz mais):
 *   - CONEXÃO (getQrCode/getStatus): continua respondendo com QR placeholder e
 *     `mock:true` — a tela já rotula "modo demonstração", ninguém é enganado.
 *   - ENVIO (sendText): LANÇA AppError('WHATSAPP_NOT_CONFIGURED'). Antes só
 *     logava e devolvia id sintético, e a notificação era gravada como 'enviada'
 *     sem nunca ter saído. Mensagem não entregue tem que virar 'falha'.
 *
 * Interface abstrata (todos recebem o `tenant` — model/objeto com subdomain/id):
 *   instanceNameFor(tenant)            => string  (ex.: 'cidade-saopaulo')
 *   ensureInstance(tenant)             => { instanceName, created }
 *   getQrCode(tenant)                  => { instanceName, qrCode(base64|null), status, mock? }
 *   getStatus(tenant)                  => { instanceName, status('desconectado'|'conectando'|'conectado'), mock? }
 *   sendText(tenant, number, text)     => { providerMessageId }   (lança em falha)
 *   setWebhook(tenant, url)            => { ok }
 *   logout(tenant) / disconnect(tenant)=> { ok }
 *   name                               => string do driver ativo
 */

const driverName = process.env.EVOLUTION_API_URL ? 'evolution' : 'mock';

// eslint-disable-next-line import/no-dynamic-require, global-require
const driver = require(`./drivers/${driverName}`);

module.exports = driver;
