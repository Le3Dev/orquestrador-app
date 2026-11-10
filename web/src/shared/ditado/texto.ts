/** Menos que isto (0,3 s) é clique sem fala: nem vale transcrever. */
export const AMOSTRAS_MINIMAS = 4_800;

/** Junta o texto ditado ao que já estava no campo, com um espaço entre os dois. */
export function juntarDitado(atual: string, ditado: string): string {
  const novo = ditado.trim();
  if (novo === "") return atual;
  if (atual.trim() === "") return novo;
  return /\s$/.test(atual) ? `${atual}${novo}` : `${atual} ${novo}`;
}

/** Aviso quando o microfone fica sem som por alguns segundos. */
export const TEXTO_DO_SILENCIO = "Não estou ouvindo nada, confira o microfone";

/** O que o leitor de tela anuncia a cada mudança de fase do ditado (região educada, sempre presente). */
export function anuncioDoDitado(
  fase: "parado" | "pedindo-microfone" | "gravando" | "transcrevendo",
  baixando: number | null,
  inserido: boolean,
): string {
  if (fase === "pedindo-microfone") return "Permita o acesso ao microfone.";
  if (fase === "gravando") return "Gravando. Enter conclui, Esc descarta.";
  if (fase === "transcrevendo") {
    return baixando !== null ? "Baixando o modelo de voz, só na primeira vez." : "Transcrevendo o áudio.";
  }
  return inserido ? "Texto adicionado ao campo." : "";
}

/** Segundos de gravação como "mm:ss" (ex.: 65 vira "01:05"). */
export function formatarCronometro(segundos: number): string {
  const total = Math.max(0, Math.floor(segundos));
  const minutos = Math.floor(total / 60);
  return `${String(minutos).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** Mensagem para a pessoa a partir do erro do microfone ou do modelo. */
export function mensagemDoErroDeDitado(erro: unknown): string {
  const nome = erro instanceof DOMException ? erro.name : "";
  if (nome === "NotAllowedError" || nome === "SecurityError") {
    return "O acesso ao microfone foi negado. No Mac, libere em Ajustes do Sistema › Privacidade e Segurança › Microfone (ative este app) e tente de novo.";
  }
  if (nome === "NotFoundError" || nome === "OverconstrainedError") {
    return "Nenhum microfone encontrado.";
  }
  if (nome === "NotReadableError") {
    return "O microfone está ocupado por outro programa.";
  }
  if (nome === "NotSupportedError" || nome === "AbortError") {
    return "O ditado falhou: este navegador não deu acesso ao microfone.";
  }
  const mensagem = erro instanceof Error ? erro.message : String(erro);
  if (/fetch|network|Failed to load|download/i.test(mensagem)) {
    return "Não foi possível baixar o modelo de voz. Confira a internet e tente de novo.";
  }
  // O resto vem do navegador ou do Whisper, em inglês: não vale mostrar cru.
  return "O ditado falhou. Tente de novo ou digite o texto.";
}
