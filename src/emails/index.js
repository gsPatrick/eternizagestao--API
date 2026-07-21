'use strict';

/**
 * Registro de TODOS os disparos de e-mail do sistema.
 * chave → { template (arquivo em ./templates), subject (com {{vars}}), preheader }
 *
 * Para adicionar um novo e-mail: crie ./templates/<nome>.html (só o corpo) e
 * registre aqui. Renderize com require('./render').renderEmail(<chave>, vars, { tenant }).
 */
const EMAILS = {
  // ---- acesso / segurança ----
  activation: {
    template: 'activation',
    subject: 'Ative seu acesso ao Portal da Família',
    preheader: 'Confirme seu acesso para consultar seus jazigos e cobranças.',
  },
  'password-reset': {
    template: 'password-reset',
    subject: 'Redefinição de senha · Eterniza Gestão',
    preheader: 'Crie uma nova senha para sua conta.',
  },
  // Código de 6 dígitos da recuperação de senha (painel e Portal da Família).
  // O código vai no CORPO, nunca no assunto: o assunto aparece em prévia de
  // notificação/tela bloqueada e vazaria o segredo para quem olha o celular.
  'password-reset-code': {
    template: 'password-reset-code',
    subject: 'Código de recuperação de senha · {{tenant_name}}',
    preheader: 'Use o código para criar uma nova senha.',
  },
  'user-invite': {
    template: 'user-invite',
    subject: 'Você foi convidado para o {{tenant_name}}',
    preheader: 'Aceite o convite e defina sua senha.',
  },
  otp: {
    template: 'otp',
    subject: 'Seu código de verificação: {{codigo}}',
    preheader: 'Use o código para concluir sua verificação.',
  },

  // ---- financeiro ----
  'fee-reminder': {
    template: 'fee-reminder',
    subject: 'Sua taxa do jazigo {{jazigo}} vence em {{vencimento}}',
    preheader: 'Emita a 2ª via por PIX ou boleto.',
  },
  'billing-overdue': {
    template: 'billing-overdue',
    subject: 'Cobrança vencida · jazigo {{jazigo}}',
    preheader: 'Regularize para evitar bloqueio de serviços.',
  },
  'payment-confirmed': {
    template: 'payment-confirmed',
    subject: 'Pagamento confirmado · jazigo {{jazigo}}',
    preheader: 'Recebemos seu pagamento. Obrigado!',
  },

  // ---- operação ----
  'schedule-reminder': {
    template: 'schedule-reminder',
    subject: 'Lembrete: {{tipo}} em {{data_hora}}',
    preheader: 'Detalhes da cerimônia agendada.',
  },
  'document-issued': {
    template: 'document-issued',
    subject: '{{tipo_documento}} {{numero}} emitida',
    preheader: 'Seu documento está disponível.',
  },

  // ---- avulsa (mensagem manual) ----
  generic: {
    template: 'generic',
    subject: '{{titulo}}',
    preheader: '',
  },
};

module.exports = { EMAILS };
