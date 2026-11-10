import { Fragment, useLayoutEffect, useRef, useState } from "react";

import type { TrechoDaLegenda } from "./tipos";

/** Até esta distância do fim (px), a pessoa ainda está "no fim" e a legenda a segue. */
export const TOLERANCIA_DO_FIM_PX = 24;

interface Props {
  readonly confirmados: readonly TrechoDaLegenda[];
  readonly parcial: string | null;
  /** Em px. */
  readonly tamanhoDaFonte: number;
}

function estaNoFim(elemento: HTMLElement): boolean {
  return elemento.scrollHeight - elemento.scrollTop - elemento.clientHeight <= TOLERANCIA_DO_FIM_PX;
}

/**
 * Legenda corrida da escuta: os trechos confirmados no tom normal e o parcial
 * (o que está sendo dito agora) no fim, apagado. A pergunta detectada fica
 * destacada.
 *
 * Segue o fim sozinha enquanto a pessoa está no fim; se ela rolar para cima,
 * para de seguir e aparece o "↓ ao vivo", que volta ao fim e retoma.
 */
export function LegendaAoVivo({ confirmados, parcial, tamanhoDaFonte }: Props) {
  const rolagem = useRef<HTMLDivElement>(null);
  const [seguindo, setSeguindo] = useState(true);
  const temParcial = parcial !== null && parcial.trim() !== "";
  const vazia = confirmados.length === 0 && !temParcial;

  // Antes de pintar: o texto novo já aparece com a rolagem no fim, sem pulo.
  useLayoutEffect(() => {
    const elemento = rolagem.current;
    if (seguindo && elemento !== null) {
      elemento.scrollTop = elemento.scrollHeight;
    }
  }, [confirmados, parcial, tamanhoDaFonte, seguindo]);

  const aoRolar = () => {
    const elemento = rolagem.current;
    if (elemento !== null) {
      setSeguindo(estaNoFim(elemento));
    }
  };

  const voltarAoVivo = () => {
    const elemento = rolagem.current;
    if (elemento !== null) {
      elemento.scrollTop = elemento.scrollHeight;
    }
    setSeguindo(true);
  };

  return (
    <div className="legenda-ao-vivo" style={{ fontSize: `${tamanhoDaFonte}px` }}>
      <div
        ref={rolagem}
        className="rolagem-da-legenda custom-scrollbar"
        onScroll={aoRolar}
        data-testid="rolagem-da-legenda"
      >
        {vazia ? (
          <p className="legenda-vazia">A legenda aparece aqui assim que alguém falar.</p>
        ) : (
          <p className="texto-da-legenda">
            <span className="legenda-confirmada" aria-live="polite" data-testid="legenda-confirmada">
              {confirmados.map((trecho, indice) => (
                <Fragment key={trecho.id}>
                  {indice > 0 && " "}
                  {trecho.pergunta ? (
                    <mark className="legenda-trecho legenda-pergunta" aria-label={`Pergunta detectada: ${trecho.texto}`}>
                      <span className="marca-de-pergunta">pergunta</span> {trecho.texto}
                    </mark>
                  ) : (
                    <span className="legenda-trecho">{trecho.texto}</span>
                  )}
                </Fragment>
              ))}
            </span>
            {temParcial && (
              <>
                {confirmados.length > 0 && " "}
                <span className="legenda-parcial" data-testid="legenda-parcial">
                  {parcial}
                </span>
              </>
            )}
          </p>
        )}
      </div>
      {!seguindo && (
        <button
          type="button"
          className="botao-ao-vivo"
          title="Voltar ao fim e seguir a legenda"
          onClick={voltarAoVivo}
        >
          <span aria-hidden="true">↓</span> ao vivo
        </button>
      )}
    </div>
  );
}
