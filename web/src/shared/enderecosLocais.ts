/**
 * Endereços de servidores de desenvolvimento ("npm run dev" e afins) que os
 * agentes sobem: a tela oferece uma prévia ao vivo de cada um.
 *
 * A fonte é só o evento `endereco_local_detectado` do servidor (src/
 * orquestracao/EnderecoLocal.ts), que já chega normalizado:
 * "http(s)://localhost:PORTA" e o caminho, se houver, com 0.0.0.0, 127.0.0.1
 * e [::1] trocados por localhost, sem pontuação no fim e sem a barra final
 * solitária. A normalização daqui segue as mesmas regras, então não altera
 * um endereço que veio do servidor; ela serve para validar o evento e o que o
 * usuário digita.
 */

/** Quantos endereços a conversa guarda: os mais recentes. */
export const LIMITE_DE_ENDERECOS = 10;

/** O endereço local inteiro, já sem a pontuação do fim. */
const ENDERECO_LOCAL = /^(https?):\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]):(\d{1,5})(\/\S*)?$/i;

/** Pontuação (e negrito do Markdown) que encerra a frase e não faz parte do endereço (a mesma classe do servidor). */
const PONTUACAO_FINAL = /[.,;:!?)\]}'"*~]+$/;

/** Um esquema explícito ("http://", "ftp://"...): sem ele, o endereço digitado ganha "http://". */
const COM_ESQUEMA = /^[a-z][a-z0-9+.-]*:\/\//i;

const PORTA_MAXIMA = 65_535;

/** O endereço local normalizado, ou nulo se não for um servidor local (http/https com porta). */
export function normalizarEndereco(bruto: string): string | null {
  const limpo = bruto.trim().replace(PONTUACAO_FINAL, "");
  const partes = ENDERECO_LOCAL.exec(limpo);
  if (partes === null) {
    return null;
  }
  const [, esquema = "http", , portaDigitada = "", caminhoDigitado = ""] = partes;
  const porta = Number(portaDigitada);
  if (porta < 1 || porta > PORTA_MAXIMA) {
    return null;
  }
  const caminho = caminhoDigitado === "/" ? "" : caminhoDigitado;
  return `${esquema.toLowerCase()}://localhost:${porta}${caminho}`;
}

/**
 * Soma os endereços novos aos da conversa: sem repetição, o mais recente por
 * último (um endereço visto de novo vai para o fim) e só os últimos
 * `LIMITE_DE_ENDERECOS`. Devolve o mesmo array quando nada muda.
 */
export function juntarEnderecos(atuais: readonly string[], novos: readonly string[]): readonly string[] {
  if (novos.length === 0) {
    return atuais;
  }
  let juntos = [...atuais];
  for (const endereco of novos) {
    juntos = [...juntos.filter((existente) => existente !== endereco), endereco];
  }
  juntos = juntos.slice(-LIMITE_DE_ENDERECOS);
  const iguais = juntos.length === atuais.length && juntos.every((endereco, indice) => endereco === atuais[indice]);
  return iguais ? atuais : juntos;
}

/**
 * O que o usuário digitou na barra da prévia, como endereço: "localhost:5173"
 * vira "http://localhost:5173". Só http e https; nulo para o resto (vazio,
 * "javascript:", "file://"...). Endereços locais seguem a normalização acima.
 */
export function enderecoDigitado(digitado: string): string | null {
  const texto = digitado.trim();
  if (texto === "") {
    return null;
  }
  const comEsquema = COM_ESQUEMA.test(texto) ? texto : `http://${texto}`;
  const local = normalizarEndereco(comEsquema);
  if (local !== null) {
    return local;
  }
  let endereco: URL;
  try {
    endereco = new URL(comEsquema);
  } catch {
    return null;
  }
  if ((endereco.protocol !== "http:" && endereco.protocol !== "https:") || endereco.hostname === "") {
    return null;
  }
  const resto = `${endereco.pathname}${endereco.search}${endereco.hash}`;
  return `${endereco.protocol}//${endereco.host}${resto === "/" ? "" : resto}`;
}

/** A origem ("http://localhost:5173") de um endereço normalizado. */
function origemDe(endereco: string): string {
  try {
    return new URL(endereco).origin;
  } catch {
    return endereco;
  }
}

/**
 * Os endereços a oferecer como prévia: os `limite` mais recentes (o mais
 * recente primeiro), menos os da própria tela (`origemDaTela`, normalmente
 * `window.location.origin`): ela não se abre dentro de si mesma.
 */
export function enderecosParaPrevia(enderecos: readonly string[], origemDaTela: string, limite = 3): string[] {
  const daTela = origemDe(normalizarEndereco(origemDaTela) ?? origemDaTela);
  return enderecos
    .filter((endereco) => origemDe(endereco) !== daTela)
    .slice(-limite)
    .reverse();
}

/** O endereço sem o esquema, para mostrar: "localhost:5173/app". */
export function enderecoCurto(endereco: string): string {
  return endereco.replace(/^https?:\/\//i, "");
}

/** Por quanto tempo um servidor anunciado ainda conta como "acabou de subir". */
export const JANELA_DA_ABERTURA_AUTOMATICA_MS = 2 * 60_000;

/**
 * Se o evento (`em`, ISO) é recente: acabou de acontecer, e não é histórico
 * relido ao abrir a tela. A tela só age sozinha (abrir ou fechar prévias) em
 * eventos assim.
 */
export function eventoAoVivo(em: string, agora: number): boolean {
  const idade = agora - Date.parse(em);
  return idade >= -JANELA_DA_ABERTURA_AUTOMATICA_MS && idade <= JANELA_DA_ABERTURA_AUTOMATICA_MS;
}

/**
 * Se a prévia deve abrir sozinha para o servidor que o agente citou na
 * resposta (`EstadoDaConversa.ultimoEnderecoDaResposta`): só quando a citação
 * é recente (reler o histórico ao abrir a tela não reabre prévias que o
 * usuário fechou) e não é a própria tela.
 */
export function abrirPreviaSozinha(
  detectado: { url: string; em: string } | null,
  agora: number,
  origemDaTela: string,
): boolean {
  if (detectado === null || !eventoAoVivo(detectado.em, agora)) {
    return false;
  }
  return enderecosParaPrevia([detectado.url], origemDaTela).length === 1;
}
