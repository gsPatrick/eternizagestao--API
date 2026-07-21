'use strict';

/**
 * Inicialização do Sequelize + carregamento de todos os models + associações.
 *
 * Uso: const { sequelize, Grave, Deceased, ... } = require('./src/models');
 */

const fs = require('fs');
const path = require('path');
const { Sequelize, DataTypes } = require('sequelize');

const env = process.env.NODE_ENV || 'development';
const config = require('../config/database')[env];

const sequelize = new Sequelize(config.database, config.username, config.password, config);

const db = {};
const basename = path.basename(__filename);

// Arquivos utilitários da pasta que NÃO são factories de model.
const NON_MODEL_FILES = new Set(['audit-hooks.js']);

// Carrega todos os models da pasta (um arquivo por entidade)
fs.readdirSync(__dirname)
  .filter((file) => file !== basename && file.endsWith('.js') && !NON_MODEL_FILES.has(file))
  .forEach((file) => {
    const model = require(path.join(__dirname, file))(sequelize, DataTypes);
    db[model.name] = model;
  });

const {
  Tenant,
  User,
  Cemetery,
  Orthophoto,
  MapPath,
  Block,
  Street,
  Lot,
  GraveStatus,
  Grave,
  Person,
  PersonRelationship,
  FamilyPortalAccount,
  Concession,
  ConcessionTransfer,
  Deceased,
  Burial,
  Ossuary,
  OssuaryNiche,
  Exhumation,
  RemainsDeposit,
  GraveEvent,
  GraveMaintenance,
  FeeType,
  MaintenanceFee,
  Billing,
  Payment,
  PaymentGatewayEvent,
  Chapel,
  Schedule,
  DocumentTemplate,
  DocumentSequence,
  Document,
  DocumentSignature,
  Attachment,
  Notification,
  AuditLog,
  ImportBatch,
  ImportRecord,
  DataExport,
  Cartorio,
  FuneralHome,
  Institution,
} = db;

/* =========================================================================
 * ASSOCIAÇÕES
 * ========================================================================= */

// ---------- Plataforma / multi-tenant ----------
Tenant.hasMany(User, { foreignKey: 'tenantId', as: 'users' });
User.belongsTo(Tenant, { foreignKey: 'tenantId', as: 'tenant' });

Tenant.hasMany(Cemetery, { foreignKey: 'tenantId', as: 'cemeteries' });
Cemetery.belongsTo(Tenant, { foreignKey: 'tenantId', as: 'tenant' });

Tenant.hasMany(Person, { foreignKey: 'tenantId', as: 'people' });
Person.belongsTo(Tenant, { foreignKey: 'tenantId', as: 'tenant' });

Tenant.hasMany(Grave, { foreignKey: 'tenantId', as: 'graves' });
Grave.belongsTo(Tenant, { foreignKey: 'tenantId', as: 'tenant' });

Tenant.hasMany(Deceased, { foreignKey: 'tenantId', as: 'deceased' });
Deceased.belongsTo(Tenant, { foreignKey: 'tenantId', as: 'tenant' });

Tenant.hasMany(Billing, { foreignKey: 'tenantId', as: 'billings' });
Billing.belongsTo(Tenant, { foreignKey: 'tenantId', as: 'tenant' });

Tenant.hasMany(GraveStatus, { foreignKey: 'tenantId', as: 'graveStatuses' });
GraveStatus.belongsTo(Tenant, { foreignKey: 'tenantId', as: 'tenant' });

// ---------- Estrutura física ----------
Cemetery.hasMany(Orthophoto, { foreignKey: 'cemeteryId', as: 'orthophotos' });
Orthophoto.belongsTo(Cemetery, { foreignKey: 'cemeteryId', as: 'cemetery' });

Cemetery.hasMany(MapPath, { foreignKey: 'cemeteryId', as: 'mapPaths' });
MapPath.belongsTo(Cemetery, { foreignKey: 'cemeteryId', as: 'cemetery' });

Cemetery.hasMany(Block, { foreignKey: 'cemeteryId', as: 'blocks' });
Block.belongsTo(Cemetery, { foreignKey: 'cemeteryId', as: 'cemetery' });

