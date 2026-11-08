import { useState, type ComponentProps } from "react";

import { useAjustesDoAplicativo } from "../../shared/hooks/useAjustesDoAplicativo";
import { rodandoNoMac } from "../../shared/ponteDoDesktop";
import { IconeOrquestrador } from "../Icones";
import { AvisoDeAtualizacao } from "./AvisoDeAtualizacao";
import { ControlesDaJanela } from "./ControlesDaJanela";
import { ErroDoCanvas, StatusDoCanvas } from "./PaineisDoCanvas";
import { PainelDeConfiguracoesDoApp } from "./PainelDeConfiguracoesDoApp";

/**
 * No Mac, espaço à esquerda para as 3 bolinhas nativas da janela (posição em
 * electron/mac.js: 14px da borda e cerca de 52px de largura).
 */
const ESPACO_DAS_BOLINHAS_DO_MAC = 80;

type PropsDaBarraDeTitulo = Omit<ComponentProps<typeof StatusDoCanvas>, "naBarraDeTitulo"> & {
  /** Abre a paleta de comandos (o mesmo do Ctrl+K). */
  aoBuscar: () => void;
  /** Pedidos rodando agora: reiniciar para atualizar o app pede confirmação. */
  pedidosEmAndamento: number;
};

/**
 * Barra de título do app desktop (só no Electron): faixa de 36 px no topo, de
 * ponta a ponta (a janela não tem barra nem botões nativos).
 *
 * Esquerda: ícone e nome do app. Centro: o campo "Buscar ou executar…", que
 * abre a paleta de comandos. Direita: o aviso de atualização (só baixando ou
 * pronta), o status (situação, cotas e RAM) e, colados a ele, o ⚙
 * Configurações (preferências da tela e, pelo painel, a janela dos Ajustes de
 * pastas e Claude Code) e os botões ─ ☐ ✕ do próprio app.
 * No Mac os botões ─ ☐ ✕ saem: ficam as bolinhas nativas, à esquerda, num
 * espaço reservado antes do ícone.
 * A faixa inteira arrasta a janela (e o duplo clique nela maximiza); o que é
 * clicável é `no-drag`.
 */
export function BarraDeTituloDoApp({ aoBuscar, pedidosEmAndamento, ...status }: PropsDaBarraDeTitulo) {
  const ajustes = useAjustesDoAplicativo();
  const [mac] = useState(rodandoNoMac);

  return (
    <header
      className="barra-de-titulo"
      data-testid="barra-de-titulo"
      style={mac ? { paddingLeft: ESPACO_DAS_BOLINHAS_DO_MAC } : undefined}
    >
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
        <AvisoDeAtualizacao pedidosEmAndamento={pedidosEmAndamento} />
        <StatusDoCanvas naBarraDeTitulo {...status} />
        <div className="botoes-da-barra-de-titulo">
          <PainelDeConfiguracoesDoApp
            ajustes={ajustes}
            alinhamento="direita"
            classeDaAncora="no-drag"
            classeDoBotao="botao-da-janela botao-dos-ajustes no-drag"
            conteudoDoBotao="⚙"
          />
          {!mac && <span className="separador-da-barra-de-titulo" aria-hidden="true" />}
          {!mac && <ControlesDaJanela />}
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
