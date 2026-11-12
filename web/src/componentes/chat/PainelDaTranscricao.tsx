import { type ReactNode, useEffect, useMemo, useRef } from "react";

import { montarPedidoDeResposta } from "../../shared/escuta/pedidoDeResposta";
import type { EstadoDaEscuta } from "../../shared/escuta/sessaoDaEscuta";

import "./PainelDaTranscricao.css";

export interface PropsDoPainelDaTranscricao {
  readonly legenda: EstadoDaEscuta["legenda"];
  readonly escutando: boolean;
  /** Uma resposta já está sendo gerada: desabilita "Responder agora". */
  readonly respondendo: boolean;
  /** Recebe o texto de `montarPedidoDeResposta`. */
  readonly aoResponderAgora: (pedido: string) => void;
  readonly aoFechar: () => void;
  /** Espaço do cabeçalho para o `IndicadorDaEscuta`. */
  readonly indicador?: ReactNode;
}

/** A lista só acompanha o fim se o usuário estiver a menos disto (px) dele. */
const MARGEM_DO_FIM_PX = 24;

const ATALHO_DE_RESPONDER_AGORA = "Ctrl+Shift+Enter";

const doisDigitos = (numero: number): string => String(numero).padStart(2, "0");

function Hora({ momentoMs }: { readonly momentoMs: number }) {
  if (!Number.isFinite(momentoMs)) return null;
  const data = new Date(momentoMs);
  return (
    <time className="painel-transcricao-hora" dateTime={data.toISOString()}>
      {`${doisDigitos(data.getHours())}:${doisDigitos(data.getMinutes())}:${doisDigitos(data.getSeconds())}`}
    </time>
  );
}

/**
 * Transcrição ao vivo do áudio do computador, separada da conversa: as falas
 * com a hora (a pergunta detectada em destaque) e, no fim, o enunciado em
 * andamento, com o confirmado em texto normal e o parcial em cinza itálico.
 * Rola sozinha para o fim, a não ser que o usuário tenha rolado para cima.
 * "Responder agora" envia as falas recentes ao chat. A raiz é uma área
 * clicável do modo invisível (`data-area-clicavel`).
 */
export function PainelDaTranscricao({
  legenda,
  escutando,
  respondendo,
  aoResponderAgora,
  aoFechar,
  indicador,
}: PropsDoPainelDaTranscricao) {
  const lista = useRef<HTMLDivElement>(null);
  const noFim = useRef(true);
  const { frases, emAndamento } = legenda;

  const pedido = useMemo(
    () => montarPedidoDeResposta(frases, emAndamento, Date.now()),
    [frases, emAndamento],
  );

  const textoEmAndamento = emAndamento === null ? "" : `${emAndamento.confirmado}${emAndamento.parcial}`;
  useEffect(() => {
    const elemento = lista.current;
    if (elemento !== null && noFim.current) elemento.scrollTop = elemento.scrollHeight;
  }, [frases, textoEmAndamento]);

  const aoRolar = () => {
    const elemento = lista.current;
    if (elemento === null) return;
    noFim.current = elemento.scrollHeight - elemento.scrollTop - elemento.clientHeight <= MARGEM_DO_FIM_PX;
  };

  const confirmado = emAndamento?.confirmado.trim() ?? "";
  const parcial = emAndamento?.parcial.trim() ?? "";
  const vazio = frases.length === 0 && confirmado === "" && parcial === "";
  const desabilitado = respondendo || pedido === null;

  return (
    <section className="painel-transcricao" data-area-clicavel aria-label="Transcrição">
      <header className="painel-transcricao-cabecalho">
        <h2 className="painel-transcricao-titulo">Transcrição</h2>
        {indicador}
        <button
          type="button"
          className="painel-transcricao-fechar"
          aria-label="Fechar a transcrição"
          title="Fechar a transcrição"
          onClick={aoFechar}
        >
          ×
        </button>
      </header>

      <div
        ref={lista}
        className="painel-transcricao-lista"
        role="log"
        aria-live="polite"
        aria-label="Falas ouvidas"
        onScroll={aoRolar}
      >
        {vazio && (
          <p className="painel-transcricao-vazio">
            {escutando ? "Ouvindo… nada falado ainda." : "Ligue a escuta para ver a transcrição aqui."}
          </p>
        )}
        {frases.map((frase) => (
          <p
            key={frase.id}
            className={`painel-transcricao-fala${frase.pergunta ? " painel-transcricao-pergunta" : ""}`}
            data-testid="fala-da-transcricao"
          >
            <Hora momentoMs={frase.inicioMs} />
            <span className="painel-transcricao-texto">{frase.texto.trim()}</span>
            {frase.pergunta && <span className="painel-transcricao-marca">pergunta</span>}
          </p>
        ))}
        {emAndamento !== null && (confirmado !== "" || parcial !== "") && (
          <p className="painel-transcricao-fala painel-transcricao-andamento" data-testid="fala-em-andamento">
            <Hora momentoMs={emAndamento.inicioMs} />
            <span className="painel-transcricao-texto">
              {confirmado !== "" && <span className="painel-transcricao-confirmado">{confirmado}</span>}
              {confirmado !== "" && parcial !== "" && " "}
              {parcial !== "" && <span className="painel-transcricao-parcial">{parcial}</span>}
            </span>
          </p>
        )}
      </div>

      <footer className="painel-transcricao-rodape">
        <button
          type="button"
          className="painel-transcricao-responder"
          title={`Responder agora (${ATALHO_DE_RESPONDER_AGORA})`}
          disabled={desabilitado}
          onClick={() => {
            if (pedido !== null) aoResponderAgora(pedido);
          }}
        >
          Responder agora
        </button>
      </footer>
    </section>
  );
}
