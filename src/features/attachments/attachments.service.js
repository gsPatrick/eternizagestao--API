'use strict';

const AppError = require('../../utils/app-error');
const { getPagination, buildPageMeta } = require('../../utils/pagination');
const storage = require('../../providers/storage');
const { Attachment } = require('../../models');

// Serializa um Attachment trocando o fileUrl cru (/files/...) pela URL ASSINADA
// (preview/download no painel). TTL padrão (documento — 1h): a UI recarrega a lista.
function serializeAttachment(att) {
  if (!att) return att;
  const json = typeof att.toJSON === 'function' ? att.toJSON() : { ...att };
  if (json.fileUrl) json.fileUrl = storage.signedUrl(json.fileUrl);
  return json;
}

// entidades que aceitam anexos (whitelist — evita lixo polimórfico)
const ATTACHABLE_TYPES = [
  'grave', 'deceased', 'person', 'exhumation', 'burial', 'concession',
  'billing', 'payment', 'grave_maintenance', 'document', 'tenant', 'cemetery',
];

async function list(tenantId, query) {
  if (!query.attachableType || !query.attachableId) {
    throw AppError.badRequest('Informe attachableType e attachableId.', 'MISSING_TARGET');
  }
  const { page, perPage, limit, offset } = getPagination(query, { defaultPerPage: 50 });
  const { rows, count } = await Attachment.findAndCountAll({
    where: { tenantId, attachableType: query.attachableType, attachableId: query.attachableId },
    limit, offset,
    order: [['createdAt', 'DESC']],
  });
  return { rows: rows.map(serializeAttachment), meta: buildPageMeta(count, page, perPage) };
}

async function create(tenantId, data, userId) {
  if (!ATTACHABLE_TYPES.includes(data.attachableType)) {
    throw AppError.badRequest(
      `attachableType inválido. Permitidos: ${ATTACHABLE_TYPES.join(', ')}`,
      'INVALID_ATTACHABLE_TYPE'
    );
  }
  const saved = await storage.saveFile({
    tenantId,
    fileName: data.fileName,
    contentBase64: data.contentBase64,
    mimeType: data.mimeType,
  });
  const attachment = await Attachment.create({
    tenantId,
    attachableType: data.attachableType,
    attachableId: data.attachableId,
    category: data.category || 'outro',
    fileName: data.fileName,
    fileUrl: saved.fileUrl,
    mimeType: saved.mimeType,
    sizeBytes: saved.sizeBytes,
    description: data.description,
    uploadedByUserId: userId,
  });
  return serializeAttachment(attachment);
}

async function remove(tenantId, id) {
  const attachment = await Attachment.findOne({ where: { id, tenantId } });
  if (!attachment) throw AppError.notFound('Anexo não encontrado.');
  // fileUrl local tem formato /files/<storagePath> — deriva o caminho físico
  if (attachment.fileUrl?.startsWith(`${storage.PUBLIC_PREFIX}/`)) {
    const storagePath = attachment.fileUrl.slice(storage.PUBLIC_PREFIX.length + 1);
    await storage.deleteFile(storagePath).catch(() => {});
  }
  await attachment.destroy();
}

module.exports = { list, create, remove, ATTACHABLE_TYPES };
