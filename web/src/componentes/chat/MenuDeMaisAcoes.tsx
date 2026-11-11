import { type KeyboardEvent as EventoDeTecla, type RefObject, useEffect, useId, useRef, useState } from "react";

/** Uma ação secundária da barra do chat (melhorar o pedido, fixar ao lado…). */
export interface ItemDoMenuDeMaisAcoes {
  readonly id: string;
  readonly rotulo: string;
  /** O balão ao passar o mouse; sem ele, vale o rótulo. */
  readonly titulo?: string;
  readonly desabilitado?: boolean;
  readonly aoEscolher: () => void;
}

interface Props {
  readonly itens: readonly ItemDoMenuDeMaisAcoes[];
  /** O campo do chat: o foco volta a ele quando o menu fecha por uma escolha. */
  readonly campo: RefObject<HTMLTextAreaElement | null>;
}

/** Os três pontinhos na horizontal. */
function IconeMaisAcoes() {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="5.5" cy="12" r="1.7" />
      <circle cx="12" cy="12" r="1.7" />
      <circle cx="18.5" cy="12" r="1.7" />
    </svg>
  );
}

/**
 * O menu "⋯" da barra do chat: guarda as ações menos usadas, para a barra ficar limpa. Acessível
 * por teclado: Enter/Espaço/seta para baixo abrem e levam ao primeiro item; setas, Home e End
 * andam pelos itens; Esc ou um clique fora fecham.
 */
export function MenuDeMaisAcoes({ itens, campo }: Props) {
  const [aberto, setAberto] = useState(false);
  const idDoMenu = useId();
  const raiz = useRef<HTMLDivElement>(null);
  const botao = useRef<HTMLButtonElement>(null);

  // Aberto, o foco vai ao primeiro item que dá para escolher.
  useEffect(() => {
    if (aberto) {
      raiz.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus();
    }
  }, [aberto]);

  // Esc e clique fora fecham (o Esc devolve o foco ao botão).
  useEffect(() => {
    if (!aberto) {
      return undefined;
    }
    const aoTeclar = (evento: KeyboardEvent): void => {
      if (evento.key === "Escape") {
        evento.preventDefault();
        evento.stopPropagation();
        setAberto(false);
        botao.current?.focus();
      }
    };
    const aoClicar = (evento: MouseEvent): void => {
      if (raiz.current !== null && !raiz.current.contains(evento.target as Node | null)) {
        setAberto(false);
      }
    };
    document.addEventListener("keydown", aoTeclar, true);
    document.addEventListener("mousedown", aoClicar);
    return () => {
      document.removeEventListener("keydown", aoTeclar, true);
      document.removeEventListener("mousedown", aoClicar);
    };
  }, [aberto]);

  function andarPelosItens(evento: EventoDeTecla<HTMLDivElement>): void {
    const habilitados = [...evento.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')];
    if (habilitados.length === 0) {
      return;
    }
    const atual = habilitados.indexOf(document.activeElement as HTMLButtonElement);
    const destinos: Readonly<Record<string, number>> = {
      ArrowDown: (atual + 1) % habilitados.length,
      ArrowUp: (atual <= 0 ? habilitados.length : atual) - 1,
      Home: 0,
      End: habilitados.length - 1,
    };
    const destino = destinos[evento.key];
    if (destino !== undefined) {
      evento.preventDefault();
      habilitados[destino]?.focus();
    }
  }

  function escolher(item: ItemDoMenuDeMaisAcoes): void {
    setAberto(false);
    campo.current?.focus();
    item.aoEscolher();
  }

  if (itens.length === 0) {
    return null;
  }

  return (
    <div ref={raiz} className="menu-de-mais-acoes">
      <button
        ref={botao}
        type="button"
        className="botao-icone botao-de-mais-acoes"
        aria-label="Mais ações"
        title="Mais ações"
        aria-haspopup="menu"
        aria-expanded={aberto}
        aria-controls={aberto ? idDoMenu : undefined}
        onClick={() => setAberto((atual) => !atual)}
        onKeyDown={(evento) => {
          if (evento.key === "ArrowDown" && !aberto) {
            evento.preventDefault();
            setAberto(true);
          }
        }}
      >
        <IconeMaisAcoes />
      </button>
      {aberto && (
        <div
          id={idDoMenu}
          role="menu"
          aria-label="Mais ações"
          className="lista-de-mais-acoes menu-do-seletor painel-flutuante"
          onKeyDown={andarPelosItens}
        >
          {itens.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              className="item-do-menu"
              title={item.titulo}
              disabled={item.desabilitado}
              onClick={() => escolher(item)}
            >
              {item.rotulo}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
