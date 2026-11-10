import type { MensagemDoChat } from "../../shared/api/tipos";

/** Até quanto tempo depois do fim da frase a mensagem da escuta ainda conta como o envio dela. */
export const PRAZO_DO_ENVIO_DA_PERGUNTA_MS = 60_000;

/** O que a regra olha numa frase ouvida (uma frase fechada da legenda da escuta). */
export interface FraseNoTempo {
  readonly inicioMs: number;
  readonly fimMs: number;
  readonly pergunta: boolean;
}

/** O que a regra olha numa mensagem do chat. */
export type MensagemNoTempo = Pick<MensagemDoChat, "papel" | "origem" | "criadaEm">;

/**
 * As frases ouvidas sem as perguntas que já viraram mensagem do chat, para a
 * conversa não mostrar a mesma pergunta duas vezes. Cada mensagem do usuário
 * enviada pela escuta esconde UMA frase marcada como pergunta: a mais recente
 * cujo intervalo (do `inicioMs` ao `fimMs` mais o prazo de 60 s) contém o
 * `criadaEm` da mensagem. As perguntas nunca enviadas (deduplicadas, postas
 * só no campo, substituídas por outra mais nova) continuam aparecendo.
 *
 * Função pura: não altera as listas; sem nada a esconder, devolve a própria
 * lista de frases (a mesma referência).
 */
export function frasesSemAsEnviadas<F extends FraseNoTempo>(
  frases: readonly F[],
  mensagens: readonly MensagemNoTempo[],
): readonly F[] {
  const enviadas = new Set<number>();
  for (const mensagem of mensagens) {
    if (mensagem.papel !== "usuario" || mensagem.origem !== "escuta") continue;
    const enviadaEmMs = Date.parse(mensagem.criadaEm);
    if (!Number.isFinite(enviadaEmMs)) continue;
    let origem = -1;
    frases.forEach((frase, indice) => {
      if (!frase.pergunta || enviadas.has(indice)) return;
      if (enviadaEmMs < frase.inicioMs || enviadaEmMs > frase.fimMs + PRAZO_DO_ENVIO_DA_PERGUNTA_MS) return;
      const atual = origem === -1 ? undefined : frases[origem];
      if (atual === undefined || frase.inicioMs >= atual.inicioMs) origem = indice;
    });
    if (origem !== -1) enviadas.add(origem);
  }
  return enviadas.size === 0 ? frases : frases.filter((_, indice) => !enviadas.has(indice));
}
