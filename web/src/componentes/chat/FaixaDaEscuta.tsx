import { useId, useState } from "react";

import type { EscutaNaTela, SituacaoDaEscuta } from "../../shared/escuta/useEscuta";

/** Guarda, neste computador, se a faixa da escuta fica recolhida. */
export const CHAVE_DA_FAIXA_DA_ESCUTA_RECOLHIDA = "orquestrador.faixaDaEscutaRecolhida";

/** Situações sem faixa: fora do modo, escuta recusada ou o aviso ainda na tela. */
const SEM_FAIXA: ReadonlySet<SituacaoDaEscuta> = new Set(["indisponivel", "desligada", "aguardando-aviso"]);

/** Recolhida só se estiver gravado assim; sem localStorage (bloqueado) ou com lixo, aberta. */
function lerRecolhida(): boolean {
  try {
    return localStorage.getItem(CHAVE_DA_FAIXA_DA_ESCUTA_RECOLHIDA) === "true";
  } catch {
    return false;
  }
}

function gravarRecolhida(recolhida: boolean): void {
  try {
    localStorage.setItem(CHAVE_DA_FAIXA_DA_ESCUTA_RECOLHIDA, String(recolhida));
  } catch {
    // Sem localStorage, a escolha vale só até recarregar a tela.
  }
}

type Props = Pick<
  EscutaNaTela,
  | "situacao"
  | "progressoDoDownload"
  | "linhas"
  | "automatico"
  | "alternarAutomatico"
  | "erro"
  | "descartarErro"
  | "ultimaPergunta"
>;

/** O que a área das linhas diz quando ainda não há transcrição. */
function semLinhas(situacao: SituacaoDaEscuta): string {
  if (situacao === "pausada") {
    return "Escuta pausada.";
  }
  if (situacao === "baixando-modelo" || situacao === "iniciando") {
    return "A transcrição aparece aqui assim que a escuta começar.";
  }
  return "Nada transcrito ainda.";
}

/**
 * Junto do composer, com o modo invisível ligado: as últimas linhas da
 * transcrição, o progresso do download do modelo, o erro da escuta (com
 * fechar), a chave "Automático" e a última pergunta detectada. O cabeçalho
 * recolhe e abre a faixa; a escolha fica guardada neste computador.
 */
export function FaixaDaEscuta({
  situacao,
  progressoDoDownload,
  linhas,
  automatico,
  alternarAutomatico,
  erro,
  descartarErro,
  ultimaPergunta,
}: Props) {
  const [recolhida, setRecolhida] = useState(lerRecolhida);
  const idDoCorpo = useId();

  if (SEM_FAIXA.has(situacao)) {
    return null;
  }

  function alternar(): void {
    const nova = !recolhida;
    setRecolhida(nova);
    gravarRecolhida(nova);
  }

  const ultimaLinha = linhas.at(-1) ?? "";
  const baixando = situacao === "baixando-modelo";

  return (
    <section className="faixa-da-escuta" aria-label="Escuta do áudio" data-testid="faixa-da-escuta">
      <div className="cabecalho-da-faixa-da-escuta">
        <button
          type="button"
          className="alternar-faixa-da-escuta"
          aria-expanded={!recolhida}
          aria-controls={idDoCorpo}
          title={recolhida ? "Mostrar a transcrição da escuta" : "Recolher a transcrição da escuta"}
          onClick={alternar}
        >
          <span className="seta-da-faixa-da-escuta" aria-hidden="true">
            {recolhida ? "▸" : "▾"}
          </span>
          <span className="rotulo-tecnico">transcrição</span>
          {recolhida && ultimaLinha !== "" && <span className="resumo-da-faixa-da-escuta">{ultimaLinha}</span>}
        </button>
        <button
          type="button"
          role="switch"
          className="interruptor interruptor-da-escuta"
          aria-checked={automatico}
          title={
            automatico
              ? "Automático: a pergunta detectada vai sozinha ao chat, com o print da tela"
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

      <div id={idDoCorpo} className="corpo-da-faixa-da-escuta" hidden={recolhida}>
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
        {linhas.length > 0 ? (
          <ol className="linhas-da-escuta" aria-label="Últimas linhas transcritas">
            {linhas.map((linha, indice) => (
              // As linhas não têm id e se repetem: a posição basta (a lista é curta e só cresce no fim).
              <li key={`${indice}:${linha}`}>{linha}</li>
            ))}
          </ol>
        ) : (
          <p className="text-support">{semLinhas(situacao)}</p>
        )}
        {ultimaPergunta !== null && (
          <p className="ultima-pergunta-da-escuta" title={ultimaPergunta}>
            <span className="rotulo-tecnico">última pergunta</span> {ultimaPergunta}
          </p>
        )}
      </div>
    </section>
  );
}
