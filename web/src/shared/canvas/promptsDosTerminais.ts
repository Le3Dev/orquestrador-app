/**
 * Os prompts dos terminais dos Orquestradores abertos no canvas, para quem
 * está fora do cartão escrever neles (ex.: o bloco "Terminal" mandando um
 * trecho da saída). Só escreve: quem envia é sempre o usuário.
 *
 * Fica fora do estado do canvas: escrever num prompt não re-renderiza nada
 * além dele.
 */

/** O que o cartão do Orquestrador expõe do prompt dele. */
export interface PromptDoTerminalRegistrado {
  /** Acrescenta o texto ao fim do prompt e foca o campo. Não envia. */
  acrescentarTexto: (texto: string) => void;
}

const prompts = new Map<string, PromptDoTerminalRegistrado>();
/** Textos para terminais ainda fechados: entram no prompt quando ele abrir. */
const pendentes = new Map<string, string[]>();

/**
 * Registra o prompt do terminal de um Orquestrador (ao montar o cartão) e
 * entrega o que estava esperando por ele. Devolve a função que o tira do
 * registro (ao desmontar).
 */
export function registrarPromptDoTerminal(orquestradorId: string, prompt: PromptDoTerminalRegistrado): () => void {
  prompts.set(orquestradorId, prompt);
  const esperando = pendentes.get(orquestradorId);
  if (esperando !== undefined) {
    pendentes.delete(orquestradorId);
    for (const texto of esperando) {
      prompt.acrescentarTexto(texto);
    }
  }
  return () => {
    if (prompts.get(orquestradorId) === prompt) {
      prompts.delete(orquestradorId);
    }
  };
}

/**
 * Escreve no prompt do terminal do Orquestrador, como rascunho. Com o
 * terminal fechado, o texto fica esperando e entra quando ele abrir; devolve
 * se já entrou agora.
 */
export function escreverNoPromptDoTerminal(orquestradorId: string, texto: string): boolean {
  const prompt = prompts.get(orquestradorId);
  if (prompt !== undefined) {
    prompt.acrescentarTexto(texto);
    return true;
  }
  pendentes.set(orquestradorId, [...(pendentes.get(orquestradorId) ?? []), texto]);
  return false;
}

/** Só para os testes: esquece os prompts e os textos pendentes. */
export function limparPromptsDosTerminais(): void {
  prompts.clear();
  pendentes.clear();
}
