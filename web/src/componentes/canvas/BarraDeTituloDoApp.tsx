import { useState } from "react";

import { useModoInvisivel } from "../../shared/hooks/useModoInvisivel";
import { rodandoNoMac } from "../../shared/ponteDoDesktop";
import { ControlesDaJanela } from "./ControlesDaJanela";

/**
 * No Mac, espaço à esquerda para as 3 bolinhas nativas da janela (posição em
 * electron/mac.js: 14px da borda e cerca de 52px de largura).
 */
const ESPACO_DAS_BOLINHAS_DO_MAC = 80;

/**
 * Barra de título do app desktop (só no Electron): faixa de 36 px no topo, de
 * ponta a ponta (a janela não tem barra nem botões nativos). Fica só com o
 * que é da janela: no Windows, os botões ─ ☐ ✕ do próprio app à direita; no
 * Mac, o espaço das bolinhas nativas à esquerda. O nome do app, o `+ Novo`, a
 * busca, o status, o aviso de atualização e as Configurações moram nas ilhas
 * do canvas.
 * A faixa inteira arrasta a janela (e o duplo clique nela maximiza); o que é
 * clicável é `no-drag`.
 */
export function BarraDeTituloDoApp() {
  const [mac] = useState(rodandoNoMac);
  const invisivel = useModoInvisivel();
  // No modo invisível a barra inteira fica escondida (CSS) e sem mouse. O botão de entrar fica no chat rápido.

  return (
    <header
      className={`barra-de-titulo ${invisivel.ativo ? "barra-de-titulo-invisivel" : ""}`}
      data-testid="barra-de-titulo"
      aria-hidden={invisivel.ativo ? true : undefined}
      style={mac ? { paddingLeft: ESPACO_DAS_BOLINHAS_DO_MAC } : undefined}
    >
      <div className="vao-da-barra-de-titulo" />
      {!mac && (
        <div className="botoes-da-barra-de-titulo">
          <ControlesDaJanela />
        </div>
      )}
    </header>
  );
}