Block.hasMany(Street, { foreignKey: 'blockId', as: 'streets' });
Street.belongsTo(Block, { foreignKey: 'blockId', as: 'block' });
Street.belongsTo(Cemetery, { foreignKey: 'cemeteryId', as: 'cemetery' });

Street.hasMany(Lot, { foreignKey: 'streetId', as: 'lots' });
Lot.belongsTo(Street, { foreignKey: 'streetId', as: 'street' });
Lot.belongsTo(Cemetery, { foreignKey: 'cemeteryId', as: 'cemetery' });

Cemetery.hasMany(Grave, { foreignKey: 'cemeteryId', as: 'graves' });
Grave.belongsTo(Cemetery, { foreignKey: 'cemeteryId', as: 'cemetery' });

Lot.hasMany(Grave, { foreignKey: 'lotId', as: 'graves' });
Grave.belongsTo(Lot, { foreignKey: 'lotId', as: 'lot' });

GraveStatus.hasMany(Grave, { foreignKey: 'statusId', as: 'graves' });
Grave.belongsTo(GraveStatus, { foreignKey: 'statusId', as: 'status' });

// Jazigo ↔ gavetas (auto-relacionamento)
Grave.hasMany(Grave, { foreignKey: 'parentGraveId', as: 'childGraves' });
Grave.belongsTo(Grave, { foreignKey: 'parentGraveId', as: 'parentGrave' });

// ---------- Pessoas ----------
Person.hasMany(PersonRelationship, { foreignKey: 'personId', as: 'relationships' });
PersonRelationship.belongsTo(Person, { foreignKey: 'personId', as: 'person' });
PersonRelationship.belongsTo(Person, { foreignKey: 'relatedPersonId', as: 'relatedPerson' });

Person.hasOne(FamilyPortalAccount, { foreignKey: 'personId', as: 'portalAccount' });
FamilyPortalAccount.belongsTo(Person, { foreignKey: 'personId', as: 'person' });

// ---------- Concessões ----------
Grave.hasMany(Concession, { foreignKey: 'graveId', as: 'concessions' });
Concession.belongsTo(Grave, { foreignKey: 'graveId', as: 'grave' });

Person.hasMany(Concession, { foreignKey: 'personId', as: 'concessions' });
Concession.belongsTo(Person, { foreignKey: 'personId', as: 'person' });

// responsável legal da concessão (distinto do proprietário/person)
Person.hasMany(Concession, { foreignKey: 'responsiblePersonId', as: 'responsibleConcessions' });
Concession.belongsTo(Person, { foreignKey: 'responsiblePersonId', as: 'responsible' });

Grave.hasMany(ConcessionTransfer, { foreignKey: 'graveId', as: 'concessionTransfers' });
ConcessionTransfer.belongsTo(Grave, { foreignKey: 'graveId', as: 'grave' });
ConcessionTransfer.belongsTo(Concession, { foreignKey: 'fromConcessionId', as: 'fromConcession' });
ConcessionTransfer.belongsTo(Concession, { foreignKey: 'toConcessionId', as: 'toConcession' });
ConcessionTransfer.belongsTo(Person, { foreignKey: 'fromPersonId', as: 'fromPerson' });
ConcessionTransfer.belongsTo(Person, { foreignKey: 'toPersonId', as: 'toPerson' });
ConcessionTransfer.belongsTo(User, { foreignKey: 'registeredByUserId', as: 'registeredBy' });

// ---------- Sepultados e sepultamentos ----------
Grave.hasMany(Deceased, { foreignKey: 'currentGraveId', as: 'currentOccupants' });
Deceased.belongsTo(Grave, { foreignKey: 'currentGraveId', as: 'currentGrave' });
// Responsável explícito pelo sepultado (pessoa) — distinto do proprietário.
Deceased.belongsTo(Person, { foreignKey: 'responsiblePersonId', as: 'responsiblePerson' });

Grave.hasMany(Burial, { foreignKey: 'graveId', as: 'burials' });
Burial.belongsTo(Grave, { foreignKey: 'graveId', as: 'grave' });

Deceased.hasMany(Burial, { foreignKey: 'deceasedId', as: 'burials' });
Burial.belongsTo(Deceased, { foreignKey: 'deceasedId', as: 'deceased' });

