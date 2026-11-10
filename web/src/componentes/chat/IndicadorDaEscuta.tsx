import type { EscutaNaTela, SituacaoDaEscuta } from "../../shared/escuta/useEscuta";
import {
  type DownloadDoModelo,
  explicacaoDoMotor,
  rotuloDoMotor,
  textoDoDownload,
  tipoDoDispositivo,
} from "../escuta/tipos";

type Props = Pick<EscutaNaTela, "situacao" | "progressoDoDownload" | "download" | "motor" | "erro" | "pausar" | "retomar">;

/** Situações em que não há escuta para indicar (fora do modo, recusada ou com o aviso na tela). */
const SEM_INDICADOR: ReadonlySet<SituacaoDaEscuta> = new Set(["indisponivel", "desligada", "aguardando-aviso"]);

/** O download com o total, quando a sessão o informa; sem ele, só a porcentagem. */
function downloadDe({ download, progressoDoDownload }: Pick<Props, "download" | "progressoDoDownload">): DownloadDoModelo | null {
  if (download !== null) {
    return download;
  }
  return progressoDoDownload === null ? null : { progresso: progressoDoDownload, totalMb: null };
}

/** O rótulo curto ao lado do ponto. */
function rotuloDa(situacao: SituacaoDaEscuta, download: DownloadDoModelo | null): string {
  switch (situacao) {
    case "escutando":
      return "escutando";
    case "pausada":
      return "pausada";
    case "baixando-modelo":
      return download === null ? "baixando o modelo…" : textoDoDownload(download);
    case "iniciando":
      return "iniciando…";
    case "erro":
      return "escuta com erro";
    default:
      return "";
  }
}

/** A explicação no balão (title) do indicador. */
function explicacaoDa(situacao: SituacaoDaEscuta, erro: string | null, download: DownloadDoModelo | null): string {
  switch (situacao) {
    case "escutando":
      return "Escutando o áudio do computador: a transcrição fica só neste computador";
    case "pausada":
      return "Escuta pausada: nada do áudio é transcrito até retomar";
    case "baixando-modelo": {
      const totalMb = download?.totalMb ?? null;
      const total = totalMb !== null && Number.isFinite(totalMb) && totalMb > 0 ? `, ${Math.round(totalMb)} MB` : "";
      return `Baixando o modelo de transcrição (só na primeira vez${total})`;
    }
    case "iniciando":
      return "Começando a escutar o áudio do computador";
    case "erro":
      return erro === null ? "A escuta parou com erro" : `A escuta parou: ${erro}`;
    default:
      return "";
  }
}

/**
 * Ao lado do 👁, com a escuta ligada: o ponto pulsa enquanto o áudio do
 * computador é escutado e fica parado na pausa; ao lado, o selo do motor
 * ("GPU · base · q4") e, baixando, o progresso com o total ("baixando o
 * modelo 45% de 199 MB"). O botão alterna pausar e retomar (aria-pressed =
 * pausada); com erro, ele tenta de novo.
 */
export function IndicadorDaEscuta({ situacao, progressoDoDownload, download, motor, erro, pausar, retomar }: Props) {
  if (SEM_INDICADOR.has(situacao)) {
    return null;
  }
  const baixando = downloadDe({ download, progressoDoDownload });
  const pausada = situacao === "pausada";
  const comBotao = situacao === "escutando" || pausada;
  return (
    <span
      className={`indicador-da-escuta indicador-da-escuta-${situacao}`}
      title={explicacaoDa(situacao, erro, baixando)}
      data-testid="indicador-da-escuta"
    >
      <span className="ponto-da-escuta" aria-hidden="true" />
      <span className="rotulo-da-escuta" aria-live="polite">
        {rotuloDa(situacao, baixando)}
      </span>
      {motor !== null && (
        <span
          className={`selo-do-motor-no-indicador selo-do-motor-no-indicador-${tipoDoDispositivo(motor.dispositivo).toLowerCase()}`}
          title={explicacaoDoMotor(motor)}
          data-testid="selo-do-motor"
        >
          {rotuloDoMotor(motor)}
        </span>
      )}
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
