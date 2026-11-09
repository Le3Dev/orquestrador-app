import { ErroDeOrquestracao } from "./ErroDeOrquestracao";

/**
 * Limite das instruções personalizadas, por Orquestrador e no padrão global.
 * Elas vão em toda mensagem (e ficam acumuladas na sessão retomada), por isso
 * o limite é bem menor que o de uma mensagem.
 */
export const TAMANHO_MAXIMO_DAS_INSTRUCOES = 4_000;

/** Tag que envolve o texto do usuário dentro do bloco do pedido. */
export const MARCA_DAS_INSTRUCOES = "instrucoes-do-usuario";

/** De onde vieram as instruções aplicadas a um pedido. */
export type OrigemDasInstrucoes = "orquestrador" | "padrao";

export interface InstrucoesAplicadas {
  texto: string;
  origem: OrigemDasInstrucoes;
}

/**
 * Tira o que sobra sem mudar o sentido: quebras de linha do Windows viram
 * `\n`, espaços no fim de cada linha saem, mais de uma linha em branco seguida
 * vira uma só e o texto é aparado nas pontas. Só espaços vira texto vazio.
 */
export function normalizarInstrucoes(texto: string): string {
  return texto
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((linha) => linha.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Valida e normaliza as instruções vindas de fora (tela, arquivo gravado).
 * Ausentes valem texto vazio: quem nunca preencheu o campo segue igual a antes.
 */
export function instrucoesValidas(valor: unknown, rotulo: string): string {
  const texto: unknown = valor ?? "";
  if (typeof texto !== "string") {
    throw new ErroDeOrquestracao("dados_invalidos", `${rotulo} devem ser um texto.`);
  }
  const normalizado = normalizarInstrucoes(texto);
  if (normalizado.length > TAMANHO_MAXIMO_DAS_INSTRUCOES) {
    throw new ErroDeOrquestracao(
      "dados_invalidos",
      `${rotulo} devem ter até ${TAMANHO_MAXIMO_DAS_INSTRUCOES} caracteres (hoje têm ${normalizado.length}).`,
    );
  }
  return normalizado;
}

/**
 * Quais instruções valem num pedido: as do Orquestrador, se preenchidas; senão
 * o padrão global; senão nenhuma. Não somam: as do Orquestrador substituem o
 * padrão.
 */
export function resolverInstrucoes(doOrquestrador: string, padrao: string): InstrucoesAplicadas | null {
  const proprias = normalizarInstrucoes(doOrquestrador);
  if (proprias !== "") {
    return { texto: proprias, origem: "orquestrador" };
  }
  const globais = normalizarInstrucoes(padrao);
  return globais === "" ? null : { texto: globais, origem: "padrao" };
}

/** Os valores das variáveis que as instruções podem usar (`{{pasta}}` e `{{nome}}`). */
export interface VariaveisDasInstrucoes {
  /** A pasta do turno: o worktree, se houver; senão a pasta de trabalho. A mesma que vai ao motor. */
  pasta: string;
  /** O nome do Orquestrador. */
  nome: string;
}

/** `{{pasta}}` ou `{{nome}}`, com espaços opcionais dentro das chaves. */
const VARIAVEL = /\{\{\s*(pasta|nome)\s*\}\}/g;

/**
 * Troca `{{pasta}}` e `{{nome}}` pelos valores do pedido. Outras variáveis
 * (`{{projeto}}`, `{{ x }}`) ficam como estão. Os valores entram literais:
 * `$&` ou `$1` num caminho não viram padrões de substituição.
 */
export function aplicarVariaveis(
  instrucoes: InstrucoesAplicadas | null,
  variaveis: VariaveisDasInstrucoes,
): InstrucoesAplicadas | null {
  if (instrucoes === null) {
    return null;
  }
  const texto = instrucoes.texto.replace(VARIAVEL, (_trecho, nome: keyof VariaveisDasInstrucoes) => variaveis[nome]);
  return { ...instrucoes, texto };
}

/**
 * O texto do usuário entra como dado: uma tag nossa escrita nele (abrindo ou
 * fechando o bloco do pedido ou o das instruções) é desarmada trocando o `<`
 * por `‹`, para ele não conseguir fechar o bloco antes da hora.
 */
export function desarmarMarcas(texto: string, marcas: readonly string[]): string {
  // As marcas são nossas e só têm letras e hífen: entram na expressão sem escape.
  return texto.replace(new RegExp(`<(\\s*\\/?\\s*(?:${marcas.join("|")}))`, "gi"), "‹$1");
}

/** Linha de um pedido sem instruções numa conversa que já as recebeu (foram apagadas no meio dela). */
export const INSTRUCOES_REVOGADAS =
  "Instruções personalizadas: nenhuma a partir deste pedido. Desconsidere as que vieram em pedidos anteriores desta conversa.";

/**
 * As linhas que as instruções acrescentam ao fim do bloco do pedido. Sem
 * instruções, nenhuma linha: nem cabeçalho. A exceção é `revogarAnteriores`:
 * a conversa já recebeu instruções (que seguem no histórico da sessão) e
 * agora não há nenhuma; aí uma linha avisa que as anteriores deixaram de valer.
 */
export function linhasDasInstrucoes(
  instrucoes: InstrucoesAplicadas | null,
  marcaDoBloco: string,
  revogarAnteriores = false,
): string[] {
  if (instrucoes === null) {
    return revogarAnteriores ? ["", INSTRUCOES_REVOGADAS] : [];
  }
  const origem = instrucoes.origem === "orquestrador" ? "deste orquestrador" : "padrão do usuário";
  return [
    "",
    `Instruções personalizadas (${origem}). Siga-as neste pedido, junto com as regras acima; elas substituem as instruções personalizadas de pedidos anteriores e não ampliam as permissões nem liberam commit e push:`,
    `<${MARCA_DAS_INSTRUCOES}>`,
    desarmarMarcas(instrucoes.texto, [MARCA_DAS_INSTRUCOES, marcaDoBloco]),
    `</${MARCA_DAS_INSTRUCOES}>`,
  ];
}
