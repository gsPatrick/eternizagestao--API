'use strict';

const { Op } = require('sequelize');
const AppError = require('../../utils/app-error');
const provider = require('../../providers/digital-signature');
const storage = require('../../providers/storage');
const { sequelize, Document, DocumentSignature, Person, Tenant } = require('../../models');

/**
 * Config de assinatura DA CIDADE (server-side, segredo em claro). Lê de
 * `Tenant.settings.integrations.signature` (`{ provider, apiKey, webhookToken }`)
 * — mesmo padrão de `integration-config.js` (que hoje cobre asaas/smtp/whatsapp;
 * NÃO editado aqui). Sem config → forma vazia (provider 'mock', apiKey null) →
 * o resolveDriver cai no driver mock e o dev nunca quebra.
 *
 * TODO(produção — criptografia em repouso): `signature.apiKey`/`webhookToken`
 * ficam em CLARO no JSONB do tenant; cifrar/decifrar antes de produção, como já
 * previsto para asaas.apiKey/smtp.password.
 */
async function getSignatureConfig(tenantId) {
  const empty = { provider: 'mock', apiKey: null, webhookToken: null };
  if (!tenantId) return empty;
  const tenant = await Tenant.findByPk(tenantId, { attributes: ['id', 'settings'] }).catch(() => null);
  if (!tenant) return empty;
  const sig = (tenant.settings && tenant.settings.integrations && tenant.settings.integrations.signature) || {};
  return {
    provider: sig.provider || 'mock',
    apiKey: typeof sig.apiKey === 'string' && sig.apiKey.trim() ? sig.apiKey.trim() : null,
    webhookToken: typeof sig.webhookToken === 'string' && sig.webhookToken.trim() ? sig.webhookToken.trim() : null,
  };
}

// TTL longo (7 dias) para links de documento que saem para fora do painel: o
// destinatário abre o PDF sem sessão (link na notificação) e o provedor externo
// de assinatura baixa o arquivo dentro da janela de assinatura.
const EXTERNAL_LINK_TTL_SECONDS = Number(process.env.DOCUMENT_LINK_TTL_SECONDS || 7 * 24 * 3600);

// Rótulos legíveis por tipo (espelha documents.service) para a mensagem da
// notificação de assinatura.
const TYPE_TITLES = {
  certidao_perpetuidade: 'Certidão de Perpetuidade',
  autorizacao_sepultamento: 'Autorização de Sepultamento',
  autorizacao_exumacao: 'Autorização de Exumação',
  recibo: 'Recibo',
  declaracao: 'Declaração',
  outro: 'Documento',
};

// Notificação 'documento_emitido' com variação de assinatura (fire-and-forget).
// Disparada apenas na transição real do documento para 'assinado' (idempotência
// garantida pelo chamador). Nunca propaga erro ao webhook.
function notifyDocumentSigned(documentId, tenantId) {
  (async () => {
    try {
      const document = await Document.findOne({
        where: { id: documentId, tenantId },
        attributes: ['id', 'tenantId', 'documentType', 'formattedNumber', 'fileUrl', 'personId'],
      });
      if (!document || !document.personId) return; // sem pessoa vinculada — não notifica

      const person = await Person.findOne({
        where: { id: document.personId, tenantId },
        attributes: ['id', 'fullName', 'email', 'whatsapp', 'phonePrimary'],
      });
      if (!person) return;

      const hasEmail = !!person.email;
      const hasWhatsapp = !!(person.whatsapp || person.phonePrimary);
      if (!hasEmail && !hasWhatsapp) return; // sem contato resolvível — não notifica (sem erro)
      const channel = hasEmail ? 'email' : 'whatsapp'; // e-mail se houver, senão whatsapp

      const notifications = require('../notifications/notifications.service');
      await notifications.notify({
        tenantId,
        personId: person.id,
        channel,
        notificationType: 'documento_emitido',
        template: 'document-issued',
        vars: {
          nome: person.fullName,
          tipo_documento: TYPE_TITLES[document.documentType] || 'Documento',
          numero: document.formattedNumber,
          // Link ASSINADO (TTL longo) — o destinatário abre sem sessão; URL crua daria 403.
          cta_url: storage.signedUrl(document.fileUrl, { ttlSeconds: EXTERNAL_LINK_TTL_SECONDS }),
          assinatura: ' e assinada eletronicamente', // variação: assinatura eletrônica
        },
        referenceType: 'documents',
        referenceId: document.id,
      });
    } catch (err) {
      // Contrato: notificação nunca propaga erro ao fluxo do webhook.
      console.error('[document-signatures] notificação de assinatura falhou:', err.message);
    }
  })();
}

