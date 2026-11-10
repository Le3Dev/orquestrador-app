import {
  type MouseEvent as EventoDeMouseDoReact,
  type ReactNode,
  type Ref,
  type SyntheticEvent,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { ControlesDoNo } from "./ControlesDoNo";

/** Eventos do modal não sobem até o nó: o React Flow não arrasta nem seleciona por baixo. */
function naoPropagar(evento: SyntheticEvent): void {
  evento.stopPropagation();
}

/**
 * Onde a tela cheia começa: logo abaixo da barra de título do app desktop, que
 * fica inteira e clicável (os botões da janela do sistema, o arraste). No
 * navegador não há barra, e o topo é o da janela.
 */
function topoDaTelaCheia(): number {
  return document.querySelector(".barra-de-titulo")?.getBoundingClientRect().bottom ?? 0;
}

/**
 * A janela em tela cheia de um artefato ou de uma prévia: um modal no
 * `document.body`, fora do viewport do React Flow (não escala com o zoom). Esc,
 * o fechar da barra e um clique no fundo fecham.
 *
 * A barra leva o ícone, o título, o selo (ex.: "v2"), a navegação (voltar e
 * avançar, quando existe) e, nos dois cantos, os controles de janela com só o
 * fechar (o Mac desenha no início, os demais no fim). O corpo é o `children`;
 * `corpoRef` dá o elemento dele (a vista nativa da prévia o mede para se encaixar).
 */
export function JanelaEmTelaCheia({
  titulo,
  icone,
  selo,
  navegacao,
  aoFechar,
  corpoRef,
  children,
}: {
  titulo: string;
  icone: ReactNode;
  selo?: ReactNode;
  /** Os botões de voltar e avançar, quando a página os tem. */
  navegacao?: ReactNode;
  aoFechar: () => void;
  corpoRef?: Ref<HTMLDivElement>;
  children: ReactNode;
}) {
  const caixa = useRef<HTMLDivElement>(null);
  const idDoTitulo = useId();
  const [topo] = useState(topoDaTelaCheia);

  useEffect(() => {
    caixa.current?.focus({ preventScroll: true });
  }, []);

  // Esc de qualquer lugar da janela (menos de dentro da página, que é outro documento).
  useEffect(() => {
    const aoTeclar = (evento: KeyboardEvent) => {
      if (evento.key === "Escape") {
        evento.preventDefault();
        evento.stopPropagation();
        aoFechar();
      }
    };
    window.addEventListener("keydown", aoTeclar, true);
    return () => window.removeEventListener("keydown", aoTeclar, true);
  }, [aoFechar]);

  const aoPressionarOFundo = (evento: EventoDeMouseDoReact<HTMLDivElement>) => {
    evento.stopPropagation();
    if (evento.target === evento.currentTarget) {
      aoFechar();
    }
  };

  return createPortal(
    <div
      data-testid="fundo-da-tela-cheia"
      className="nokey fundo-que-esmaece fixed inset-x-0 bottom-0 z-50 flex items-stretch justify-center bg-screen-bg/70 p-4"
      style={{ top: topo }}
      onMouseDown={aoPressionarOFundo}
      onClick={naoPropagar}
      onDoubleClick={naoPropagar}
      onPointerDown={naoPropagar}
      onContextMenu={naoPropagar}
      onWheel={naoPropagar}
      onKeyDown={naoPropagar}
      onKeyUp={naoPropagar}
    >
      <div
        ref={caixa}
        role="dialog"
        aria-modal="true"
        aria-labelledby={idDoTitulo}
        tabIndex={-1}
        className="painel-flutuante surgir janela-em-tela-cheia outline-none"
      >
        <div className="barra-da-tela-cheia">
          <ControlesDoNo lado="inicio" objeto="a tela cheia" aoFechar={aoFechar} dicaDoFechar="Fechar a tela cheia (Esc)" />
          {icone}
          <h2 id={idDoTitulo} className="titulo-do-artefato" title={titulo}>
            {titulo}
          </h2>
          {selo}
          <span className="flex-1" />
          {navegacao}
          <span className="text-support">Esc fecha</span>
          <ControlesDoNo lado="fim" objeto="a tela cheia" aoFechar={aoFechar} dicaDoFechar="Fechar a tela cheia (Esc)" />
        </div>
        <div ref={corpoRef} className="corpo-da-tela-cheia">
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}
