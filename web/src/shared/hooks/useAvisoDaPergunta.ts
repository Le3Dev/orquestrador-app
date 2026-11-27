import { useEffect, useRef, useState } from "react";

import { tocarSomDaPergunta } from "../canvas/somDaPergunta";
import { eventoAoVivo } from "../enderecosLocais";

const DURACAO_DO_BALANCO_MS = 700;

/** O pedido que terminou com perguntas ainda sem resposta: o último, concluído e com perguntas. */
export function perguntaPendenteDoTurno(
  turno: { id: string; situacao: string; perguntas?: readonly unknown[]; encerradoEm: string | null } | undefined,
): { chave: string; aoVivo: boolean } | null {
  if (turno === undefined || turno.situacao !== "concluido" || (turno.perguntas?.length ?? 0) === 0) {
    return null;
  }
  return { chave: turno.id, aoVivo: turno.encerradoEm !== null && eventoAoVivo(turno.encerradoEm, Date.now()) };
}

/**
 * O que acontece uma vez, quando uma pergunta nova chega com o terminal aberto:
 * o nó balança (`balancando`) e, com a preferência ligada, toca o aviso. Uma
 * pergunta que já estava lá ao abrir (histórico) não avisa; a mesma pergunta
 * nunca avisa duas vezes, mesmo se o som for ligado depois.
 */
export function useAvisoDaPergunta(
  pergunta: { chave: string; aoVivo: boolean } | null,
  somLigado: boolean,
): { balancando: boolean } {
  const avisada = useRef<string | null>(null);
  const [balancandoDe, setBalancandoDe] = useState<string | null>(null);
  const chave = pergunta?.chave ?? null;
  const aoVivo = pergunta?.aoVivo ?? false;

  useEffect(() => {
    if (chave === null || !aoVivo || avisada.current === chave) {
      return;
    }
    avisada.current = chave;
    setBalancandoDe(chave);
    if (somLigado) {
      tocarSomDaPergunta();
    }
  }, [chave, aoVivo, somLigado]);

  // O balanço dura 0,5 s: a classe sai logo depois, para não repetir quando o canvas parar de mover.
  useEffect(() => {
    if (balancandoDe === null) {
      return;
    }
    const prazo = setTimeout(() => setBalancandoDe(null), DURACAO_DO_BALANCO_MS);
    return () => clearTimeout(prazo);
  }, [balancandoDe]);

  return { balancando: balancandoDe !== null && balancandoDe === chave };
}
