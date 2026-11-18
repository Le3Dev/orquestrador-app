import { ErroDoNavegador } from "./ErroDoNavegador";

export const DIRECOES_DE_ROLAGEM = ["cima", "baixo", "esquerda", "direita"] as const;
export type DirecaoDeRolagem = (typeof DIRECOES_DE_ROLAGEM)[number];

export const TAMANHO_MAXIMO_DO_ENDERECO = 2048;
export const TAMANHO_MAXIMO_DO_TEXTO_DIGITADO = 10_000;
export const TAMANHO_MAXIMO_DO_TEXTO_DE_BUSCA = 200;
export const QUANTIDADE_MAXIMA_DE_ROLAGEM = 20;
export const ESPERA_MAXIMA_EM_MS = 30_000;
export const MAIOR_REF = 100_000;

/**
 * Um comando que o agente manda ao navegador (objeto de valor, imutável). A
 * única forma de obter um é `criarComandoDoNavegador`, que valida e normaliza.
 *
 * - `ref` é o número que `ler_pagina` deu ao elemento; vale até a próxima
 *   leitura ou navegação.
 * - `clicar` leva `ref` OU `texto`; `esperar` leva `ms` OU `texto`.
 */
export type ComandoDoNavegador =
  | { readonly tipo: "abrir"; readonly url: string }
  | { readonly tipo: "ler_pagina" }
  | { readonly tipo: "clicar"; readonly ref: number }
  | { readonly tipo: "clicar"; readonly texto: string }
  | { readonly tipo: "digitar"; readonly texto: string; readonly enviar: boolean; readonly ref?: number }
  | { readonly tipo: "tecla"; readonly nome: string }
  | { readonly tipo: "rolar"; readonly direcao: DirecaoDeRolagem; readonly quantidade: number }
  | { readonly tipo: "capturar_tela" }
  | { readonly tipo: "voltar" }
  | { readonly tipo: "avancar" }
  | { readonly tipo: "recarregar" }
  | { readonly tipo: "esperar"; readonly ms: number }
  | { readonly tipo: "esperar"; readonly texto: string };

export type TipoDoComandoDoNavegador = ComandoDoNavegador["tipo"];

export const TIPOS_DE_COMANDO_DO_NAVEGADOR: readonly TipoDoComandoDoNavegador[] = [
  "abrir",
  "ler_pagina",
  "clicar",
  "digitar",
  "tecla",
  "rolar",
  "capturar_tela",
  "voltar",
  "avancar",
  "recarregar",
  "esperar",
];

// Esquemas que o navegador nunca abre: dizem o motivo em vez de virarem "https://javascript:...".
const ESQUEMAS_RECUSADOS = new Set([
  "file",
  "chrome",
  "chrome-extension",
  "chrome-untrusted",
  "devtools",
  "javascript",
  "data",
  "blob",
  "about",
  "view-source",
  "filesystem",
  "ftp",
  "mailto",
  "tel",
]);

function invalido(mensagem: string): never {
  throw new ErroDoNavegador("comando_invalido", mensagem);
}

function recusado(mensagem: string): never {
  throw new ErroDoNavegador("recusado", mensagem);
}

/**
 * O endereço pronto para abrir: sem esquema vira `https://`; só http e https
 * passam, e sem usuário e senha. Qualquer site vale, inclusive de uma
 * máquina local.
 */
