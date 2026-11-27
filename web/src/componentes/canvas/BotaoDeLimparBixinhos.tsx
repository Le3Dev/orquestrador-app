import { useAcoesDoCanvas, useSeletorDoCanvas } from "../../shared/canvas/contexto";
import { bixinhosParaLimpar } from "../../shared/canvas/nos";

/**
 * "Limpar bixinhos", na barra do terminal: tira do canvas os bixinhos que já
 * não trabalham, para muitos acumulados não deixarem a tela lenta. É só
 * visual — o histórico continua no terminal e no servidor. Só aparece quando
 * há ao menos um bixinho parado (falhou, concluiu ou foi cancelado); sem
 * nenhum, não renderiza nada.
 */
export function BotaoDeLimparBixinhos({ orquestradorId }: { orquestradorId: string }) {
  // Só a quantidade (um número): re-renderiza quando ela muda, não a cada evento.
  const quantidade = useSeletorDoCanvas(
    (canvas) => bixinhosParaLimpar(canvas.conversas.get(orquestradorId), canvas.bixinhosLimpos.get(orquestradorId)).length,
  );
  const acoes = useAcoesDoCanvas();

  if (quantidade === 0) {
    return null;
  }

  return (
    <button
      type="button"
      className="btn btn-sm btn-ghost nodrag"
      aria-label="Limpar bixinhos"
      title={`Limpar bixinhos: tira do canvas os ${quantidade} que não estão executando (o histórico continua no terminal)`}
      onClick={() => acoes.limparBixinhos(orquestradorId)}
    >
      {`limpar (${quantidade})`}
    </button>
  );
}
