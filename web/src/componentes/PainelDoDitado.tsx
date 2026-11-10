import { useEffect, useRef, useState } from "react";

import { LIMIAR_DE_SILENCIO, TEMPO_PARA_AVISAR_SILENCIO_MS } from "../shared/ditado/gravacao";
import { formatarCronometro, TEXTO_DO_SILENCIO } from "../shared/ditado/texto";
import type { FaseDoDitado } from "../shared/ditado/useDitado";

/** Quantas barras a onda tem; cada uma é um instante da voz, e a mais nova fica à direita. */
const BARRAS_DA_ONDA = 28;
/** A onda avança uma barra a cada tanto tempo. */
const PASSO_DA_ONDA_MS = 80;
/** Com movimento reduzido, o nível estático só é redesenhado neste intervalo. */
const PASSO_ESTATICO_MS = 250;
/** Altura mínima de uma barra (fração da altura), para a onda nunca sumir. */
const ALTURA_MINIMA = 0.08;

function prefereMovimentoReduzido(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

interface PropsDaGravacao {
  lerNivel: () => number | null;
  aoConcluir: () => void;
  aoDescartar: () => void;
}

/**
 * Enquanto grava: ponto vermelho, cronômetro, ondas que seguem a voz e o aviso
 * de silêncio. Tudo vive num único `requestAnimationFrame` que lê o nível do
 * microfone; as barras são desenhadas direto no DOM (sem estado por quadro).
 * Ao desmontar (concluir, descartar ou sair da tela) o laço para.
 */
function PainelGravando({ lerNivel, aoConcluir, aoDescartar }: PropsDaGravacao) {
  const barras = useRef<Array<HTMLSpanElement | null>>([]);
  const [segundos, setSegundos] = useState(0);
  const [semSom, setSemSom] = useState(false);

  useEffect(() => {
    const reduzido = prefereMovimentoReduzido();
    const inicio = Date.now();
    const historico: number[] = new Array<number>(BARRAS_DA_ONDA).fill(0);
    let ultimaVoz = inicio;
    let ultimoPasso = inicio;
    let pico = 0;
    let quadro = 0;

    function desenhar(): void {
      barras.current.forEach((barra, i) => {
        if (barra === null) return;
        // Movimento reduzido: todas as barras mostram o mesmo nível, sem onda correndo.
        const nivel = reduzido ? (historico[BARRAS_DA_ONDA - 1] ?? 0) : (historico[i] ?? 0);
        barra.style.transform = `scaleY(${Math.max(ALTURA_MINIMA, nivel).toFixed(3)})`;
      });
    }

    function passo(): void {
      const agora = Date.now();
      setSegundos(Math.floor((agora - inicio) / 1000));
      const nivel = lerNivel();
      if (nivel !== null) {
        pico = Math.max(pico, nivel);
        if (nivel >= LIMIAR_DE_SILENCIO) ultimaVoz = agora;
        setSemSom(agora - ultimaVoz >= TEMPO_PARA_AVISAR_SILENCIO_MS);
      }
      if (agora - ultimoPasso >= (reduzido ? PASSO_ESTATICO_MS : PASSO_DA_ONDA_MS)) {
        ultimoPasso = agora;
        historico.shift();
        historico.push(pico);
        pico = 0;
        desenhar();
      }
      quadro = requestAnimationFrame(passo);
    }

    quadro = requestAnimationFrame(passo);
    return () => cancelAnimationFrame(quadro);
  }, [lerNivel]);

  return (
    <>
      <div className="linha-do-ditado">
        <span className="ponto-do-ditado" aria-hidden="true" />
        <span className="mono cronometro-do-ditado" aria-hidden="true" data-testid="cronometro-do-ditado">
          {formatarCronometro(segundos)}
        </span>
        <span className="onda-do-ditado" aria-hidden="true" data-testid="onda-do-ditado">
          {Array.from({ length: BARRAS_DA_ONDA }, (_, i) => (
            <span
              key={i}
              className="barra-da-onda"
              ref={(elemento) => {
                barras.current[i] = elemento;
              }}
            />
          ))}
        </span>
        <button type="button" className="botao-do-ditado botao-do-ditado-principal" onClick={aoConcluir}>
          Concluir
        </button>
        <button type="button" className="botao-do-ditado" onClick={aoDescartar}>
          Descartar
        </button>
      </div>
      <span className="dica-do-ditado">Enter conclui, Esc descarta</span>
      <span className="aviso-de-silencio-do-ditado" role="status" aria-live="polite">
        {semSom ? TEXTO_DO_SILENCIO : ""}
      </span>
    </>
  );
}

interface Props {
  fase: FaseDoDitado;
  baixando: number | null;
  segundosDeAudio: number | null;
  lerNivel: () => number | null;
  /** O texto acabou de entrar no campo (some sozinho). */
  inserido: boolean;
  aoConcluir: () => void;
  aoDescartar: () => void;
}

/**
 * O retorno visual do ditado, ao lado do microfone: pedindo a permissão,
 * gravando (cronômetro e ondas), baixando o modelo ou transcrevendo, e o aviso
 * de que o texto entrou. Fora disso não renderiza nada.
 */
export function PainelDoDitado({ fase, baixando, segundosDeAudio, lerNivel, inserido, aoConcluir, aoDescartar }: Props) {
  if (fase === "parado" && !inserido) return null;

  let conteudo;
  if (fase === "pedindo-microfone") {
    conteudo = (
      <>
        <div className="linha-do-ditado">
          <span className="girador-do-ditado" aria-hidden="true" />
          <strong className="titulo-do-ditado">Permita o acesso ao microfone</strong>
        </div>
        <span className="dica-do-ditado">O pedido aparece na tela. O áudio fica só neste computador.</span>
      </>
    );
  } else if (fase === "gravando") {
    conteudo = <PainelGravando lerNivel={lerNivel} aoConcluir={aoConcluir} aoDescartar={aoDescartar} />;
  } else if (fase === "transcrevendo" && baixando !== null) {
    conteudo = (
      <>
        <div className="linha-do-ditado">
          <strong className="titulo-do-ditado">Baixando o modelo de voz</strong>
          <span className="mono porcentagem-do-ditado" data-testid="porcentagem-do-ditado">
            {baixando}%
          </span>
        </div>
        <div
          className="trilho-do-ditado"
          role="progressbar"
          aria-label="Download do modelo de voz"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={baixando}
        >
          <span className="barra-do-download-do-ditado" style={{ width: `${baixando}%` }} />
        </div>
        <span className="dica-do-ditado">Só na primeira vez, uns 250 MB. Depois fica salvo neste computador.</span>
      </>
    );
  } else if (fase === "transcrevendo") {
    conteudo = (
      <>
        <div className="linha-do-ditado">
          <span className="girador-do-ditado" aria-hidden="true" />
          <strong className="titulo-do-ditado">
            {segundosDeAudio === null ? "Preparando o áudio" : `Transcrevendo ${segundosDeAudio} s de áudio`}
          </strong>
        </div>
        <span className="esqueleto-do-ditado" aria-hidden="true">
          <span />
          <span />
        </span>
      </>
    );
  } else {
    conteudo = (
      <div className="linha-do-ditado">
        <span className="visto-do-ditado" aria-hidden="true">
          ✓
        </span>
        <strong className="titulo-do-ditado">Texto adicionado ao campo</strong>
      </div>
    );
  }

  return (
    <div className={`painel-do-ditado painel-do-ditado-${inserido && fase === "parado" ? "inserido" : fase}`}>
      {conteudo}
    </div>
  );
}
