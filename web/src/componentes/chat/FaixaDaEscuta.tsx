import type { EscutaNaTela, SituacaoDaEscuta } from "../../shared/escuta/useEscuta";

/** Situações sem faixa: escuta desligada, recusada ou o aviso ainda na tela. */
const SEM_FAIXA: ReadonlySet<SituacaoDaEscuta> = new Set(["indisponivel", "desligada", "aguardando-aviso"]);

type Props = Pick<
  EscutaNaTela,
  | "situacao"
  | "progressoDoDownload"
  | "automatico"
  | "alternarAutomatico"
  | "erro"
  | "descartarErro"
  | "ultimaPergunta"
>;

/**
 * Junto do composer, com a escuta ligada: a chave "Automático", o progresso do
 * download do modelo, o erro da escuta (com fechar) e a última pergunta
 * detectada. A transcrição em si aparece dentro da conversa.
 */
export function FaixaDaEscuta({
  situacao,
  progressoDoDownload,
  automatico,
  alternarAutomatico,
  erro,
  descartarErro,
  ultimaPergunta,
}: Props) {
  if (SEM_FAIXA.has(situacao)) {
    return null;
  }

  const baixando = situacao === "baixando-modelo";

  return (
    <section className="faixa-da-escuta" aria-label="Escuta do áudio" data-testid="faixa-da-escuta">
      <div className="cabecalho-da-faixa-da-escuta">
        <span className="rotulo-tecnico">escuta</span>
        {situacao === "pausada" && <span className="text-support">pausada</span>}
        <span className="flex-1" />
        <button
          type="button"
          role="switch"
          className="interruptor interruptor-da-escuta"
          aria-checked={automatico}
          title={
            automatico
              ? "Automático: a pergunta detectada vai sozinha ao chat"
              : "Automático desligado: a escuta só transcreve, nada é enviado"
          }
          onClick={alternarAutomatico}
        >
          <span className="interruptor-trilho" aria-hidden="true" />
          Automático
        </button>
      </div>

      {erro !== null && (
        <p className="hint-error texto-longo erro-da-escuta" role="alert">
          {erro}{" "}
          <button type="button" className="btn btn-sm btn-ghost" onClick={descartarErro}>
            fechar
          </button>
        </p>
      )}

      {baixando && (
        <div className="download-da-escuta">
          <span className="mono text-secondary">
            baixando o modelo de transcrição{progressoDoDownload === null ? "…" : ` ${Math.round(progressoDoDownload)}%`}
          </span>
          <div
            className="trilho-do-download-da-escuta"
            role="progressbar"
            aria-label="Download do modelo de transcrição"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progressoDoDownload === null ? undefined : Math.round(progressoDoDownload)}
          >
            <span
              className="barra-do-download-da-escuta"
              style={{ width: `${Math.min(100, Math.max(0, progressoDoDownload ?? 0))}%` }}
            />
          </div>
        </div>
      )}
      {ultimaPergunta !== null && (
        <p className="ultima-pergunta-da-escuta" title={ultimaPergunta}>
          <span className="rotulo-tecnico">última pergunta</span> {ultimaPergunta}
        </p>
      )}
    </section>
  );
}