Cemetery.hasMany(Burial, { foreignKey: 'cemeteryId', as: 'burials' });
Burial.belongsTo(Cemetery, { foreignKey: 'cemeteryId', as: 'cemetery' });
Burial.belongsTo(Person, { foreignKey: 'declarantPersonId', as: 'declarant' });
Burial.belongsTo(User, { foreignKey: 'registeredByUserId', as: 'registeredBy' });

// ---------- Ossário e exumações ----------
Cemetery.hasMany(Ossuary, { foreignKey: 'cemeteryId', as: 'ossuaries' });
Ossuary.belongsTo(Cemetery, { foreignKey: 'cemeteryId', as: 'cemetery' });

Ossuary.hasMany(OssuaryNiche, { foreignKey: 'ossuaryId', as: 'niches' });
OssuaryNiche.belongsTo(Ossuary, { foreignKey: 'ossuaryId', as: 'ossuary' });

Grave.hasMany(Exhumation, { foreignKey: 'graveId', as: 'exhumations' });
Exhumation.belongsTo(Grave, { foreignKey: 'graveId', as: 'grave' });
Exhumation.belongsTo(Grave, { foreignKey: 'destinationGraveId', as: 'destinationGrave' });
Exhumation.belongsTo(OssuaryNiche, { foreignKey: 'destinationOssuaryNicheId', as: 'destinationNiche' });
Exhumation.belongsTo(Cemetery, { foreignKey: 'cemeteryId', as: 'cemetery' });

Burial.hasMany(Exhumation, { foreignKey: 'burialId', as: 'exhumations' });
Exhumation.belongsTo(Burial, { foreignKey: 'burialId', as: 'burial' });

Deceased.hasMany(Exhumation, { foreignKey: 'deceasedId', as: 'exhumations' });
Exhumation.belongsTo(Deceased, { foreignKey: 'deceasedId', as: 'deceased' });
Exhumation.belongsTo(Person, { foreignKey: 'requestedByPersonId', as: 'requestedBy' });
Exhumation.belongsTo(User, { foreignKey: 'authorizedByUserId', as: 'authorizedBy' });
Exhumation.belongsTo(User, { foreignKey: 'registeredByUserId', as: 'registeredBy' });

Exhumation.hasMany(RemainsDeposit, { foreignKey: 'exhumationId', as: 'remainsDeposits' });
RemainsDeposit.belongsTo(Exhumation, { foreignKey: 'exhumationId', as: 'exhumation' });

Deceased.hasMany(RemainsDeposit, { foreignKey: 'deceasedId', as: 'remainsDeposits' });
RemainsDeposit.belongsTo(Deceased, { foreignKey: 'deceasedId', as: 'deceased' });

OssuaryNiche.hasMany(RemainsDeposit, { foreignKey: 'ossuaryNicheId', as: 'deposits' });
RemainsDeposit.belongsTo(OssuaryNiche, { foreignKey: 'ossuaryNicheId', as: 'niche' });
RemainsDeposit.belongsTo(Grave, { foreignKey: 'originGraveId', as: 'originGrave' });
RemainsDeposit.belongsTo(User, { foreignKey: 'registeredByUserId', as: 'registeredBy' });

// ---------- Histórico do jazigo ----------
Grave.hasMany(GraveEvent, { foreignKey: 'graveId', as: 'events' });
GraveEvent.belongsTo(Grave, { foreignKey: 'graveId', as: 'grave' });
GraveEvent.belongsTo(User, { foreignKey: 'registeredByUserId', as: 'registeredBy' });

Grave.hasMany(GraveMaintenance, { foreignKey: 'graveId', as: 'maintenances' });
GraveMaintenance.belongsTo(Grave, { foreignKey: 'graveId', as: 'grave' });
GraveMaintenance.belongsTo(Person, { foreignKey: 'requestedByPersonId', as: 'requestedBy' });
GraveMaintenance.belongsTo(User, { foreignKey: 'registeredByUserId', as: 'registeredBy' });

// ---------- Financeiro ----------
Tenant.hasMany(FeeType, { foreignKey: 'tenantId', as: 'feeTypes' });
FeeType.belongsTo(Tenant, { foreignKey: 'tenantId', as: 'tenant' });

