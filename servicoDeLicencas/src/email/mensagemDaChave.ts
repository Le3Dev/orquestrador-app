import type { Plano } from '../licencas/Plano';
import type { MensagemDeEmail } from './EnviadorDeEmail';

export function mensagemDaChave(args: {
  para: string;
  chave: string;
  plano: Plano;
  urlDeDownload: string;
  urlDoPortal: string;
}): MensagemDeEmail {
  const nomeDoPlano = args.plano === 'anual' ? 'anual' : 'mensal';
  const texto = [
    'Olá!',
    '',
    `Obrigado por assinar o Orquestrador de Agentes (plano ${nomeDoPlano}).`,
    '',
    'Sua chave de licença:',
    '',
    `    ${args.chave}`,
    '',
    'Como ativar:',
    `1. Baixe e instale o aplicativo: ${args.urlDeDownload}`,
    '2. Abra o Orquestrador de Agentes.',
    '3. Na tela de licença, cole a chave acima e clique em Ativar.',
    '',
    'Sua licença vale para um computador por vez. Para trocar de computador, desative-a no antigo antes de ativar no novo.',
    '',
    `Gerenciar assinatura, trocar cartão ou cancelar: ${args.urlDoPortal}`,
    '',
    'Guarde este e-mail: a chave é pessoal.',
  ].join('\n');
  return { para: args.para, assunto: 'Sua chave de licença do Orquestrador de Agentes', texto };
}

/** l***@v***.com.br */
export function mascararEmail(email: string): string {
  const arroba = email.lastIndexOf('@');
  if (arroba < 1) return '***';
  const local = email.slice(0, arroba);
  const dominio = email.slice(arroba + 1);
  const ponto = dominio.indexOf('.');
  const rotulo = ponto === -1 ? dominio : dominio.slice(0, ponto);
  const resto = ponto === -1 ? '' : dominio.slice(ponto);
  return `${local.charAt(0)}***@${rotulo.charAt(0)}***${resto}`;
}