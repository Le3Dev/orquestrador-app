/**
 * Endereços locais (servidores de desenvolvimento) que aparecem na saída das
 * ferramentas: é o que alimenta a prévia ao vivo na tela.
 */

/** Sequências de cor e cursor do terminal: o Vite, por exemplo, pinta a porta. */
const CODIGOS_ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;

/** Só hosts da própria máquina, sempre com porta; o caminho é opcional. */
const ENDERECO_LOCAL =
  /\bhttps?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]):\d{1,5}(?![\w$-])(?:\/[^\s"'<>`]*)?/gi;

/** Pontuação que fecha a frase (ou o negrito e o código do Markdown) em volta do endereço, não faz parte dele. */
const PONTUACAO_FINAL = /[.,;:!?)\]}'"*~]+$/;

/** Lixo de template literal (`${v}`) de um trecho de código: o endereço inteiro é recusado. */
const LIXO_DE_TEMPLATE = /[${}]/;

const HOSTS_DA_MAQUINA = /^(https?:\/\/)(?:127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?=:)/i;

function normalizar(endereco: string): string | null {
  if (LIXO_DE_TEMPLATE.test(endereco)) {
    return null;
  }
  const semPontuacao = endereco.replace(PONTUACAO_FINAL, "");
  const comLocalhost = semPontuacao.replace(HOSTS_DA_MAQUINA, "$1localhost");
  const [, esquema = "", host = "", porta = "", caminho = ""] =
    /^(https?):\/\/([^:/]+):(\d+)(\/.*)?$/i.exec(comLocalhost) ?? [];
  const numeroDaPorta = Number(porta);
  if (numeroDaPorta < 1 || numeroDaPorta > 65535) {
    return null;
  }
  const semBarraSolitaria = caminho === "/" ? "" : caminho;
  return `${esquema.toLowerCase()}://${host.toLowerCase()}:${numeroDaPorta}${semBarraSolitaria}`;
}

/** O texto inteiro é um endereço local com porta (sem espaços). */
const SO_ENDERECO_LOCAL = new RegExp(`^${ENDERECO_LOCAL.source}$`, "i");

/** O tamanho máximo de um endereço de prévia (o mesmo dos itens ligados). */
const TAMANHO_MAXIMO_DO_ENDERECO_DE_PREVIA = 2_000;

/**
 * Normaliza um endereço informado como local (ex.: na consulta da faixa de
 * servidores): só http ou https em localhost, 127.0.0.1, 0.0.0.0 ou [::1], com
 * porta, sai como em `extrairEnderecosLocais`. Qualquer outra coisa vira nulo.
 */
export function normalizarEnderecoLocal(endereco: string): string | null {
  const texto = endereco.trim();
  if (texto === "" || texto.length > TAMANHO_MAXIMO_DO_ENDERECO_DE_PREVIA || !SO_ENDERECO_LOCAL.test(texto)) {
    return null;
  }
  return normalizar(texto);
}

/**
 * Normaliza um endereço de prévia dito pelo agente (ex.: para fechá-la): o
 * local com porta sai como em `extrairEnderecosLocais` (`http://localhost:5173`);
 * um http ou https externo válido sai com o esquema e o host em minúsculas e
 * sem a barra solitária do fim. O que não for um endereço http(s) válido vira nulo.
 */
export function normalizarEnderecoDePrevia(endereco: string): string | null {
  const texto = endereco.trim();
  if (texto === "" || texto.length > TAMANHO_MAXIMO_DO_ENDERECO_DE_PREVIA) {
    return null;
  }
  if (SO_ENDERECO_LOCAL.test(texto)) {
    return normalizar(texto);
  }
  if (!/^https?:\/\//i.test(texto)) {
    return null;
  }
  try {
    const url = new URL(texto);
    if (url.hostname === "" || url.username !== "" || url.password !== "") {
      return null;
    }
    return url.pathname === "/" && url.search === "" && url.hash === "" ? url.origin : url.href;
  } catch {
    return null;
  }
}

/**
 * Os endereços locais com porta citados num texto, normalizados
 * (`http://localhost:5173`) e sem repetição, na ordem em que aparecem.
 */
export function extrairEnderecosLocais(texto: string): string[] {
  const encontrados = new Set<string>();
  for (const [endereco] of texto.replace(CODIGOS_ANSI, "").matchAll(ENDERECO_LOCAL)) {
    const normalizado = normalizar(endereco);
    if (normalizado !== null) {
      encontrados.add(normalizado);
    }
  }
  return [...encontrados];
}
