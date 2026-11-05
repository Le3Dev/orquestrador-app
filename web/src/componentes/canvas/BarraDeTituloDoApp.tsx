import type { ComponentProps } from "react";

import { useAjustesDoAplicativo } from "../../shared/hooks/useAjustesDoAplicativo";
import { IconeOrquestrador } from "../Icones";
import { ControlesDaJanela } from "./ControlesDaJanela";
import { ErroDoCanvas, StatusDoCanvas } from "./PaineisDoCanvas";

type PropsDaBarraDeTitulo = Omit<ComponentProps<typeof StatusDoCanvas>, "naBarraDeTitulo"> & {
  /** Abre a paleta de comandos (o mesmo do Ctrl+K). */
  aoBuscar: () => void;
};

/**
 * Barra de título do app desktop (só no Electron): faixa de 36 px no topo, de
 * ponta a ponta (a janela não tem barra nem botões nativos).
 *
 * Esquerda: ícone e nome do app. Centro: o campo "Buscar ou executar…", que
 * abre a paleta de comandos. Direita: o status (situação, cotas e RAM) e,
 * colados a ele, o ⚙ (pastas e Claude Code) e os botões ─ ☐ ✕ do próprio app.
 * A faixa inteira arrasta a janela (e o duplo clique nela maximiza); o que é
 * clicável é `no-drag`.
 */
export function BarraDeTituloDoApp({ aoBuscar, ...status }: PropsDaBarraDeTitulo) {
  const ajustes = useAjustesDoAplicativo();

  return (
    <header className="barra-de-titulo" data-testid="barra-de-titulo">
      <div className="identidade-da-barra-de-titulo">
        <span className="no-orquestrador-icone shrink-0">
          <IconeOrquestrador tamanho={14} />
        </span>
        <span className="titulo-da-barra-de-titulo">Orquestrador de Agentes</span>
      </div>
      <div className="centro-da-barra-de-titulo">
        <button
          type="button"
          className="campo-de-busca-da-barra no-drag"
          onClick={aoBuscar}
          aria-label="Buscar ou executar (Ctrl+K)"
          aria-keyshortcuts="Control+K"
          title="Buscar ou executar: ações, orquestradores, notas e pedidos (Ctrl+K)"
        >
          <span className="icone-da-busca" aria-hidden="true">
            ⌕
          </span>
          <span className="texto-da-busca" aria-hidden="true">
            Buscar ou executar…
          </span>
          <kbd aria-hidden="true">Ctrl+K</kbd>
        </button>
      </div>
      <div className="direita-da-barra-de-titulo">
        <StatusDoCanvas naBarraDeTitulo {...status} />
        <div className="botoes-da-barra-de-titulo">
          {ajustes.disponivel && (
            <>
              <button
                type="button"
                className="botao-da-janela botao-dos-ajustes no-drag"
                onClick={() => void ajustes.abrir()}
                aria-label="Pastas e Claude Code"
                title="Pastas e Claude Code"
              >
                ⚙
              </button>
              <span className="separador-da-barra-de-titulo" aria-hidden="true" />
            </>
          )}
          <ControlesDaJanela />
        </div>
      </div>
      {ajustes.erro !== null && (
        <div className="erro-da-barra-de-titulo no-drag">
          <ErroDoCanvas erro={ajustes.erro} aoFechar={ajustes.descartarErro} />
        </div>
      )}
    </header>
  );
}
