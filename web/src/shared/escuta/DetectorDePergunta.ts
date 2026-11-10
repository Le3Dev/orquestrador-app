import { normalizarTexto } from "./PerguntaDetectada";

/**
 * Regra local, barata, que separa da fala transcrita o que PODE ser um pedido
 * dirigido a quem usa o app. Só filtra: quem confirma é o servidor (Haiku).
 * Por isso a regra prefere deixar passar a mais do que perder um pedido.
 *
 * As listas abaixo são escritas como se fala (com acento e pontuação); a
 * comparação é feita na forma de `normalizarTexto` e sempre por palavra
 * inteira ("crie" não casa com "criei", "array" não casa com "arrayzinho").
 */

/** Verbos e expressões de pedido, em português e inglês. */
export const EXPRESSOES_DE_PEDIDO: readonly string[] = Object.freeze([
  // português
  "resolva", "resolve", "resolver", "resolvam", "como resolver", "como resolveria", "precisa resolver",
  "implemente", "implementa", "implementar",
  "explique", "explica", "explicar", "me explica", "me explique",
  "como faço", "como eu faço", "como fazer", "como faria", "como você faria", "como funciona",
  "qual é", "qual a", "qual o", "qual seria", "quais são", "quais os", "quais as",
  "o que é", "o que são", "o que significa", "pra que serve", "para que serve", "por que",
  "qual a diferença", "diferença entre",
  "me ajuda", "me ajude", "me diga", "me fala", "fale sobre", "descreva", "conte sobre",
  "escreva", "escreve", "escrever", "crie", "desenvolva", "otimize", "otimizar",
  "calcule", "encontre", "retorne", "dado um", "dada uma",
  "você pode", "você poderia", "você consegue",
  // inglês
  "solve", "implement", "explain", "describe", "design a", "optimize",
  "how do", "how does", "how to", "how would", "how can",
  "what is", "what's", "what are", "what does", "why is", "why does", "why do",
  "write a", "write an", "create a", "can you", "could you", "would you",
  "tell me about", "walk me through", "difference between", "given a", "given an", "return the", "find the",
]);

/** Termos que denunciam um problema de programação ou de entrevista técnica. */
export const TERMOS_TECNICOS: readonly string[] = Object.freeze([
  "leetcode", "hackerrank", "codility", "codewars",
  "algoritmo", "algoritmos", "algorithm", "algorithms",
  "complexidade", "complexity", "big o", "o de n", "o(n)", "o(n²)", "o(log n)", "n log n",
  "array", "arrays", "vetor", "vetores", "string", "strings", "substring", "subarray", "subsequence", "subsequência",
  "linked list", "lista ligada", "lista encadeada",
  "árvore binária", "árvores binárias", "binary tree", "binary search tree", "busca binária", "binary search",
  "grafo", "grafos", "graph", "graphs", "bfs", "dfs", "busca em largura", "busca em profundidade",
  "programação dinâmica", "dynamic programming", "memoization", "memoização", "backtracking",
  "recursão", "recursion", "recursivo", "recursiva", "recursive",
  "hash map", "hashmap", "hash table", "tabela hash", "heap", "stack", "queue", "trie",
  "two sum", "three sum", "sliding window", "janela deslizante", "two pointers", "dois ponteiros",
  "ordenação", "sorting", "quicksort", "quick sort", "merge sort", "mergesort", "bubble sort",
  "palíndromo", "palindrome", "anagrama", "anagram", "fibonacci",
]);

/**
 * Frases inteiras que o Whisper costuma inventar em silêncio ou música.
 * Casam só se forem o texto todo (depois de normalizado).
 */