async function getDocument(tenantId, documentId) {
  const document = await Document.findOne({ where: { id: documentId, tenantId } });
  if (!document) throw AppError.notFound('Documento não encontrado.');
  return document;
}

// Envia o documento para assinatura eletrônica via provider externo.
async function createSignature(tenantId, documentId, data) {
  const document = await getDocument(tenantId, documentId);
  if (document.status === 'cancelado') {
    throw AppError.conflict('Documento cancelado não pode ser enviado para assinatura.', 'DOCUMENT_CANCELED');
  }

  // Provedor/driver DA CIDADE (settings.integrations.signature). Sem apiKey → mock.
  const signatureConfig = await getSignatureConfig(tenantId);
  const driver = provider.resolveDriver(signatureConfig);

  const envelope = await driver.createEnvelope(signatureConfig, {
    documentId: document.id,
    // O provedor externo baixa o PDF pela URL — precisa vir ASSINADA (TTL longo)
    // ou a rota /files responde 403. Provedor local (mock) ignora o campo.
    fileUrl: storage.signedUrl(document.fileUrl, { ttlSeconds: EXTERNAL_LINK_TTL_SECONDS }),
    signer: { name: data.signerName, email: data.signerEmail, cpf: data.signerCpf },
  });

  const signature = await sequelize.transaction(async (transaction) => {
    const created = await DocumentSignature.create(
      {
        tenantId,
        documentId: document.id,
        signerName: data.signerName,
        signerEmail: data.signerEmail || null,
        signerCpf: data.signerCpf || null,
        signerPersonId: data.signerPersonId || null,
        // Cargo do signatário: sem coluna própria — persistido em `notes` para
        // round-trip com o front sem exigir migration.
        notes: data.signerRole || null,
        provider: driver.name,
        providerEnvelopeId: envelope.envelopeId,
        status: 'enviado',
      },
      { transaction }
    );
    await document.update({ status: 'aguardando_assinatura' }, { transaction });
    return created;
  });

  return { signature, signUrl: envelope.signUrl };
}

async function list(tenantId, documentId) {
  await getDocument(tenantId, documentId);
  return DocumentSignature.findAll({
    where: { tenantId, documentId },
    order: [['createdAt', 'ASC']],
  });
}

/**
 * Ponto de entrada do webhook do provedor de assinatura (espelha o padrão do
 * webhook de pagamentos): valida a assinatura HMAC do corpo bruto, faz o parse
 * e processa. Assinatura inválida → 401; caso contrário responde 200 sempre,
 * mesmo p/ envelope desconhecido.
 * @param {{ rawBody: Buffer|string, signature: string }} params
 */
async function processWebhook({ rawBody, signature } = {}) {
  // Parse ANTES da verificação para descobrir o tenant dono do envelope e assim
  // validar o HMAC com o segredo DA CIDADE (fallback global). O parse é só decode
  // de JSON (não confia no conteúdo); nada é MUTADO antes do verify passar.
  const event = provider.parseWebhookEvent(rawBody);

  let tenantSecret = null;
  if (event) {
    const sig = await DocumentSignature.findOne({
      where: { providerEnvelopeId: event.envelopeId },
      attributes: ['tenantId'],
    });
    if (sig) {
      const cfg = await getSignatureConfig(sig.tenantId);
      tenantSecret = cfg.webhookToken; // null → verifyWebhook usa o segredo global
    }
  }

  if (!provider.verifyWebhook(rawBody, signature, tenantSecret)) {
    throw AppError.unauthorized('Assinatura do webhook inválida.', 'INVALID_WEBHOOK_SIGNATURE');
  }

  if (event) await handleWebhookEvent(event);

  return { received: true };
}

