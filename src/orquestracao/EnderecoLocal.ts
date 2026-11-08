/**
 * Endereços locais (servidores de desenvolvimento) que aparecem na saída das
 * ferramentas: é o que alimenta a prévia ao vivo na tela.
 */

/** Sequências de cor e cursor do terminal: o Vite, por exemplo, pinta a porta. */
const CODIGOS_ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;

/** Só hosts da própria máquina, sempre com porta; o caminho é opcional. */
const ENDERECO_LOCAL =
  /\bhttps?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]):\d{1,5}(?![\w-])(?:\/[^\s"'<>`]*)?/gi;

/** Pontuação que fecha a frase (ou o negrito e o código do Markdown) em volta do endereço, não faz parte dele. */
const PONTUACAO_FINAL = /[.,;:!?)\]}'"*~]+$/;

const HOSTS_DA_MAQUINA = /^(https?:\/\/)(?:127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?=:)/i;

function normalizar(endereco: string): string | null {
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