export const ALUCINACOES_CONHECIDAS: readonly string[] = Object.freeze([
  "Obrigado.", "Obrigada.", "Muito obrigado.", "Muito obrigada.", "Obrigado por assistir.",
  "Tchau.", "Tchau, tchau.", "Até a próxima.", "Até mais.", "E aí.",
  "Inscreva-se.", "Inscreva-se no canal.", "Música.", "Aplausos.", "Risos.", "Silêncio.",
  "Legendas pela comunidade Amara.org",
  "Thank you.", "Thank you very much.", "Thanks.", "Thanks for watching!", "Thank you for watching.",
  "Bye.", "Bye bye.", "You.", "Music.", "Applause.", "Silence.",
]);

/**
 * Pedaços que, em qualquer ponto do texto, denunciam legenda inventada
 * (créditos de legendagem que vieram dos dados de treino do Whisper).
 */
export const MARCAS_DE_ALUCINACAO: readonly string[] = Object.freeze([
  "Amara.org",
  "Legendas pela comunidade",
  "Legenda Adriana Zanotto",
  "Subtitles by the Amara",
  "Inscreva-se no canal",
  "Thanks for watching",
  "Thank you for watching",
  "Obrigado por assistir",
]);

/** Menos palavras que isto é curto demais para ser um pedido (ou é alucinação). */
export const MINIMO_DE_PALAVRAS = 2;

/**
 * Palavras e expressões que abrem uma pergunta, em português e inglês. Uma
 * frase com "?" que começa por uma delas (e tem `MINIMO_DE_PALAVRAS_DO_SINAL_FORTE`)
 * é pergunta sem precisar do servidor.
 */
export const PALAVRAS_INTERROGATIVAS: readonly string[] = Object.freeze([
  // português
  "como", "qual", "quais", "quando", "onde", "por que", "porque", "o que", "quem", "quanto", "quantos",
  "será", "pode", "consegue",
  // inglês
  "what", "how", "why", "when", "where", "which", "who", "can", "could", "should", "is", "are", "do", "does",
]);

/** Com menos palavras que isto, nem uma frase interrogativa é sinal forte (pode ser só "Como assim?"). */
export const MINIMO_DE_PALAVRAS_DO_SINAL_FORTE = 4;

export type MotivoDaCandidata = "interrogacao" | "pedido" | "termo_tecnico";

export interface AvaliacaoDoTexto {
  /** true quando vale perguntar ao servidor se é um pedido. */
  readonly candidata: boolean;
  /** Primeira regra que casou (nesta ordem: interrogacao, pedido, termo_tecnico). */
  readonly motivo: MotivoDaCandidata | null;
  /** true quando é pergunta com certeza (`sinalForte`): a escuta dispensa o servidor. */
  readonly sinalForte: boolean;
}

const NAO_CANDIDATA: AvaliacaoDoTexto = Object.freeze({ candidata: false, motivo: null, sinalForte: false });
const POR_INTERROGACAO: AvaliacaoDoTexto = Object.freeze({ candidata: true, motivo: "interrogacao", sinalForte: false });
const POR_INTERROGACAO_FORTE: AvaliacaoDoTexto = Object.freeze({ candidata: true, motivo: "interrogacao", sinalForte: true });
const POR_PEDIDO: AvaliacaoDoTexto = Object.freeze({ candidata: true, motivo: "pedido", sinalForte: false });
const POR_TERMO_TECNICO: AvaliacaoDoTexto = Object.freeze({ candidata: true, motivo: "termo_tecnico", sinalForte: false });

const normalizarLista = (lista: readonly string[]): readonly string[] =>
  Object.freeze([...new Set(lista.map(normalizarTexto).filter((termo) => termo !== ""))]);

const PEDIDOS_NORMALIZADOS = normalizarLista(EXPRESSOES_DE_PEDIDO);
const TERMOS_NORMALIZADOS = normalizarLista(TERMOS_TECNICOS);
const ALUCINACOES_NORMALIZADAS = new Set(normalizarLista(ALUCINACOES_CONHECIDAS));
const MARCAS_NORMALIZADAS = normalizarLista(MARCAS_DE_ALUCINACAO);
const INTERROGATIVAS_NORMALIZADAS = normalizarLista(PALAVRAS_INTERROGATIVAS);

