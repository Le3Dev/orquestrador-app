import type { ModoDoTurno } from "./api/tipos";

/** Comandos que o prompt do terminal entende, como no Claude Code. */
export type ComandoDoPrompt = "limpar";

/** Começa uma conversa nova; a atual fica arquivada no servidor. */
export const COMANDO_DE_LIMPAR = "/clear";

/** Acima disso (ou com uma lista de 3+ itens), o pedido provavelmente pede um plano antes. */
const TAMANHO_DE_PEDIDO_GRANDE = 400;
const ITENS_DE_LISTA_DE_PEDIDO_GRANDE = 3;
const ITEM_DE_LISTA = /^\s*(?:[-*•]|\d+[.)])\s+\S/;

function normalizar(texto: string): string {
  return texto.trim().toLowerCase();
}

/**
 * O comando que o texto representa, ou `null` se é um pedido comum. Só o
 * comando sozinho conta (com espaços e maiúsculas tolerados): "/clear algo" e
 * "texto /clear" seguem como pedidos.
 */
export function comandoDoPrompt(texto: string): ComandoDoPrompt | null {
  return normalizar(texto) === COMANDO_DE_LIMPAR ? "limpar" : null;
}

/** O texto começa a digitar um comando conhecido ("/", "/cl", "/clear"). */
function digitandoComando(texto: string): boolean {
  const digitado = normalizar(texto);
  return digitado.startsWith("/") && COMANDO_DE_LIMPAR.startsWith(digitado);
}

/**
 * O comando completo para o Tab, quando o texto é o começo de um comando
 * ainda incompleto; `null` quando não há o que completar.
 */
export function completarComando(texto: string): string | null {
  return digitandoComando(texto) && comandoDoPrompt(texto) === null ? COMANDO_DE_LIMPAR : null;
}

/**
 * A dica que aparece enquanto o texto é o começo de um comando; `null` quando
 * não é. Durante um pedido o servidor recusaria limpar a conversa, então a dica
 * avisa em vez de oferecer.
 */
export function dicaDeComando(texto: string, trabalhando: boolean): string | null {
  if (!digitandoComando(texto)) {
    return null;
  }
  if (trabalhando) {
    return `${COMANDO_DE_LIMPAR} — indisponível durante um pedido · esc cancela`;
  }
  // Incompleto, o Enter enviaria o texto como pedido: a dica oferece o Tab.
  const atalho = comandoDoPrompt(texto) === null ? "tab completa" : "enter";
  return `${COMANDO_DE_LIMPAR} — começar uma conversa nova · ${atalho}`;
}

/** Pedido longo ou com uma lista de vários itens: provavelmente uma mudança grande. */
export function pedidoGrande(texto: string): boolean {
  if (texto.trim().length > TAMANHO_DE_PEDIDO_GRANDE) {
    return true;
  }
  return texto.split("\n").filter((linha) => ITEM_DE_LISTA.test(linha)).length >= ITENS_DE_LISTA_DE_PEDIDO_GRANDE;
}

/**
 * Sugestão discreta, em execução, de planejar antes um pedido grande. Não
 * bloqueia nada: só lembra do Shift+Tab.
 */
export function dicaDePedidoGrande(texto: string, modo: ModoDoTurno): string | null {
  return modo === "execucao" && comandoDoPrompt(texto) === null && pedidoGrande(texto)
    ? "pedido grande? shift+tab para planejar antes"
    : null;
}