FeeType.hasMany(MaintenanceFee, { foreignKey: 'feeTypeId', as: 'maintenanceFees' });
MaintenanceFee.belongsTo(FeeType, { foreignKey: 'feeTypeId', as: 'feeType' });

Grave.hasMany(MaintenanceFee, { foreignKey: 'graveId', as: 'maintenanceFees' });
MaintenanceFee.belongsTo(Grave, { foreignKey: 'graveId', as: 'grave' });

Concession.hasMany(MaintenanceFee, { foreignKey: 'concessionId', as: 'maintenanceFees' });
MaintenanceFee.belongsTo(Concession, { foreignKey: 'concessionId', as: 'concession' });

Person.hasMany(MaintenanceFee, { foreignKey: 'payerPersonId', as: 'maintenanceFees' });
MaintenanceFee.belongsTo(Person, { foreignKey: 'payerPersonId', as: 'payer' });

MaintenanceFee.hasMany(Billing, { foreignKey: 'maintenanceFeeId', as: 'billings' });
Billing.belongsTo(MaintenanceFee, { foreignKey: 'maintenanceFeeId', as: 'maintenanceFee' });

Person.hasMany(Billing, { foreignKey: 'payerPersonId', as: 'billings' });
Billing.belongsTo(Person, { foreignKey: 'payerPersonId', as: 'payer' });

Grave.hasMany(Billing, { foreignKey: 'graveId', as: 'billings' });
Billing.belongsTo(Grave, { foreignKey: 'graveId', as: 'grave' });
Billing.belongsTo(Cemetery, { foreignKey: 'cemeteryId', as: 'cemetery' });

// 2ª via de cobrança
Billing.hasMany(Billing, { foreignKey: 'originalBillingId', as: 'reissues' });
Billing.belongsTo(Billing, { foreignKey: 'originalBillingId', as: 'originalBilling' });

Billing.hasMany(Payment, { foreignKey: 'billingId', as: 'payments' });
Payment.belongsTo(Billing, { foreignKey: 'billingId', as: 'billing' });
Payment.belongsTo(User, { foreignKey: 'registeredByUserId', as: 'registeredBy' });

Billing.hasMany(PaymentGatewayEvent, { foreignKey: 'billingId', as: 'gatewayEvents' });
PaymentGatewayEvent.belongsTo(Billing, { foreignKey: 'billingId', as: 'billing' });

// ---------- Agendamentos ----------
Cemetery.hasMany(Chapel, { foreignKey: 'cemeteryId', as: 'chapels' });
Chapel.belongsTo(Cemetery, { foreignKey: 'cemeteryId', as: 'cemetery' });

Cemetery.hasMany(Schedule, { foreignKey: 'cemeteryId', as: 'schedules' });
Schedule.belongsTo(Cemetery, { foreignKey: 'cemeteryId', as: 'cemetery' });

Chapel.hasMany(Schedule, { foreignKey: 'chapelId', as: 'schedules' });
Schedule.belongsTo(Chapel, { foreignKey: 'chapelId', as: 'chapel' });
Schedule.belongsTo(Grave, { foreignKey: 'graveId', as: 'grave' });
Schedule.belongsTo(Deceased, { foreignKey: 'deceasedId', as: 'deceased' });
Schedule.belongsTo(Exhumation, { foreignKey: 'exhumationId', as: 'exhumation' });
Schedule.belongsTo(Person, { foreignKey: 'responsiblePersonId', as: 'responsible' });
Schedule.belongsTo(User, { foreignKey: 'createdByUserId', as: 'createdBy' });

// ---------- Documentos ----------
Tenant.hasMany(DocumentTemplate, { foreignKey: 'tenantId', as: 'documentTemplates' });
DocumentTemplate.belongsTo(Tenant, { foreignKey: 'tenantId', as: 'tenant' });

Tenant.hasMany(DocumentSequence, { foreignKey: 'tenantId', as: 'documentSequences' });
DocumentSequence.belongsTo(Tenant, { foreignKey: 'tenantId', as: 'tenant' });

DocumentTemplate.hasMany(Document, { foreignKey: 'templateId', as: 'documents' });
Document.belongsTo(DocumentTemplate, { foreignKey: 'templateId', as: 'template' });

