'use strict';

/**
 * Índices de performance para join/isolamento a escala (~10k+ registros):
 *  - FKs que ficaram sem índice (joins e checagens de RESTRICT/CASCADE varrem tabela).
 *  - tenant_id em tabelas que ainda não indexavam a coluna de isolamento multi-tenant.
 *
 * Todas as colunas abaixo foram confirmadas nas migrations 20260716000002..000012.
 */

// [tabela, [colunas], nome]
const FK_INDEXES = [
  ['billings', ['maintenance_fee_id'], 'billings_maintenance_fee_id_idx'],
  ['billings', ['original_billing_id'], 'billings_original_billing_id_idx'],
  ['billings', ['cemetery_id'], 'billings_cemetery_id_idx'],
  ['payment_gateway_events', ['billing_id'], 'payment_gateway_events_billing_id_idx'],
  ['documents', ['template_id'], 'documents_template_id_idx'],
  ['documents', ['person_id'], 'documents_person_id_idx'],
  ['documents', ['original_document_id'], 'documents_original_document_id_idx'],
  ['document_signatures', ['signer_person_id'], 'document_signatures_signer_person_id_idx'],
  ['document_signatures', ['signer_user_id'], 'document_signatures_signer_user_id_idx'],
  ['exhumations', ['burial_id'], 'exhumations_burial_id_idx'],
  ['exhumations', ['cemetery_id'], 'exhumations_cemetery_id_idx'],
  ['exhumations', ['destination_grave_id'], 'exhumations_destination_grave_id_idx'],
  ['exhumations', ['destination_ossuary_niche_id'], 'exhumations_destination_ossuary_niche_id_idx'],
  ['remains_deposits', ['exhumation_id'], 'remains_deposits_exhumation_id_idx'],
  ['remains_deposits', ['origin_grave_id'], 'remains_deposits_origin_grave_id_idx'],
  ['concession_transfers', ['from_concession_id'], 'concession_transfers_from_concession_id_idx'],
  ['concession_transfers', ['to_concession_id'], 'concession_transfers_to_concession_id_idx'],
  ['concession_transfers', ['from_person_id'], 'concession_transfers_from_person_id_idx'],
  ['concession_transfers', ['to_person_id'], 'concession_transfers_to_person_id_idx'],
  ['burials', ['cemetery_id'], 'burials_cemetery_id_idx'],
  ['burials', ['declarant_person_id'], 'burials_declarant_person_id_idx'],
  ['maintenance_fees', ['fee_type_id'], 'maintenance_fees_fee_type_id_idx'],
  ['maintenance_fees', ['concession_id'], 'maintenance_fees_concession_id_idx'],
];

// tabelas que possuem tenant_id mas ainda não o indexavam isoladamente
const TENANT_INDEXES = [
  ['orthophotos', 'orthophotos_tenant_id_idx'],
  ['map_paths', 'map_paths_tenant_id_idx'],
  ['blocks', 'blocks_tenant_id_idx'],
  ['streets', 'streets_tenant_id_idx'],
  ['lots', 'lots_tenant_id_idx'],
  ['person_relationships', 'person_relationships_tenant_id_idx'],
  ['concession_transfers', 'concession_transfers_tenant_id_idx'],
  ['ossuaries', 'ossuaries_tenant_id_idx'],
  ['ossuary_niches', 'ossuary_niches_tenant_id_idx'],
  ['remains_deposits', 'remains_deposits_tenant_id_idx'],
  ['payment_gateway_events', 'payment_gateway_events_tenant_id_idx'],
  ['chapels', 'chapels_tenant_id_idx'],
  ['document_signatures', 'document_signatures_tenant_id_idx'],
  ['import_records', 'import_records_tenant_id_idx'],
];

module.exports = {
  async up(queryInterface) {
    for (const [table, columns, name] of FK_INDEXES) {
      await queryInterface.addIndex(table, columns, { name });
    }
    for (const [table, name] of TENANT_INDEXES) {
      await queryInterface.addIndex(table, ['tenant_id'], { name });
    }
  },

  async down(queryInterface) {
    for (const [table, name] of TENANT_INDEXES) {
      await queryInterface.removeIndex(table, name);
    }
    for (const [table, , name] of FK_INDEXES) {
      await queryInterface.removeIndex(table, name);
    }
  },
};
