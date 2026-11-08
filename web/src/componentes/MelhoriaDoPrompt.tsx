import { formatarTokens } from "../shared/formatacao";
import type { MelhoriaDoPrompt } from "../shared/hooks/useMelhorarPrompt";
import { IconeBrilho } from "./Icones";

interface PropsDoBotao {
  melhoria: MelhoriaDoPrompt;
  /** Campo vazio, servidor fora ou um pedido rodando. Não vale para o "cancelar". */
  desabilitado: boolean;
}

/** O ✨ ao lado do campo; melhorando, vira "cancelar". */
export function BotaoDeMelhorar({ melhoria, desabilitado }: PropsDoBotao) {
  if (melhoria.melhorando) {
    return (
      <button
        type="button"
        className="btn btn-sm btn-ghost"
        aria-label="Cancelar a melhoria do pedido"
        title="Cancelar a melhoria (o texto fica como estava)"
        onClick={melhoria.cancelar}
      >
        cancelar
      </button>
    );
  }
  return (
    <button
      type="button"
      className="botao-icone botao-de-melhorar"
      aria-label="Melhorar o pedido"
      title="Melhorar o pedido"
      disabled={desabilitado}
      onClick={melhoria.melhorar}
    >
      <IconeBrilho />
    </button>
  );
}

interface PropsDoAviso {
  melhoria: MelhoriaDoPrompt;
  className?: string;
}

/** A linha perto do campo: "melhorando…", "melhorado · ≈ índice X · desfazer" ou o erro. */
export function AvisoDaMelhoria({ melhoria, className = "" }: PropsDoAviso) {
  const { estado } = melhoria;
  if (estado.fase === "melhorando") {
    return (
      <p className={`mono hint ${className}`} role="status">
        melhorando o pedido…
      </p>
    );
  }
  if (estado.fase === "melhorado") {
    return (
      <p className={`mono hint ${className}`} role="status">
        melhorado · ≈ índice {formatarTokens(estado.indiceDeCusto)} ·{" "}
        <button
          type="button"
          className="botao-de-texto"
          title="Volta o texto de antes da melhoria"
          onClick={melhoria.desfazer}
        >
          desfazer
        </button>
      </p>
    );
  }
  if (estado.fase === "erro") {
    return (
      <p className={`hint-error texto-longo ${className}`} role="alert">
        {estado.mensagem}
      </p>
    );
  }
  return null;
}
