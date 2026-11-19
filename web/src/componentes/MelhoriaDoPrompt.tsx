import { formatarTokens } from "../shared/formatacao";
import { useTextos } from "../shared/idioma/idioma";
import { textosDeComponentesComuns } from "../shared/idioma/textos/componentesComuns";
import type { MelhoriaDoPrompt } from "../shared/hooks/useMelhorarPrompt";
import { IconeBrilho } from "./Icones";

interface PropsDoBotao {
  melhoria: MelhoriaDoPrompt;
  /** Campo vazio, servidor fora ou um pedido rodando. Não vale para o "cancelar". */
  desabilitado: boolean;
}

/** O ✨ ao lado do campo; melhorando, vira "cancelar". */
export function BotaoDeMelhorar({ melhoria, desabilitado }: PropsDoBotao) {
  const t = useTextos(textosDeComponentesComuns).melhoria;
  if (melhoria.melhorando) {
    return (
      <button
        type="button"
        className="btn btn-sm btn-ghost"
        aria-label={t.cancelarRotulo}
        title={t.cancelarDica}
        onClick={melhoria.cancelar}
      >
        {t.cancelar}
      </button>
    );
  }
  return (
    <button
      type="button"
      className="botao-icone botao-de-melhorar"
      aria-label={t.melhorar}
      title={t.melhorar}
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
  const t = useTextos(textosDeComponentesComuns).melhoria;
  const { estado } = melhoria;
  if (estado.fase === "melhorando") {
    return (
      <p className={`mono hint ${className}`} role="status">
        {t.melhorando}
      </p>
    );
  }
  if (estado.fase === "melhorado") {
    return (
      <p className={`mono hint ${className}`} role="status">
        {t.melhorado}
        {formatarTokens(estado.indiceDeCusto)} ·{" "}
        <button
          type="button"
          className="botao-de-texto"
          title={t.desfazerDica}
          onClick={melhoria.desfazer}
        >
          {t.desfazer}
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
