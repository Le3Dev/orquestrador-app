import type { SituacaoDaExecucao } from "../../shared/api/rotinas";
import { useIdioma } from "../../shared/idioma/idioma";
import { rotuloDaSituacao } from "./textos";

/** A situação de uma execução (ou de uma etapa): ponto colorido e o nome dela. */
export function EtiquetaDaSituacao({ situacao }: { situacao: SituacaoDaExecucao }) {
  useIdioma();
  const rotulo = rotuloDaSituacao(situacao);
  return <span className={`etiqueta ${rotulo.classe}`}>{rotulo.texto}</span>;
}
