import { textosAtuais } from "../idioma/idioma";
import { textosDeVoz } from "../idioma/textos/voz";

/** Menos que isto (0,3 s) é clique sem fala: nem vale transcrever. */
export const AMOSTRAS_MINIMAS = 4_800;

/**
 * Junta o texto ditado ao que já estava no campo, com um espaço entre os dois.
 * Sem `selecao`, ou com o cursor já no fim do texto, o ditado é concatenado ao
 * final. Com o cursor no meio (ou uma seleção), o trecho selecionado é
 * substituído pelo ditado, com espaços adicionados dos dois lados quando
 * necessário para não colar palavras.
 */
export function juntarDitado(
  atual: string,
  ditado: string,
  selecao?: { inicio: number; fim: number },
): string {
  const novo = ditado.trim();
  if (novo === "") return atual;
  if (atual.trim() === "") return novo;

  if (selecao === undefined || selecao.inicio === atual.length) {
    return /\s$/.test(atual) ? `${atual}${novo}` : `${atual} ${novo}`;
  }

  const antes = atual.slice(0, selecao.inicio);
  const depois = atual.slice(selecao.fim);
  const comEspacoAntes = antes !== "" && !/\s$/.test(antes) ? `${antes} ${novo}` : `${antes}${novo}`;
  return depois !== "" && !/^\s/.test(depois) ? `${comEspacoAntes} ${depois}` : `${comEspacoAntes}${depois}`;
}

/** Aviso quando o microfone fica sem som por alguns segundos. */
export function textoDoSilencio(): string {
  return textosAtuais(textosDeVoz).ditado.silencio;
}

/** O que o leitor de tela anuncia a cada mudança de fase do ditado (região educada, sempre presente). */
export function anuncioDoDitado(
  fase: "parado" | "pedindo-microfone" | "gravando" | "transcrevendo",
  baixando: number | null,
  inserido: boolean,
): string {
  const t = textosAtuais(textosDeVoz).ditado;
  if (fase === "pedindo-microfone") return t.anuncioPermita;
  if (fase === "gravando") return t.anuncioGravando;
  if (fase === "transcrevendo") {
    return baixando !== null ? t.anuncioBaixando : t.anuncioTranscrevendo;
  }
  return inserido ? t.anuncioInserido : "";
}

/** Segundos de gravação como "mm:ss" (ex.: 65 vira "01:05"). */
export function formatarCronometro(segundos: number): string {
  const total = Math.max(0, Math.floor(segundos));
  const minutos = Math.floor(total / 60);
  return `${String(minutos).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** Mensagem para a pessoa a partir do erro do microfone ou do modelo. */
export function mensagemDoErroDeDitado(erro: unknown): string {
  const t = textosAtuais(textosDeVoz).ditado;
  const nome = erro instanceof DOMException ? erro.name : "";
  if (nome === "NotAllowedError" || nome === "SecurityError") {
    return t.erroAcessoNegado;
  }
  if (nome === "NotFoundError" || nome === "OverconstrainedError") {
    return t.erroSemMicrofone;
  }
  if (nome === "NotReadableError") {
    return t.erroMicrofoneOcupado;
  }
  if (nome === "NotSupportedError" || nome === "AbortError") {
    return t.erroNavegadorSemAcesso;
  }
  const mensagem = erro instanceof Error ? erro.message : String(erro);
  if (/fetch|network|Failed to load|download/i.test(mensagem)) {
    return t.erroDownloadDoModelo;
  }
  // O resto vem do navegador ou do Whisper, em inglês: não vale mostrar cru.
  return t.erroGenerico;
}
