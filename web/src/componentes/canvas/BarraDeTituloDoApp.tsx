import type { ComponentProps } from "react";

import { IconeOrquestrador } from "../Icones";
import { ControlesDaJanela } from "./ControlesDaJanela";
import { StatusDoCanvas } from "./PaineisDoCanvas";

type PropsDaBarraDeTitulo = Omit<ComponentProps<typeof StatusDoCanvas>, "naBarraDeTitulo">;

/**
 * Barra de título do app desktop (só no Electron): faixa de 36 px no topo, de
 * ponta a ponta (a janela não tem barra nem botões nativos).
 *
 * Esquerda: ícone e nome do app. Direita: o status (situação, cotas e RAM) e,
 * colados a ele, os botões ─ ☐ ✕ do próprio app. A faixa inteira arrasta a
 * janela (e o duplo clique nela maximiza); o que é clicável é `no-drag`.
 */
export function BarraDeTituloDoApp(status: PropsDaBarraDeTitulo) {
  return (
    <header className="barra-de-titulo" data-testid="barra-de-titulo">
      <div className="identidade-da-barra-de-titulo">
        <span className="no-orquestrador-icone shrink-0">
          <IconeOrquestrador tamanho={14} />
        </span>
        <span className="titulo-da-barra-de-titulo">Orquestrador de Agentes</span>
      </div>
      <div className="direita-da-barra-de-titulo">
        <StatusDoCanvas naBarraDeTitulo {...status} />
        <ControlesDaJanela />
      </div>
    </header>
  );
}
