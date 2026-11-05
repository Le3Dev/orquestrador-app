import type { SituacaoDoSubagente } from "../api/tipos";

/**
 * A entrega do relatório: quando um Subagente conclui, um envelope percorre a
 * linha do bixinho até o terminal (`ArestaDoBixinho`) e, ao chegar, a borda
 * do terminal pisca uma vez (classe `.janela-terminal-entrega`).
 */

/** Quanto o envelope leva do bixinho ao terminal. */
export const DURACAO_DA_ENTREGA_MS = 1200;
/** Quanto a borda do terminal pisca quando o envelope chega. */
export const DURACAO_DO_PISCAR_MS = 700;
/**
 * Até quanto tempo depois do fim do Subagente a entrega ainda é "ao vivo": o
 * histórico reenviado ao abrir o terminal, recarregar a página ou reconectar
 * chega evento a evento, com a hora antiga, e não deve animar.
 */
export const ENTREGA_AO_VIVO_MS = 10_000;

/** Se o Subagente encerrou há menos de `ENTREGA_AO_VIVO_MS` de `agora` (ms): só aí a entrega anima. */
export function entregaRecente(encerradoEm: string | null, agora: number): boolean {
  return encerradoEm !== null && agora - Date.parse(encerradoEm) < ENTREGA_AO_VIVO_MS;
}

/**
 * Se a mudança de situação é uma entrega: o Subagente estava executando e
 * concluiu. Falhar ou ser cancelado não entrega relatório, e sem a situação
 * anterior (a linha acabou de aparecer, por exemplo ao recarregar a página)
 * também não.
 */
export function houveEntrega(
  anterior: SituacaoDoSubagente | undefined,
  atual: SituacaoDoSubagente | undefined,
): boolean {
  return anterior === "executando" && atual === "concluido";
}

/** Se o sistema pede para reduzir o movimento: aí a entrega não anima. */
export function prefereMovimentoReduzido(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}
