/** Menos que isto (0,3 s) é clique sem fala: nem vale transcrever. */
export const AMOSTRAS_MINIMAS = 4_800;

/** Junta o texto ditado ao que já estava no campo, com um espaço entre os dois. */
export function juntarDitado(atual: string, ditado: string): string {
  const novo = ditado.trim();
  if (novo === "") return atual;
  if (atual.trim() === "") return novo;
  return /\s$/.test(atual) ? `${atual}${novo}` : `${atual} ${novo}`;
}

/** Mensagem para a pessoa a partir do erro do microfone ou do modelo. */
export function mensagemDoErroDeDitado(erro: unknown): string {
  const nome = erro instanceof DOMException ? erro.name : "";
  if (nome === "NotAllowedError" || nome === "SecurityError") {
    return "O acesso ao microfone foi negado. Libere em Ajustes do Sistema › Privacidade e Segurança › Microfone.";
  }
  if (nome === "NotFoundError" || nome === "OverconstrainedError") {
    return "Nenhum microfone encontrado.";
  }
  if (nome === "NotReadableError") {
    return "O microfone está ocupado por outro programa.";
  }
  const mensagem = erro instanceof Error ? erro.message : String(erro);
  if (/fetch|network|Failed to load|download/i.test(mensagem)) {
    return "Não foi possível baixar o modelo de voz. Confira a internet e tente de novo.";
  }
  return `O ditado falhou: ${mensagem}`;
}
