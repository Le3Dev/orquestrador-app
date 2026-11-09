import type { EscutaNaTela, SituacaoDaEscuta } from "../../shared/escuta/useEscuta";

type Props = Pick<EscutaNaTela, "situacao" | "progressoDoDownload" | "erro" | "pausar" | "retomar">;

/** Situações em que não há escuta para indicar (fora do modo, recusada ou com o aviso na tela). */
const SEM_INDICADOR: ReadonlySet<SituacaoDaEscuta> = new Set(["indisponivel", "desligada", "aguardando-aviso"]);

/** O rótulo curto ao lado do ponto. */
function rotuloDa(situacao: SituacaoDaEscuta, progresso: number | null): string {
  switch (situacao) {
    case "escutando":
      return "escutando";
    case "pausada":
      return "pausada";
    case "baixando-modelo":
      return progresso === null ? "baixando o modelo…" : `baixando o modelo ${Math.round(progresso)}%`;
    case "iniciando":
      return "iniciando…";
    case "erro":
      return "escuta com erro";
    default:
      return "";
  }
}

/** A explicação no balão (title) do indicador. */
function explicacaoDa(situacao: SituacaoDaEscuta, erro: string | null): string {
  switch (situacao) {
    case "escutando":
      return "Escutando o áudio do computador: a transcrição fica só neste computador";
    case "pausada":
      return "Escuta pausada: nada do áudio é transcrito até retomar";
    case "baixando-modelo":
      return "Baixando o modelo de transcrição (só na primeira vez)";
    case "iniciando":
      return "Começando a escutar o áudio do computador";
    case "erro":
      return erro === null ? "A escuta parou com erro" : `A escuta parou: ${erro}`;
    default:
      return "";
  }
}

/**
 * Ao lado do 👁, com o modo invisível ligado: o ponto pulsa enquanto o áudio
 * do computador é escutado e fica parado na pausa. O botão alterna pausar e
 * retomar (aria-pressed = pausada); com erro, ele tenta de novo.
 */
export function IndicadorDaEscuta({ situacao, progressoDoDownload, erro, pausar, retomar }: Props) {
  if (SEM_INDICADOR.has(situacao)) {
    return null;
  }
  const pausada = situacao === "pausada";
  const comBotao = situacao === "escutando" || pausada;
  return (
    <span
      className={`indicador-da-escuta indicador-da-escuta-${situacao}`}
      title={explicacaoDa(situacao, erro)}
      data-testid="indicador-da-escuta"
    >
      <span className="ponto-da-escuta" aria-hidden="true" />
      <span className="rotulo-da-escuta" aria-live="polite">
        {rotuloDa(situacao, progressoDoDownload)}
      </span>
      {comBotao && (
        <button
          type="button"
          className="botao-da-escuta"
          aria-label="Pausar a escuta"
          aria-pressed={pausada}
          title={pausada ? "Retomar a escuta" : "Pausar a escuta"}
          onClick={pausada ? retomar : pausar}
        >
          <span aria-hidden="true">{pausada ? "▶" : "❚❚"}</span>
        </button>
      )}
      {situacao === "erro" && (
        <button
          type="button"
          className="botao-da-escuta"
          aria-label="Tentar escutar de novo"
          title="Tentar escutar de novo"
          onClick={retomar}
        >
          <span aria-hidden="true">↻</span>
        </button>
      )}
    </span>
  );
}
