import type { EscutaNaTela, SituacaoDaEscuta } from "../../shared/escuta/useEscuta";

type Props = Pick<EscutaNaTela, "situacao" | "progressoDoDownload" | "erro" | "pausar" | "retomar">;

/** Situações em que não há escuta para indicar (fora do modo, recusada ou com o aviso na tela). */
const SEM_INDICADOR: ReadonlySet<SituacaoDaEscuta> = new Set(["indisponivel", "desligada", "aguardando-aviso"]);

/** Os ícones do botão do indicador: pausar (duas barras), retomar (triângulo) e tentar de novo (seta circular). */
function IconeDoIndicador({ tipo }: { tipo: "pausar" | "retomar" | "repetir" }) {
  return (
    <svg
      width={12}
      height={12}
      viewBox="0 0 24 24"
      fill={tipo === "repetir" ? "none" : "currentColor"}
      stroke="currentColor"
      strokeWidth={tipo === "repetir" ? 2 : 0}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {tipo === "pausar" && (
        <>
          <rect x="6" y="5" width="4" height="14" rx="1" />
          <rect x="14" y="5" width="4" height="14" rx="1" />
        </>
      )}
      {tipo === "retomar" && <path d="M8 5.5v13a.8.8 0 0 0 1.2.7l10-6.5a.8.8 0 0 0 0-1.4l-10-6.5A.8.8 0 0 0 8 5.5Z" />}
      {tipo === "repetir" && <path d="M20 12a8 8 0 1 1-2.6-5.9M20 4v4.5h-4.5" />}
    </svg>
  );
}

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
 * Ao lado do olho, com o modo invisível ligado: uma pílula pequena em que o ponto
 * pulsa enquanto o áudio do computador é escutado e fica parado na pausa. O botão
 * alterna pausar e retomar (aria-pressed = pausada); com erro, ele tenta de novo.
 * O rótulo ("escutando"…) fica só para leitor de tela: a barra do chat é estreita.
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
          <IconeDoIndicador tipo={pausada ? "retomar" : "pausar"} />
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
          <IconeDoIndicador tipo="repetir" />
        </button>
      )}
    </span>
  );
}