Grave.hasMany(Document, { foreignKey: 'graveId', as: 'documents' });
Document.belongsTo(Grave, { foreignKey: 'graveId', as: 'grave' });

Deceased.hasMany(Document, { foreignKey: 'deceasedId', as: 'documents' });
Document.belongsTo(Deceased, { foreignKey: 'deceasedId', as: 'deceased' });

Person.hasMany(Document, { foreignKey: 'personId', as: 'documents' });
Document.belongsTo(Person, { foreignKey: 'personId', as: 'person' });
Document.belongsTo(User, { foreignKey: 'issuedByUserId', as: 'issuedBy' });

// 2ª via de documento
Document.hasMany(Document, { foreignKey: 'originalDocumentId', as: 'reissues' });
Document.belongsTo(Document, { foreignKey: 'originalDocumentId', as: 'originalDocument' });

Document.hasMany(DocumentSignature, { foreignKey: 'documentId', as: 'signatures' });
DocumentSignature.belongsTo(Document, { foreignKey: 'documentId', as: 'document' });
DocumentSignature.belongsTo(Person, { foreignKey: 'signerPersonId', as: 'signerPerson' });
DocumentSignature.belongsTo(User, { foreignKey: 'signerUserId', as: 'signerUser' });

// ---------- Suporte / transversais ----------
Attachment.belongsTo(Tenant, { foreignKey: 'tenantId', as: 'tenant' });
Attachment.belongsTo(User, { foreignKey: 'uploadedByUserId', as: 'uploadedBy' });

Notification.belongsTo(Tenant, { foreignKey: 'tenantId', as: 'tenant' });
Notification.belongsTo(Person, { foreignKey: 'recipientPersonId', as: 'recipientPerson' });
Notification.belongsTo(User, { foreignKey: 'recipientUserId', as: 'recipientUser' });

AuditLog.belongsTo(Tenant, { foreignKey: 'tenantId', as: 'tenant' });
AuditLog.belongsTo(User, { foreignKey: 'userId', as: 'user' });
AuditLog.belongsTo(FamilyPortalAccount, { foreignKey: 'portalAccountId', as: 'portalAccount' });

ImportBatch.belongsTo(Tenant, { foreignKey: 'tenantId', as: 'tenant' });
ImportBatch.belongsTo(Cemetery, { foreignKey: 'cemeteryId', as: 'cemetery' });
ImportBatch.belongsTo(User, { foreignKey: 'createdByUserId', as: 'createdBy' });

ImportBatch.hasMany(ImportRecord, { foreignKey: 'importBatchId', as: 'records' });
ImportRecord.belongsTo(ImportBatch, { foreignKey: 'importBatchId', as: 'batch' });

DataExport.belongsTo(Tenant, { foreignKey: 'tenantId', as: 'tenant' });
DataExport.belongsTo(Cemetery, { foreignKey: 'cemeteryId', as: 'cemetery' });
DataExport.belongsTo(User, { foreignKey: 'requestedByUserId', as: 'requestedBy' });

// ---------- Cadastros de referência "Básico" (por cidade / tenant) ----------
Tenant.hasMany(Cartorio, { foreignKey: 'tenantId', as: 'cartorios' });
Cartorio.belongsTo(Tenant, { foreignKey: 'tenantId', as: 'tenant' });

Tenant.hasMany(FuneralHome, { foreignKey: 'tenantId', as: 'funeralHomes' });
FuneralHome.belongsTo(Tenant, { foreignKey: 'tenantId', as: 'tenant' });

Tenant.hasMany(Institution, { foreignKey: 'tenantId', as: 'institutions' });
Institution.belongsTo(Tenant, { foreignKey: 'tenantId', as: 'tenant' });

db.sequelize = sequelize;
db.Sequelize = Sequelize;

module.exports = db;

/* =========================================================================
 * MOTOR DE AUDITORIA — hooks globais afterCreate/afterUpdate/afterDestroy.
 * Fica DEPOIS de `module.exports = db` para que o audit.service (require'd
 * pelos hooks) enxergue o `db` já totalmente exportado, evitando o ciclo
 * models → audit-hooks → audit.service → models.
 * ========================================================================= */
require('./audit-hooks').attachAuditHooks(sequelize);
