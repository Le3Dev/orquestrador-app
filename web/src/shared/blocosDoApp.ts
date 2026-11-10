/** Bloco em que o chat sugere uma ação no app (vira o cartão de ação). */
export const CERCA_DE_ACAO = "```acao-do-app";
/** Bloco em que o Claude faz perguntas com opções (vira o cartão de pergunta). */
export const CERCA_DE_PERGUNTA = "```pergunta-do-app";
/**
 * Bloco em que o Orquestrador diz quais prévias já cumpriram o papel e podem
 * fechar (`{"fechar":[...]}`). O servidor o lê e entrega o resultado no fim do
 * turno; na tela ele nunca aparece.
 */
export const CERCA_DE_PREVIA = "```previa-do-app";
/** Os blocos que o Orquestrador escreve para o app e que a transcrição esconde. */
export const CERCAS_DO_ORQUESTRADOR = [CERCA_DE_PERGUNTA, CERCA_DE_PREVIA] as const;

/**
 * O texto sem os blocos das `cercas` (da abertura até a cerca de fechamento
 * ou o fim do texto): o conteúdo deles chega pronto no fim da resposta e vira
 * cartão. Com `respondendo`, também some uma cerca ainda pela metade no fim
 * ("```perg"), para o bloco não piscar na tela antes de ser reconhecido.
 */
export function semBlocosDoApp(texto: string, cercas: readonly string[], respondendo: boolean): string {
  let restante = texto;
  let resultado = "";
  for (;;) {
    const inicio = primeiraCerca(restante, cercas);
    if (inicio === -1) {
      resultado += restante;
      break;
    }
    resultado += restante.slice(0, inicio);
    const fimDaAbertura = restante.indexOf("\n", inicio);
    if (fimDaAbertura === -1) {
      break;
    }
    const fechamento = restante.indexOf("\n```", fimDaAbertura);
    if (fechamento === -1) {
      break;
    }
    const fimDoFechamento = restante.indexOf("\n", fechamento + 4);
    restante = fimDoFechamento === -1 ? "" : restante.slice(fimDoFechamento + 1);
  }
  if (respondendo) {
    resultado = semCercaPelaMetade(resultado, cercas);
  }
  return resultado.trimEnd();
}

/** Onde começa a primeira das cercas no texto; -1 sem nenhuma. */
function primeiraCerca(texto: string, cercas: readonly string[]): number {
  let primeira = -1;
  for (const cerca of cercas) {
    const posicao = texto.indexOf(cerca);
    if (posicao !== -1 && (primeira === -1 || posicao < primeira)) {
      primeira = posicao;
    }
  }
  return primeira;
}

/** Tira do fim um começo de cerca ainda incompleto, no início de uma linha. */
function semCercaPelaMetade(texto: string, cercas: readonly string[]): string {
  const inicioDaLinha = texto.lastIndexOf("\n") + 1;
  const ultimaLinha = texto.slice(inicioDaLinha);
  return ultimaLinha.length >= 3 && cercas.some((cerca) => cerca.startsWith(ultimaLinha))
    ? texto.slice(0, inicioDaLinha)
    : texto;
}
