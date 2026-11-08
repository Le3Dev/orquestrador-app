import { type KeyboardEvent, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { EsforcoDeRaciocinio, ModeloClaude } from "../../shared/api/tipos";
import { ESFORCOS_DO_CHAT, MODELOS_DO_CHAT, nomeComVersao, rotuloDoEsforco } from "../../shared/modelos";

interface Props {
  id?: string;
  /** Nome acessível do botão, que diz de quem é o ajuste. Ex.: "Modelo do orquestrador". */
  rotulo: string;
  modelo: ModeloClaude;
  esforco: EsforcoDeRaciocinio;
  /** Oferece "ultracode" no esforço (só o orquestrador: o servidor recusa nos subagentes). */
  comUltracode?: boolean;
  aoEscolherModelo: (modelo: ModeloClaude) => void;
  aoEscolherEsforco: (esforco: EsforcoDeRaciocinio) => void;
}

type Vista = "raiz" | "esforco";

const MARGEM = 8;
const LARGURA_DA_FOLHA = 520;

function ehFolha(): boolean {
  return (
    window.innerWidth < LARGURA_DA_FOLHA ||
    (typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches)
  );
}

/**
 * Modelo e esforço de um ajuste da configuração, num botão-resumo que abre um
 * menu como o do Chat rápido. É controlado: só chama os callbacks. O menu vive
 * num portal no body (o canvas tem transformações e corta o que vaza).
 */
export function MenuDeModelo({ id, rotulo, modelo, esforco, comUltracode = false, aoEscolherModelo, aoEscolherEsforco }: Props) {
  const [aberto, setAberto] = useState(false);
  const [vista, setVista] = useState<Vista>("raiz");
  const [folha, setFolha] = useState(false);
  const [posicao, setPosicao] = useState<{ top: number; left: number } | null>(null);
  const raiz = useRef<HTMLDivElement>(null);
  const botao = useRef<HTMLButtonElement>(null);
  const lista = useRef<HTMLDivElement>(null);
  const idDoMenu = useId();
  const nome = nomeComVersao(modelo, null);
  const nomeDoEsforco = rotuloDoEsforco(esforco);
  const esforcos = ESFORCOS_DO_CHAT.filter((item) => comUltracode || item.esforco !== "ultracode");

  function abrir(): void {
    setFolha(ehFolha());
    setVista("raiz");
    setPosicao(null);
    setAberto(true);
  }

  function fechar(devolverFoco = true): void {
    setAberto(false);
    setVista("raiz");
    if (devolverFoco) {
      botao.current?.focus();
    }
  }

  // Abre para baixo; se não couber, para cima; limita à largura da janela.
  useLayoutEffect(() => {
    const elemento = lista.current;
    const referencia = botao.current;
    if (!aberto || folha || elemento === null || referencia === null) {
      return;
    }
    const alvo = referencia.getBoundingClientRect();
    const altura = elemento.offsetHeight;
    const largura = elemento.offsetWidth;
    const embaixo = alvo.bottom + 4;
    const cabeEmbaixo = embaixo + altura <= window.innerHeight - MARGEM;
    const top = cabeEmbaixo ? embaixo : Math.max(MARGEM, alvo.top - 4 - altura);
    const left = Math.max(MARGEM, Math.min(alvo.left, window.innerWidth - largura - MARGEM));
    setPosicao((atual) => (atual?.top === top && atual.left === left ? atual : { top, left }));
  }, [aberto, folha, vista]);

  // Foco no item escolhido (ou no primeiro) ao abrir e ao trocar de vista.
  useEffect(() => {
    if (!aberto) {
      return;
    }
    const itens = lista.current?.querySelectorAll<HTMLButtonElement>("button") ?? [];
    const marcado = [...itens].find((item) => item.getAttribute("aria-checked") === "true");
    (marcado ?? (vista === "esforco" ? itens[1] : itens[0]))?.focus();
  }, [aberto, vista]);

  // Esc, clique fora, rolagem e redimensionamento fecham.
  useEffect(() => {
    if (!aberto) {
      return;
    }
    const aoTeclar = (evento: globalThis.KeyboardEvent) => {
      if (evento.key === "Escape") {
        evento.preventDefault();
        evento.stopPropagation();
        fechar();
      }
    };
    const aoApertar = (evento: PointerEvent) => {
      const alvo = evento.target as Node | null;
      if (!raiz.current?.contains(alvo) && !lista.current?.contains(alvo)) {
        fechar(false);
      }
    };
    const aoRolar = (evento: Event) => {
      if (!lista.current?.contains(evento.target as Node | null)) {
        fechar(false);
      }
    };
    const aoRedimensionar = () => fechar(false);
    document.addEventListener("keydown", aoTeclar, true);
    document.addEventListener("pointerdown", aoApertar);
    window.addEventListener("scroll", aoRolar, true);
    window.addEventListener("resize", aoRedimensionar);
    return () => {
      document.removeEventListener("keydown", aoTeclar, true);
      document.removeEventListener("pointerdown", aoApertar);
      window.removeEventListener("scroll", aoRolar, true);
      window.removeEventListener("resize", aoRedimensionar);
    };
    // `fechar` só usa refs e setters estáveis.
  }, [aberto]);

  function aoTeclarNaLista(evento: KeyboardEvent<HTMLDivElement>): void {
    if (evento.key !== "ArrowDown" && evento.key !== "ArrowUp") {
      return;
    }
    evento.preventDefault();
    const itens = [...evento.currentTarget.querySelectorAll<HTMLButtonElement>("button")];
    const atual = itens.indexOf(document.activeElement as HTMLButtonElement);
    const passo = evento.key === "ArrowDown" ? 1 : -1;
    itens[(atual + passo + itens.length) % itens.length]?.focus();
  }

  const estilo = folha || posicao === null ? undefined : { top: posicao.top, left: posicao.left };
  // Antes de medir, o menu fica invisível (mas medido) para não piscar fora do lugar.
  const estiloFinal = folha ? undefined : { position: "fixed" as const, visibility: posicao === null ? ("hidden" as const) : undefined, ...estilo };

  return (
    <div ref={raiz} className="menu-de-modelo">
      <button
        ref={botao}
        id={id}
        type="button"
        className="menu-de-modelo-botao"
        aria-haspopup="menu"
        aria-expanded={aberto}
        aria-controls={aberto ? idDoMenu : undefined}
        aria-label={`${rotulo}: ${nome}, esforço ${nomeDoEsforco.toLowerCase()}`}
        onClick={() => (aberto ? fechar() : abrir())}
      >
        <span className="menu-de-modelo-nome">{nome}</span>
        <span className={`menu-de-modelo-detalhe ${esforco !== "padrao" ? "menu-de-modelo-detalhe-personalizado" : ""}`}>
          · esforço {nomeDoEsforco.toLowerCase()}
        </span>
        <svg
          className="menu-de-modelo-seta"
          aria-hidden="true"
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {aberto &&
        createPortal(
          <div
            ref={lista}
            id={idDoMenu}
            role="menu"
            aria-label={vista === "raiz" ? rotulo : "Esforço"}
            className={`menu-de-modelo-lista nodrag nowheel ${folha ? "menu-de-modelo-folha" : ""}`}
            style={estiloFinal}
            onKeyDown={aoTeclarNaLista}
          >
            {vista === "raiz" ? (
              <>
                {MODELOS_DO_CHAT.map((item) => {
                  const escolhido = item.modelo === modelo;
                  return (
                    <button
                      key={item.modelo}
                      type="button"
                      role="menuitemradio"
                      aria-checked={escolhido}
                      className="menu-de-modelo-item"
                      onClick={() => {
                        aoEscolherModelo(item.modelo);
                        fechar();
                      }}
                    >
                      <span className="menu-de-modelo-texto">
                        <span className="menu-de-modelo-titulo">
                          {item.nome} {item.versao}
                        </span>
                        <span className="menu-de-modelo-descricao">{item.descricao}</span>
                      </span>
                      <span aria-hidden="true" className="menu-de-modelo-marca">
                        {escolhido ? "✓" : ""}
                      </span>
                    </button>
                  );
                })}
                <hr className="menu-de-modelo-separador" />
                <button
                  type="button"
                  role="menuitem"
                  aria-haspopup="menu"
                  className="menu-de-modelo-item"
                  onClick={() => setVista("esforco")}
                >
                  <span className="menu-de-modelo-titulo">Esforço</span>
                  <span className="menu-de-modelo-valor">
                    {nomeDoEsforco} <span aria-hidden="true">›</span>
                  </span>
                </button>
              </>
            ) : (
              <>
                <div className="menu-de-modelo-cabecalho">
                  <button type="button" className="menu-de-modelo-voltar" aria-label="Voltar" onClick={() => setVista("raiz")}>
                    <span aria-hidden="true">‹</span>
                  </button>
                  <span className="menu-de-modelo-titulo">Esforço</span>
                </div>
                {esforcos.map((item) => {
                  const escolhido = item.esforco === esforco;
                  return (
                    <button
                      key={item.esforco}
                      type="button"
                      role="menuitemradio"
                      aria-checked={escolhido}
                      className="menu-de-modelo-item"
                      onClick={() => {
                        aoEscolherEsforco(item.esforco);
                        setVista("raiz");
                      }}
                    >
                      <span className="menu-de-modelo-titulo">{item.rotulo}</span>
                      <span aria-hidden="true" className="menu-de-modelo-marca">
                        {escolhido ? "✓" : ""}
                      </span>
                    </button>
                  );
                })}
              </>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