export function normalizarEnderecoDoNavegador(bruto: string): string {
  const texto = bruto.trim();
  if (texto === "") invalido("Informe o endereço (url) da página.");
  if (texto.length > TAMANHO_MAXIMO_DO_ENDERECO) {
    invalido(`O endereço passa de ${TAMANHO_MAXIMO_DO_ENDERECO} caracteres.`);
  }
  const esquema = /^([a-z][a-z0-9+.-]*):/i.exec(texto)?.[1]?.toLowerCase();
  const comBarras = /^[a-z][a-z0-9+.-]*:\/\//i.test(texto);
  if (esquema !== undefined && ESQUEMAS_RECUSADOS.has(esquema)) {
    recusado(`O navegador só abre endereços http e https (recusado: ${esquema}:).`);
  }
  let url: URL;
  try {
    url = new URL(comBarras ? texto : `https://${texto}`);
  } catch {
    return invalido("Endereço inválido. Exemplo: https://exemplo.com/pagina.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    recusado(`O navegador só abre endereços http e https (recusado: ${url.protocol}).`);
  }
  if (url.username !== "" || url.password !== "") {
    recusado("Endereço com usuário e senha não é aceito.");
  }
  return url.href;
}

function registro(bruto: unknown): Record<string, unknown> {
  if (typeof bruto !== "object" || bruto === null || Array.isArray(bruto)) {
    return invalido("O comando do navegador deve ser um objeto.");
  }
  return bruto as Record<string, unknown>;
}

function textoObrigatorio(campo: string, valor: unknown, maximo: number): string {
  if (typeof valor !== "string" || valor.trim() === "") invalido(`Informe "${campo}" (texto não vazio).`);
  if (valor.length > maximo) invalido(`"${campo}" passa de ${maximo} caracteres.`);
  return valor;
}

function refOpcional(valor: unknown): number | undefined {
  if (valor === undefined || valor === null) return undefined;
  if (typeof valor !== "number" || !Number.isInteger(valor) || valor < 1 || valor > MAIOR_REF) {
    invalido('"ref" deve ser o número inteiro de um elemento, como dado por navegador_ler_pagina.');
  }
  return valor;
}

function textoOpcional(campo: string, valor: unknown, maximo: number): string | undefined {
  if (valor === undefined || valor === null) return undefined;
  return textoObrigatorio(campo, valor, maximo);
}

// ── Teclas ────────────────────────────────────────────────────────────────

const NOMES_DE_TECLA = [
  "Enter",
  "Tab",
  "Escape",
  "Backspace",
  "Delete",
  "Space",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  ...Array.from({ length: 12 }, (_, indice) => `F${indice + 1}`),
];

const APELIDOS_DE_TECLA: Readonly<Record<string, string>> = {
  esc: "Escape",
  return: "Enter",
  del: "Delete",
  espaco: "Space",
  up: "ArrowUp",
  down: "ArrowDown",
  left: "ArrowLeft",
  right: "ArrowRight",
  pgup: "PageUp",
  pgdn: "PageDown",
};

const MODIFICADORES: Readonly<Record<string, string>> = {
  ctrl: "Ctrl",
  control: "Ctrl",
  alt: "Alt",
  shift: "Shift",
  meta: "Meta",
  cmd: "Meta",
  command: "Meta",
};

const ORDEM_DOS_MODIFICADORES = ["Ctrl", "Alt", "Shift", "Meta"];

/** "ctrl+a" vira "Ctrl+A"; recusa o que não for uma tecla conhecida. */
export function normalizarNomeDeTecla(bruto: string): string {
  const partes = bruto.trim().split("+");
  const chave = partes.pop() ?? "";
  const modificadores = new Set<string>();
  for (const parte of partes) {
    const modificador = MODIFICADORES[parte.trim().toLowerCase()];
    if (modificador === undefined) {
      invalido(`Modificador de tecla desconhecido: "${parte}". Use Ctrl, Alt, Shift ou Meta.`);
    }
    modificadores.add(modificador);
  }
  const minuscula = chave.toLowerCase();
  const nome =
    NOMES_DE_TECLA.find((candidato) => candidato.toLowerCase() === minuscula) ??
    APELIDOS_DE_TECLA[minuscula] ??
    (/^[A-Za-z0-9]$/.test(chave) ? chave : undefined);
  if (nome === undefined) {
    invalido(
      `Tecla desconhecida: "${bruto}". Use Enter, Tab, Escape, Backspace, Delete, Space, setas (ArrowUp...), Home, End, PageUp, PageDown, F1 a F12, uma letra ou um número, com Ctrl, Alt, Shift ou Meta antes (ex.: Ctrl+A).`,
    );
  }
  const ordenados = ORDEM_DOS_MODIFICADORES.filter((modificador) => modificadores.has(modificador));
  return [...ordenados, nome].join("+");
}

// ── Fábrica ───────────────────────────────────────────────────────────────

function criarClicar(dados: Record<string, unknown>): ComandoDoNavegador {
  const ref = refOpcional(dados["ref"]);
  const texto = textoOpcional("texto", dados["texto"], TAMANHO_MAXIMO_DO_TEXTO_DE_BUSCA);
  if (ref !== undefined && texto !== undefined) invalido('Para clicar, informe só "ref" ou só "texto", não os dois.');
  if (ref !== undefined) return { tipo: "clicar", ref };
  if (texto !== undefined) return { tipo: "clicar", texto };
  return invalido('Para clicar, informe "ref" (de navegador_ler_pagina) ou "texto" do elemento.');
}

function criarDigitar(dados: Record<string, unknown>): ComandoDoNavegador {
  const texto = dados["texto"];
  if (typeof texto !== "string") invalido('Informe "texto" (o que digitar).');
  if (texto.length > TAMANHO_MAXIMO_DO_TEXTO_DIGITADO) {
    invalido(`"texto" passa de ${TAMANHO_MAXIMO_DO_TEXTO_DIGITADO} caracteres.`);
  }
  const enviar = dados["enviar"];
  if (enviar !== undefined && enviar !== null && typeof enviar !== "boolean") invalido('"enviar" deve ser verdadeiro ou falso.');
  const ref = refOpcional(dados["ref"]);
  return {
    tipo: "digitar",
    texto,
    enviar: enviar === true,
    ...(ref !== undefined ? { ref } : {}),
  };
}

function criarRolar(dados: Record<string, unknown>): ComandoDoNavegador {
  const direcao = dados["direcao"];
  if (typeof direcao !== "string" || !(DIRECOES_DE_ROLAGEM as readonly string[]).includes(direcao)) {
    invalido(`"direcao" deve ser uma destas: ${DIRECOES_DE_ROLAGEM.join(", ")}.`);
  }
  const bruta = dados["quantidade"];
  let quantidade = 1;
  if (bruta !== undefined && bruta !== null) {
    if (typeof bruta !== "number" || !Number.isFinite(bruta) || bruta <= 0 || bruta > QUANTIDADE_MAXIMA_DE_ROLAGEM) {
      invalido(`"quantidade" (de telas) deve estar entre 0 e ${QUANTIDADE_MAXIMA_DE_ROLAGEM}.`);
    }
    quantidade = bruta;
  }
  return { tipo: "rolar", direcao: direcao as DirecaoDeRolagem, quantidade };
}

function criarEsperar(dados: Record<string, unknown>): ComandoDoNavegador {
  const ms = dados["ms"] ?? undefined;
  const texto = textoOpcional("texto", dados["texto"], TAMANHO_MAXIMO_DO_TEXTO_DE_BUSCA);
  if (ms !== undefined && texto !== undefined) invalido('Para esperar, informe só "ms" ou só "texto", não os dois.');
  if (texto !== undefined) return { tipo: "esperar", texto };
  if (ms === undefined) return invalido('Para esperar, informe "ms" (milissegundos) ou "texto" que deve aparecer na página.');
  if (typeof ms !== "number" || !Number.isInteger(ms) || ms < 1 || ms > ESPERA_MAXIMA_EM_MS) {
    invalido(`"ms" deve ser um número inteiro entre 1 e ${ESPERA_MAXIMA_EM_MS}.`);
  }
  return { tipo: "esperar", ms };
}

/**
 * Valida o que o agente mandou e devolve o comando imutável.
 *
 * @throws ErroDoNavegador `comando_invalido` (campo faltando ou fora da regra)
 * ou `recusado` (endereço que o navegador não abre).
 */
export function criarComandoDoNavegador(bruto: unknown): ComandoDoNavegador {
  const dados = registro(bruto);
  const tipo = dados["tipo"];
  let comando: ComandoDoNavegador;
  switch (tipo) {
    case "abrir":
      comando = { tipo, url: normalizarEnderecoDoNavegador(textoObrigatorio("url", dados["url"], Number.MAX_SAFE_INTEGER)) };
      break;
    case "clicar":
      comando = criarClicar(dados);
      break;
    case "digitar":
      comando = criarDigitar(dados);
      break;
    case "tecla":
      comando = { tipo, nome: normalizarNomeDeTecla(textoObrigatorio("nome", dados["nome"], 40)) };
      break;
    case "rolar":
      comando = criarRolar(dados);
      break;
    case "esperar":
      comando = criarEsperar(dados);
      break;
    case "ler_pagina":
    case "capturar_tela":
    case "voltar":
    case "avancar":
    case "recarregar":
      comando = { tipo };
      break;
    default:
      return invalido(`Comando desconhecido: ${typeof tipo === "string" ? `"${tipo}"` : "tipo ausente"}.`);
  }
  return Object.freeze(comando);
}