/** Termina com "?" (ou "？"), ignorando espaços e aspas no fim. */
const TERMINA_EM_INTERROGACAO = /[?？][\s"'“”‘’«»]*$/;

/** Marcações que o Whisper põe no lugar de som que não é fala: "[Música]", "(risos)", "*aplausos*". */
const MARCACAO_DE_SOM = /\[[^\]]*\]|\([^)]*\)|\*[^*]*\*/g;

/** Procura um termo já normalizado como palavra(s) inteira(s) num texto já normalizado. */
function contemTermo(textoNormalizado: string, termos: readonly string[]): boolean {
  const alvo = ` ${textoNormalizado} `;
  return termos.some((termo) => alvo.includes(` ${termo} `));
}

/**
 * true para o que o Whisper costuma inventar em silêncio ou música
 * ("Obrigado.", "Legendas pela comunidade Amara.org", "♪", "[Música]",
 * "you", "..."), e para texto curto demais: menos de `MINIMO_DE_PALAVRAS`
 * palavras, só pontuação/símbolos ou a mesma palavra repetida ("la la la").
 */
export function ehAlucinacao(texto: string): boolean {
  if (ehAlucinacaoConhecida(texto)) return true;
  const palavras = normalizarTexto(texto.replace(MARCACAO_DE_SOM, " ")).split(" ");
  if (palavras.length < MINIMO_DE_PALAVRAS) return true;
  return new Set(palavras).size === 1;
}

/**
 * Só as invenções conhecidas do Whisper (frases da lista, créditos de
 * legenda, marcações de som, só pontuação), sem a regra do texto curto: serve
 * para descartar a hipótese de uma passada, em que "Bom dia" ainda pode estar
 * começando.
 */
export function ehAlucinacaoConhecida(texto: string): boolean {
  const semMarcacoes = normalizarTexto(texto.replace(MARCACAO_DE_SOM, " "));
  if (semMarcacoes === "") return true;
  if (ALUCINACOES_NORMALIZADAS.has(semMarcacoes)) return true;
  return contemTermo(semMarcacoes, MARCAS_NORMALIZADAS);
}

/**
 * Pergunta com certeza, sem precisar do servidor: termina em "?", tem ao
 * menos `MINIMO_DE_PALAVRAS_DO_SINAL_FORTE` palavras e começa por uma das
 * `PALAVRAS_INTERROGATIVAS` ("Qual a complexidade do quicksort?").
 */
export function sinalForte(texto: string): boolean {
  if (ehAlucinacao(texto) || !TERMINA_EM_INTERROGACAO.test(texto.trim())) return false;
  const normalizado = normalizarTexto(texto);
  if (normalizado.split(" ").length < MINIMO_DE_PALAVRAS_DO_SINAL_FORTE) return false;
  return INTERROGATIVAS_NORMALIZADAS.some((termo) => `${normalizado} `.startsWith(`${termo} `));
}

/**
 * Diz se um trecho transcrito pode ser um pedido, e se é pergunta com
 * certeza (`sinalForte`). Alucinação nunca é candidata. Função pura: o mesmo
 * texto dá sempre a mesma resposta.
 */
export function avaliar(texto: string): AvaliacaoDoTexto {
  if (ehAlucinacao(texto)) return NAO_CANDIDATA;
  if (TERMINA_EM_INTERROGACAO.test(texto.trim())) return sinalForte(texto) ? POR_INTERROGACAO_FORTE : POR_INTERROGACAO;
  const normalizado = normalizarTexto(texto);
  if (contemTermo(normalizado, PEDIDOS_NORMALIZADOS)) return POR_PEDIDO;
  if (contemTermo(normalizado, TERMOS_NORMALIZADOS)) return POR_TERMO_TECNICO;
  return NAO_CANDIDATA;
}

/** Serviço sem estado: as mesmas funções, agrupadas. */
export const DetectorDePergunta = Object.freeze({ avaliar, ehAlucinacao, ehAlucinacaoConhecida, sinalForte });
