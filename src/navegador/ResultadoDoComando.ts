import { ErroDoNavegador } from "./ErroDoNavegador";

/** Um elemento da página que o agente pode acionar, numerado por `ref` pela última leitura. */
export interface ElementoInterativo {
  readonly ref: number;
  /** "link", "botão", "campo", "caixa de seleção", "lista"... */
  readonly tipo: string;
  /** O nome que a pessoa vê: rótulo, texto, placeholder. */
  readonly nome: string;
  /** O que está escrito num campo (nunca o de uma senha). */
  readonly valor?: string;
  /** Para onde um link leva. */
  readonly destino?: string;
  /** "marcado", "desabilitado"... */
  readonly estado?: string;
}

export interface ConteudoDaPagina {
  /** O texto visível, já resumido (`textoTruncado` diz se foi cortado). */
  readonly texto: string;
  readonly textoTruncado: boolean;
  readonly elementos: readonly ElementoInterativo[];
  /** Quantos elementos interativos ficaram de fora da lista por excesso. */
  readonly elementosOmitidos: number;
}

export interface ImagemDaPagina {
  /** Base64 puro, sem o prefixo `data:`. */
  readonly base64: string;
  readonly tipoDeMidia: "image/jpeg" | "image/png";
}

/** O que um comando bem-sucedido devolve: onde o navegador está agora e o que aconteceu. */
export interface ResultadoDoComando {
  readonly url: string;
  readonly titulo: string;
  /** Uma frase curta sobre o que foi feito ("Abriu https://...", "Clicou em [3]..."). */
  readonly mensagem: string;
  /** Só em `ler_pagina`. */
  readonly pagina?: ConteudoDaPagina;
  /** Só em `capturar_tela`. */
  readonly imagem?: ImagemDaPagina;
}

function respostaInvalida(): never {
  throw new ErroDoNavegador("falhou", "O aplicativo devolveu uma resposta inválida do navegador.");
}

function texto(valor: unknown, padrao?: string): string {
  if (typeof valor === "string") return valor;
  if (padrao !== undefined && (valor === undefined || valor === null)) return padrao;
  return respostaInvalida();
}

function textoOpcional(valor: unknown): string | undefined {
  return typeof valor === "string" && valor !== "" ? valor : undefined;
}

function elementoDe(bruto: unknown): ElementoInterativo {
  if (typeof bruto !== "object" || bruto === null) return respostaInvalida();
  const dados = bruto as Record<string, unknown>;
  const ref = dados["ref"];
  if (typeof ref !== "number" || !Number.isInteger(ref)) return respostaInvalida();
  const valor = textoOpcional(dados["valor"]);
  const destino = textoOpcional(dados["destino"]);
  const estado = textoOpcional(dados["estado"]);
  return {
    ref,
    tipo: texto(dados["tipo"], "elemento"),
    nome: texto(dados["nome"], ""),
    ...(valor !== undefined ? { valor } : {}),
    ...(destino !== undefined ? { destino } : {}),
    ...(estado !== undefined ? { estado } : {}),
  };
}

function paginaDe(bruto: unknown): ConteudoDaPagina {
  if (typeof bruto !== "object" || bruto === null) return respostaInvalida();
  const dados = bruto as Record<string, unknown>;
  const elementos = dados["elementos"];
  if (!Array.isArray(elementos)) return respostaInvalida();
  const omitidos = dados["elementosOmitidos"];
  return {
    texto: texto(dados["texto"], ""),
    textoTruncado: dados["textoTruncado"] === true,
    elementos: elementos.map(elementoDe),
    elementosOmitidos: typeof omitidos === "number" && Number.isInteger(omitidos) && omitidos > 0 ? omitidos : 0,
  };
}

function imagemDe(bruto: unknown): ImagemDaPagina {
  if (typeof bruto !== "object" || bruto === null) return respostaInvalida();
  const dados = bruto as Record<string, unknown>;
  const base64 = dados["base64"];
  const tipoDeMidia = dados["tipoDeMidia"];
  if (typeof base64 !== "string" || base64 === "") return respostaInvalida();
  if (tipoDeMidia !== "image/jpeg" && tipoDeMidia !== "image/png") return respostaInvalida();
  return { base64, tipoDeMidia };
}

/**
 * Confere e copia o resultado que veio do aplicativo (processo principal do
 * Electron). A resposta cruza um limite de processo, então nada é presumido.
 *
 * @throws ErroDoNavegador `falhou` se faltar algum campo ou vier com o tipo errado.
 */
export function criarResultadoDoComando(bruto: unknown): ResultadoDoComando {
  if (typeof bruto !== "object" || bruto === null) return respostaInvalida();
  const dados = bruto as Record<string, unknown>;
  const pagina = dados["pagina"] === undefined || dados["pagina"] === null ? undefined : paginaDe(dados["pagina"]);
  const imagem = dados["imagem"] === undefined || dados["imagem"] === null ? undefined : imagemDe(dados["imagem"]);
  return Object.freeze({
    url: texto(dados["url"], ""),
    titulo: texto(dados["titulo"], ""),
    mensagem: texto(dados["mensagem"], ""),
    ...(pagina !== undefined ? { pagina } : {}),
    ...(imagem !== undefined ? { imagem } : {}),
  });
}
