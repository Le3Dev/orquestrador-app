import type { SituacaoDaExecucao } from "../../shared/api/rotinas";
import { ROTULOS_DAS_SITUACOES } from "./textos";

/** A situação de uma execução (ou de uma etapa): ponto colorido e o nome dela. */
export function EtiquetaDaSituacao({ situacao }: { situacao: SituacaoDaExecucao }) {
  const rotulo = ROTULOS_DAS_SITUACOES[situacao];
  return <span className={`etiqueta ${rotulo.classe}`}>{rotulo.texto}</span>;
}
