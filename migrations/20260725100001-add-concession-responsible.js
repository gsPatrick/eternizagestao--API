'use strict';

/**
 * Responsável legal da concessão. §3.2 do briefing: "Registro de
 * concessionário/responsável". A concessão já tem `person_id` (o
 * concessionário/PROPRIETÁRIO); esta coluna guarda o RESPONSÁVEL legal pelo
 * jazigo — quem responde por manutenção, contato e obrigações — que pode ser
 * uma pessoa distinta do proprietário. É isso que diferencia as views
 * /painel/proprietarios (person_id) e /painel/responsaveis (responsible_person_id).
 *
 * Nullable (nem toda concessão nomeia um responsável distinto). Idempotente.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('concessions');
    if (!table.responsible_person_id) {
      await queryInterface.addColumn('concessions', 'responsible_person_id', {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'people', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('concessions');
    if (table.responsible_person_id) {
      await queryInterface.removeColumn('concessions', 'responsible_person_id');
    }
  },
};
