import { textosAtuais } from "../idioma/idioma";
import { textosDePaginaDoCanvas } from "../idioma/textos/canvasPagina";

/**
 * Quantos terminais de Orquestrador podem ficar abertos no canvas ao mesmo
 * tempo — o formulário de "Novo orquestrador" (rascunho) conta como um.
 * Trava só da tela: fechar um terminal libera a vaga sem excluir nada.
 *
 * Era 4 enquanto cada terminal abria a sua conexão de eventos (o navegador
 * aceita só 6 por servidor). Com uma conexão só para todos, o número de
 * terminais não pesa mais nas conexões.
 */
export const LIMITE_DE_ORQUESTRADORES_ABERTOS = 20;

/** O aviso, no idioma de agora, mostrado quando alguém tenta abrir mais um terminal sem vaga. */
export function avisoDoLimiteDeOrquestradores(): string {
  return textosAtuais(textosDePaginaDoCanvas).avisoDoLimite(LIMITE_DE_ORQUESTRADORES_ABERTOS);
}

/**
 * Se cabe abrir o terminal pedido. Um Orquestrador que já está aberto sempre
 * cabe (só ganha o foco); `pedido` nulo é um terminal novo (rascunho ou
 * Orquestrador ainda não criado).
 */
export function cabeOutroTerminal(
  abertos: readonly string[],
  rascunhos: readonly string[],
  pedido: string | null,
): boolean {
  if (pedido !== null && abertos.includes(pedido)) {
    return true;
  }
  return abertos.length + rascunhos.length < LIMITE_DE_ORQUESTRADORES_ABERTOS;
}
