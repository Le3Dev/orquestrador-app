import { useCanvas } from "../../shared/canvas/contexto";
import { bixinhosParaLimpar } from "../../shared/canvas/nos";
import { useTextos } from "../../shared/idioma/idioma";
import { textosDeNosDoCanvas } from "../../shared/idioma/textos/nosDoCanvas";

/**
 * "Limpar bixinhos", na barra do terminal: tira do canvas os bixinhos que já
 * não trabalham, para muitos acumulados não deixarem a tela lenta. É só
 * visual — o histórico continua no terminal e no servidor. Só aparece quando
 * há ao menos um bixinho parado (falhou, concluiu ou foi cancelado); sem
 * nenhum, não renderiza nada.
 */
export function BotaoDeLimparBixinhos({ orquestradorId }: { orquestradorId: string }) {
  const t = useTextos(textosDeNosDoCanvas).bixinho;
  const { conversas, bixinhosLimpos, acoes } = useCanvas();
  const quantidade = bixinhosParaLimpar(conversas.get(orquestradorId), bixinhosLimpos.get(orquestradorId)).length;

  if (quantidade === 0) {
    return null;
  }

  return (
    <button
      type="button"
      className="btn btn-sm btn-ghost nodrag"
      aria-label={t.limpar}
      title={t.limparDica(quantidade)}
      onClick={() => acoes.limparBixinhos(orquestradorId)}
    >
      {t.limparTexto(quantidade)}
    </button>
  );
}
