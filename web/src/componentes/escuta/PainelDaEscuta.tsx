import type { CSSProperties } from "react";

import { CartaoDeResposta } from "./CartaoDeResposta";
import { LegendaAoVivo } from "./LegendaAoVivo";
import {
  type AparenciaDaEscuta,
  ajustarAparencia,
  explicacaoDoMotor,
  LIMITES_DA_APARENCIA,
  progressoInteiro,
  rotuloDoMotor,
  type SituacaoDoPainel,
  textoDoDownload,
  tipoDoDispositivo,
  type VisaoDaEscuta,
} from "./tipos";

interface Props {
  readonly visao: VisaoDaEscuta;
  readonly aparencia: AparenciaDaEscuta;
  readonly aoMudarAparencia: (aparencia: AparenciaDaEscuta) => void;
}

const ROTULOS_DA_SITUACAO: Readonly<Record<SituacaoDoPainel, string>> = {
  escutando: "escutando",
  pausada: "pausada",
  iniciando: "iniciando…",
  erro: "com erro",
  parada: "parada",
};

const { tamanhoDaFonte: LIMITE_DA_FONTE, opacidade: LIMITE_DA_OPACIDADE } = LIMITES_DA_APARENCIA;

/**
 * A janela compacta da escuta: no cabeçalho, o estado, o motor da transcrição,
 * o download do modelo e os controles de aparência (fonte, transparência do
 * fundo, compactar); no corpo, a legenda ao vivo e o cartão da resposta lado a
 * lado (empilhados quando estreito). Compacto, só a legenda, em 3 linhas.
 *
 * A transparência vale só para o fundo (variável --opacidade-da-escuta): o
 * texto continua opaco e legível.
 */
export function PainelDaEscuta({ visao, aparencia, aoMudarAparencia }: Props) {
  const atual = ajustarAparencia(aparencia);
  const { tamanhoDaFonte, opacidade, compacto } = atual;

  const mudar = (alteracao: Partial<AparenciaDaEscuta>) => {
    aoMudarAparencia(ajustarAparencia({ ...atual, ...alteracao }));
  };

  const estilo = { "--opacidade-da-escuta": `${Math.round(opacidade * 100)}%` } as CSSProperties;
  const classes = [
    "painel-da-escuta",
    `painel-da-escuta-${visao.situacao}`,
    compacto ? "painel-da-escuta-compacto" : "",
  ]
    .filter((classe) => classe !== "")
    .join(" ");

  return (
    <section className={classes} style={estilo} aria-label="Escuta ao vivo" data-testid="painel-da-escuta">
      <header className="cabecalho-do-painel-da-escuta">
        <span className="estado-do-painel-da-escuta" aria-live="polite">
          <span className="ponto-do-painel-da-escuta" aria-hidden="true" />
          {ROTULOS_DA_SITUACAO[visao.situacao]}
        </span>
        {visao.motor !== null && (
          <span
            className={`selo-do-motor selo-do-motor-${tipoDoDispositivo(visao.motor.dispositivo).toLowerCase()}`}
            title={explicacaoDoMotor(visao.motor)}
          >
            {rotuloDoMotor(visao.motor)}
          </span>
        )}
        {visao.download !== null && (
          <span
            className="download-do-painel-da-escuta"
            role="progressbar"
            aria-label="Download do modelo de transcrição"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progressoInteiro(visao.download)}
            aria-valuetext={textoDoDownload(visao.download)}
          >
            <span className="texto-do-download-do-painel">{textoDoDownload(visao.download)}</span>
            <span className="trilho-do-download-do-painel" aria-hidden="true">
              <span className="barra-do-download-do-painel" style={{ width: `${progressoInteiro(visao.download)}%` }} />
            </span>
          </span>
        )}
        <span className="espaco-do-painel-da-escuta" />
        <div className="controles-do-painel-da-escuta" role="group" aria-label="Aparência da escuta">
          <button
            type="button"
            className="botao-do-painel-da-escuta"
            aria-label="Diminuir a fonte"
            title="Diminuir a fonte"
            disabled={tamanhoDaFonte <= LIMITE_DA_FONTE.minimo}
            onClick={() => mudar({ tamanhoDaFonte: tamanhoDaFonte - LIMITE_DA_FONTE.passo })}
          >
            A−
          </button>
          <button
            type="button"
            className="botao-do-painel-da-escuta"
            aria-label="Aumentar a fonte"
            title="Aumentar a fonte"
            disabled={tamanhoDaFonte >= LIMITE_DA_FONTE.maximo}
            onClick={() => mudar({ tamanhoDaFonte: tamanhoDaFonte + LIMITE_DA_FONTE.passo })}
          >
            A+
          </button>
          <input
            type="range"
            className="opacidade-do-painel-da-escuta"
            aria-label="Opacidade do fundo"
            title="Transparência do fundo: à esquerda, mais transparente"
            min={LIMITE_DA_OPACIDADE.minimo}
            max={LIMITE_DA_OPACIDADE.maximo}
            step={LIMITE_DA_OPACIDADE.passo}
            value={opacidade}
            aria-valuetext={`${Math.round(opacidade * 100)}%`}
            onChange={(evento) => mudar({ opacidade: Number(evento.target.value) })}
          />
          <button
            type="button"
            className="botao-do-painel-da-escuta"
            aria-label={compacto ? "Expandir a escuta" : "Compactar a escuta"}
            aria-pressed={compacto}
            title={compacto ? "Expandir: legenda e resposta" : "Compactar: só a legenda, em 3 linhas"}
            onClick={() => mudar({ compacto: !compacto })}
          >
            <span aria-hidden="true">{compacto ? "▢" : "▁"}</span>
          </button>
        </div>
      </header>

      {visao.erro !== null && (
        <p className="erro-do-painel-da-escuta" role="alert">
          {visao.erro}
        </p>
      )}

      <div className="corpo-do-painel-da-escuta">
        <LegendaAoVivo confirmados={visao.confirmados} parcial={visao.parcial} tamanhoDaFonte={tamanhoDaFonte} />
        {!compacto && <CartaoDeResposta resposta={visao.resposta} tamanhoDaFonte={tamanhoDaFonte} />}
      </div>
    </section>
  );
}
