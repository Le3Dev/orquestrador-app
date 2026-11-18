import { useEffect, useMemo, useRef } from "react";

import type { AprovacaoPendente } from "./useRotinas";

/** Uma execução que espera o usuário, como o app desktop a recebe (para a notificação do Windows). */
export interface PendenciaParaODesktop {
  /** O id da execução: o app só avisa uma vez por execução. */
  id: string;
  /** O nome da rotina, que a notificação cita. */
  rotina: string;
}

/** O que a tela conta ao app desktop: o que ele precisa para manter as rotinas rodando e avisar. */
export interface SituacaoDasRotinasParaODesktop {
  /** Rotinas ligadas: com pelo menos uma, fechar a janela esconde o app na bandeja em vez de encerrá-lo. */
  ativas: number;
  /** Execuções que esperam aprovação. */
  aguardandoAprovacao: number;
  pendentes: PendenciaParaODesktop[];
}

/** `window.electron.rotinas` (electron/preload.js); no navegador não existe. */
export interface PonteDasRotinas {
  informarSituacao: (situacao: SituacaoDasRotinasParaODesktop) => Promise<void>;
  /** O app pede para abrir o painel (clique na notificação do Windows); devolve a função que cancela. */
  aoPedirPainel: (callback: () => void) => () => void;
}

/** A ponte das rotinas do app desktop, ou null fora dele (navegador ou app sem a bandeja). */
export function ponteDasRotinas(): PonteDasRotinas | null {
  if (typeof window === "undefined") {
    return null;
  }
  const ponte = (window as unknown as { electron?: { desktop?: boolean; rotinas?: PonteDasRotinas } }).electron;
  return ponte?.desktop === true && ponte.rotinas !== undefined ? ponte.rotinas : null;
}

interface Entrada {
  /** Só depois que a lista veio do servidor: antes disso "zero rotinas" seria mentira. */
  carregada: boolean;
  ativas: number;
  aprovacoesPendentes: readonly AprovacaoPendente[];
  /** O app pediu o painel (clique na notificação). */
  aoPedirPainel: () => void;
}

/**
 * Liga a tela ao app desktop: conta quantas rotinas estão ativas e quantas
 * execuções esperam aprovação (o app decide se fechar a janela esconde na
 * bandeja e mostra a notificação do Windows) e repassa o pedido de abrir o
 * painel. Fora do app desktop não faz nada.
 */
export function useRotinasNoDesktop({ carregada, ativas, aprovacoesPendentes, aoPedirPainel }: Entrada): void {
  const pendentes = useMemo<PendenciaParaODesktop[]>(
    () => aprovacoesPendentes.map(({ execucao, rotinaNome }) => ({ id: execucao.id, rotina: rotinaNome })),
    [aprovacoesPendentes],
  );
  // Só reenvia quando algo mudou: os eventos de etapa não mexem nestes números.
  const chave = JSON.stringify([ativas, pendentes]);
  const ultimaChave = useRef<string | null>(null);

  useEffect(() => {
    const ponte = ponteDasRotinas();
    if (ponte === null || !carregada || ultimaChave.current === chave) {
      return;
    }
    ultimaChave.current = chave;
    const avisoFalhou = (falha: unknown) => console.error("Não foi possível avisar o app sobre as rotinas.", falha);
    try {
      void Promise.resolve(ponte.informarSituacao({ ativas, aguardandoAprovacao: pendentes.length, pendentes })).catch(
        avisoFalhou,
      );
    } catch (falha) {
      avisoFalhou(falha);
    }
  }, [carregada, chave, ativas, pendentes]);

  const pedido = useRef(aoPedirPainel);
  useEffect(() => {
    pedido.current = aoPedirPainel;
  }, [aoPedirPainel]);
  useEffect(() => ponteDasRotinas()?.aoPedirPainel(() => pedido.current()), []);
}
