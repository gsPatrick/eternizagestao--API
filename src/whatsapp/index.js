'use strict';

/**
 * Registro de TODOS os disparos de WhatsApp do sistema (white label por cidade).
 * chave → texto do template (WhatsApp puro: *negrito*, quebras de linha, emojis
 * com moderação). Variáveis usam a sintaxe {{chave}} e são preenchidas pelo
 * ./render.js — o MESMO conjunto de vars dos e-mails (src/emails).
 *
 * Toda mensagem começa se identificando com a CIDADE (`*{{tenant_name}}*`) para
 * a família saber quem está falando. As chaves espelham src/emails/index.js, de
 * modo que `templateFor(notificationType)` serve para os dois canais.
 *
 * Para adicionar um disparo: registre a chave aqui (e a correspondente no e-mail).
 * Renderize com require('./render').renderWhatsapp(<chave>, vars, { tenant }).
 */

const WHATSAPP = {
  // ---- acesso / segurança ----
  activation: [
    '*{{tenant_name}}*',
    '',
    'Olá, {{nome}} 👋',
    'Seu acesso ao *Portal da Família* está quase pronto.',
    '',
    'Confirme para consultar seus jazigos, o histórico dos seus sepultados e emitir a 2ª via de cobranças:',
    '{{cta_url}}',
    '',
    'O link expira em 24 horas. Se não foi você, ignore esta mensagem.',
  ].join('\n'),

  'password-reset': [
    '*{{tenant_name}}*',
    '',
    'Olá, {{nome}} 👋',
    'Recebemos um pedido para redefinir a senha da sua conta.',
    '',
    'Crie uma nova senha:',
    '{{cta_url}}',
    '',
    'O link expira em 1 hora. Se não foi você, sua senha continua segura.',
  ].join('\n'),

  'user-invite': [
    '*{{tenant_name}}*',
    '',
    'Olá, {{nome}} 👋',
    'Você foi convidado(a) para acessar o *{{tenant_name}}* com o perfil *{{perfil}}*.',
    '',
    'Aceite o convite e defina sua senha:',
    '{{cta_url}}',
    '',
    'O link expira em 7 dias.',
  ].join('\n'),

  otp: [
    '*{{tenant_name}}*',
    '',
    'Olá, {{nome}}!',
    'Seu código de verificação é *{{codigo}}*.',
    'Válido por {{validade}}.',
    '',
    '🔒 Nunca compartilhe este código com ninguém.',
  ].join('\n'),

  // ---- financeiro ----
  'fee-reminder': [
    '*{{tenant_name}}*',
    '',
    'Olá, {{nome}} 👋',
    'A taxa de manutenção do jazigo *{{jazigo}}* vence em *{{vencimento}}*.',
    'Valor: *{{valor}}*.',
    '',
    'Emita a 2ª via (PIX ou boleto):',
    '{{cta_url}}',
    '',
    'O pagamento é confirmado automaticamente em alguns minutos.',
  ].join('\n'),

  'billing-overdue': [
    '*{{tenant_name}}*',
    '',
    'Olá, {{nome}}.',
    'A taxa do jazigo *{{jazigo}}* está *vencida* (venceu em {{vencimento}}).',
    'Valor atualizado (com multa e juros): *{{valor}}*.',
    '',
    'Regularize para evitar o bloqueio de serviços no jazigo:',
    '{{cta_url}}',
  ].join('\n'),

  'payment-confirmed': [
    '*{{tenant_name}}*',
    '',
    'Olá, {{nome}}! ✅',
    'Recebemos o pagamento da taxa do jazigo *{{jazigo}}*.',
    'Valor pago: *{{valor}}*.',
    'Recibo: {{recibo}}',
    '',
    'Obrigado! Veja o comprovante:',
    '{{cta_url}}',
  ].join('\n'),

  // ---- operação ----
  'schedule-reminder': [
    '*{{tenant_name}}*',
    '',
    'Olá, {{nome}} 👋',
    'Passando para lembrar do seguinte agendamento:',
    '',
    '📅 *{{tipo}}* · {{nome_cerimonia}}',
    '🕒 {{data_hora}}',
    '📍 {{local}}',
    '',
    'Em caso de dúvida, fale com a administração do cemitério.',
  ].join('\n'),

  'document-issued': [
    '*{{tenant_name}}*',
    '',
    'Olá, {{nome}}! 📄',
    'A *{{tipo_documento}}* nº *{{numero}}* foi emitida{{assinatura}}.',
    '',
    'Acesse o documento:',
    '{{cta_url}}',
  ].join('\n'),

  // ---- avulsa (mensagem manual) ----
  generic: [
    '*{{tenant_name}}*',
    '',
    '{{titulo}}',
    '',
    '{{mensagem}}',
  ].join('\n'),
};

module.exports = { WHATSAPP };
