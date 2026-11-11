import { useEffect, useRef } from "react";

import { IconeFechar, IconeSkills } from "../Icones";
import { ListaDeSkills, type OrquestradorParaSkills } from "./ListaDeSkills";

interface Props {
  /** Os orquestradores abertos no canvas: cada um com skills de projeto ganha um grupo. */
  orquestradores: readonly OrquestradorParaSkills[];
  aoFechar: () => void;
}

/**
 * As skills cadastradas no Claude Code, logo abaixo da ilha do canvas (aberto pelo item Skills do menu
 * `+ Novo`). Só leitura: o conteúdo é a `ListaDeSkills`, a mesma da aba Skills das Configurações.
 */
export function PainelDeSkills({ orquestradores, aoFechar }: Props) {
  // Esc fecha, como no painel de subagentes: só o Esc dado no painel (ou sem nada focado).
  const painel = useRef<HTMLElement>(null);
  useEffect(() => {
    function aoTeclar(evento: KeyboardEvent) {
      const alvo = evento.target;
      const noPainel = alvo === document.body || (alvo instanceof Node && painel.current?.contains(alvo) === true);
      if (evento.key === "Escape" && !evento.defaultPrevented && noPainel) {
        aoFechar();
      }
    }
    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [aoFechar]);

  return (
    <section ref={painel} className="painel-flutuante painel-da-barra painel-de-skills mt-2" aria-label="Skills do Claude Code">
      <header className="painel-da-barra-cabecalho">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="flex items-center gap-1.5 text-[14px]">
            <IconeSkills tamanho={16} className="text-active" />
            Skills do Claude Code
          </h2>
          <span className="text-support">
            O que o Claude Code tem cadastrado. Os agentes carregam a skill certa pelo pedido.
          </span>
        </div>
        <button type="button" className="botao-icone shrink-0" aria-label="Fechar skills" onClick={aoFechar}>
          <IconeFechar tamanho={16} />
        </button>
      </header>

      <ListaDeSkills orquestradores={orquestradores} />

      <div className="painel-da-barra-rodape">
        <button type="button" className="btn btn-sm btn-ghost ml-auto" onClick={aoFechar}>
          Fechar
        </button>
      </div>
    </section>
  );
}
