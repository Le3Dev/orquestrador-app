import { type KeyboardEvent as EventoDeTecladoDoReact, useCallback, useEffect, useId, useRef, useState } from "react";

/**
 * Um botão de menu das barras (o `+ Novo ▾` do canvas e o ⚙ Configurações):
 * Enter, Espaço ou ↓ abrem no primeiro item, ↑ no último; ↑/↓ (e Home/End)
 * navegam; Enter ou Espaço ativam; Esc, Tab e clique fora fecham, e o foco
 * volta ao botão.
 */
export function useMenuDaBarra(total: number, aoAtivar: (indice: number) => void) {
  const [aberto, setAberto] = useState(false);
  const ancora = useRef<HTMLDivElement>(null);
  const botao = useRef<HTMLButtonElement>(null);
  const itens = useRef<(HTMLButtonElement | null)[]>([]);
  // O item que ganha o foco ao abrir: ↑ no botão abre no último.
  const focoAoAbrir = useRef(0);
  const idDoMenu = `${useId()}-menu`;

  const focarItem = (indice: number) => itens.current[indice]?.focus();

  const abrir = (indice: number) => {
    if (aberto) {
      focarItem(indice);
      return;
    }
    focoAoAbrir.current = indice;
    setAberto(true);
  };

  const fechar = useCallback((devolverFoco: boolean) => {
    setAberto(false);
    if (devolverFoco) {
      botao.current?.focus();
    }
  }, []);

  useEffect(() => {
    if (aberto) {
      itens.current[focoAoAbrir.current]?.focus();
    }
  }, [aberto]);

  // Clique fora (inclusive no canvas ou na barra de título) fecha.
  useEffect(() => {
    if (!aberto) {
      return;
    }
    const aoPressionar = (evento: MouseEvent) => {
      if (ancora.current !== null && evento.target instanceof Node && !ancora.current.contains(evento.target)) {
        fechar(true);
      }
    };
    document.addEventListener("mousedown", aoPressionar, true);
    return () => document.removeEventListener("mousedown", aoPressionar, true);
  }, [aberto, fechar]);

  const aoTeclarNoBotao = (evento: EventoDeTecladoDoReact<HTMLButtonElement>) => {
    if (evento.key === "ArrowDown") {
      evento.preventDefault();
      abrir(0);
    } else if (evento.key === "ArrowUp") {
      evento.preventDefault();
      abrir(total - 1);
    }
  };

  const aoTeclarNoMenu = (evento: EventoDeTecladoDoReact<HTMLDivElement>) => {
    const atual = itens.current.findIndex((item) => item !== null && item === evento.target);
    switch (evento.key) {
      case "ArrowDown":
        evento.preventDefault();
        focarItem((atual + 1) % total);
        break;
      case "ArrowUp":
        evento.preventDefault();
        focarItem(atual <= 0 ? total - 1 : atual - 1);
        break;
      case "Home":
        evento.preventDefault();
        focarItem(0);
        break;
      case "End":
        evento.preventDefault();
        focarItem(total - 1);
        break;
      case "Enter":
      case " ":
        evento.preventDefault();
        if (atual >= 0 && atual < total) {
          aoAtivar(atual);
        }
        break;
      case "Escape":
        evento.preventDefault();
        evento.stopPropagation();
        fechar(true);
        break;
      case "Tab":
        // Sem impedir o Tab: o foco volta ao botão e segue dali.
        fechar(true);
        break;
    }
  };

  /** Liga o item `indice` à lista de foco do menu. */
  const refDoItem = (indice: number) => (elemento: HTMLButtonElement | null) => {
    itens.current[indice] = elemento;
  };

  const propsDoBotao = {
    ref: botao,
    "aria-haspopup": "menu" as const,
    "aria-expanded": aberto,
    "aria-controls": aberto ? idDoMenu : undefined,
    onClick: () => (aberto ? fechar(false) : abrir(0)),
    onKeyDown: aoTeclarNoBotao,
  };

  return { aberto, ancora, idDoMenu, fechar, refDoItem, propsDoBotao, aoTeclarNoMenu };
}
