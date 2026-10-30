import { useCanvas } from "../../shared/canvas/contexto";
import { bixinhosParaLimpar } from "../../shared/canvas/nos";

/**
 * "Limpar bixinhos", na barra do terminal: tira do canvas os bixinhos que já
 * não trabalham, para muitos acumulados não deixarem a tela lenta. É só
 * visual — o histórico continua no terminal e no servidor.
 */
export function BotaoDeLimparBixinhos({ orquestradorId }: { orquestradorId: string }) {
  const { conversas, bixinhosLimpos, acoes } = useCanvas();
  const quantidade = bixinhosParaLimpar(conversas.get(orquestradorId), bixinhosLimpos.get(orquestradorId)).length;

  return (
    <button
      type="button"
      className="btn btn-sm btn-ghost nodrag"
      aria-label="Limpar bixinhos"
      title={
        quantidade === 0
          ? "Limpar bixinhos: nenhum parado agora"
          : `Limpar bixinhos: tira do canvas os ${quantidade} que não estão executando (o histórico continua no terminal)`
      }
      disabled={quantidade === 0}
      onClick={() => acoes.limparBixinhos(orquestradorId)}
    >
      {quantidade === 0 ? "limpar" : `limpar (${quantidade})`}
    </button>
  );
}