/**
 * Processa evento do webhook do provedor de assinatura.
 * 404-safe: envelope desconhecido apenas retorna (o endpoint responde 200 sempre).
 */
async function handleWebhookEvent(event) {
  const signature = await DocumentSignature.findOne({
    where: { providerEnvelopeId: event.envelopeId },
  });
  if (!signature) return null;

  // Sinaliza a transição REAL do documento p/ 'assinado' (só então notificamos,
  // uma única vez — idempotente a reentregas do webhook para o mesmo envelope).
  let documentJustSigned = false;

  const result = await sequelize.transaction(async (transaction) => {
    if (event.status === 'assinado') {
      await signature.update(
        {
          status: 'assinado',
          signedAt: event.signedAt ? new Date(event.signedAt) : new Date(),
          signatureHash: event.signatureHash || null,
        },
        { transaction }
      );

      // Documento só vira 'assinado' quando TODAS as assinaturas foram concluídas.
      const pending = await DocumentSignature.count({
        where: { documentId: signature.documentId, status: ['pendente', 'enviado'] },
        transaction,
      });
      if (pending === 0) {
        // O filtro status != 'assinado' torna o UPDATE idempotente: só afeta linha
        // quando há transição real; affected > 0 sinaliza que notificar é seguro.
        const [affected] = await Document.update(
          { status: 'assinado' },
          {
            where: {
              id: signature.documentId,
              tenantId: signature.tenantId,
              status: { [Op.ne]: 'assinado' },
            },
            transaction,
          }
        );
        if (affected > 0) documentJustSigned = true;
      }
    } else if (event.status === 'recusado' || event.status === 'expirado') {
      await signature.update({ status: event.status }, { transaction });
    }
    return signature;
  });

  // Notificação 'documento_emitido' (variação assinado) — fora da transação;
  // fire-and-forget e só na transição para 'assinado' (não dispara duas vezes).
  if (documentJustSigned) notifyDocumentSigned(signature.documentId, signature.tenantId);

  return result;
}

/**
 * Simula o retorno do provedor (apenas driver mock) marcando a última assinatura
 * pendente do documento como 'assinado'. Reusa handleWebhookEvent — o mesmo
 * caminho idempotente do webhook — preservando notificação e concorrência.
 * Em produção / provedor real, não é permitido.
 */
async function simulateProviderReturn(tenantId, documentId) {
  // Só permitido quando o driver DA CIDADE é o mock (provedor real → sem simulação).
  const driver = provider.resolveDriver(await getSignatureConfig(tenantId));
  if (driver.name !== 'mock') {
    throw AppError.badRequest(
      'Simulação de assinatura disponível apenas com o provedor mock.',
      'SIGNATURE_SIMULATION_UNAVAILABLE'
    );
  }
  await getDocument(tenantId, documentId);

  const signature = await DocumentSignature.findOne({
    where: { tenantId, documentId, status: ['pendente', 'enviado'] },
    order: [['createdAt', 'DESC']],
  });
  if (!signature) {
    throw AppError.conflict(
      'Nenhuma assinatura pendente para este documento.',
      'NO_PENDING_SIGNATURE'
    );
  }

  const event = provider.parseWebhookEvent({
    envelopeId: signature.providerEnvelopeId,
    status: 'assinado',
    signedAt: new Date().toISOString(),
  });
  await handleWebhookEvent(event);

  return DocumentSignature.findByPk(signature.id);
}

module.exports = { createSignature, list, simulateProviderReturn, processWebhook, handleWebhookEvent };
