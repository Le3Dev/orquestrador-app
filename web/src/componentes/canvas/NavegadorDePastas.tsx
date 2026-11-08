import { type KeyboardEvent as TeclaNoCampo, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { api, mensagemDeErro } from "../../shared/api/cliente";
import type { NavegacaoDePastas } from "../../shared/api/tipos";
import { IconeFechar, IconePasta, IconeSetaAcima } from "../Icones";

interface Props {
  /** Pasta por onde começar a navegar; vazio parte da raiz dos projetos. */
  caminhoInicial?: string;
  /** Confirma a pasta escolhida (a que está aberta ou uma subpasta clicada duas vezes). */
  aoEscolher: (caminho: string) => void;
  /** Fecha sem escolher. */
  aoFechar: () => void;
}

/**
 * Janela para navegar pelo computador e escolher uma pasta de trabalho
 * qualquer, fora da raiz dos projetos. Como o seletor fica dentro de um nó do
 * canvas (que recorta o conteúdo), a janela vai num portal sobre a tela inteira.
 *
 * O caminho no topo é um campo: dá para digitar um caminho e teclar Enter. Se
 * ele não servir, a lista continua na pasta anterior e o erro aparece abaixo.
 */
export function NavegadorDePastas({ caminhoInicial, aoEscolher, aoFechar }: Props) {
  const [navegacao, setNavegacao] = useState<NavegacaoDePastas | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  // O texto do campo; difere de `navegacao.caminho` enquanto a pessoa digita.
  const [texto, setTexto] = useState("");
  const [erroDoCaminho, setErroDoCaminho] = useState<string | null>(null);
  const campo = useRef<HTMLInputElement>(null);
  // Só a resposta do pedido mais recente vale (cliques rápidos não se atropelam).
  const ultimoPedido = useRef(0);
  const idDoErro = useId();

  const alterado = texto !== (navegacao?.caminho ?? "");

  /**
   * Abre uma pasta e devolve a navegação nova (ou `null` se falhou). `digitado`:
   * o caminho veio do campo; o servidor recusa o que não for pasta e a lista
   * fica onde estava, com o erro sob o campo.
   */
  async function abrir(caminho?: string, digitado = false): Promise<NavegacaoDePastas | null> {
    const pedido = ++ultimoPedido.current;
    setCarregando(true);
    setErro(null);
    setErroDoCaminho(null);
    try {
      const resposta = await (digitado ? api.navegarPastas(caminho, { estrito: true }) : api.navegarPastas(caminho));
      if (pedido !== ultimoPedido.current) {
        return null;
      }
      setNavegacao(resposta);
      setTexto(resposta.caminho);
      return resposta;
    } catch (falha: unknown) {
      if (pedido !== ultimoPedido.current) {
        return null;
      }
      if (digitado) {
        setErroDoCaminho(mensagemDeErro(falha));
        campo.current?.focus();
      } else {
        setErro(mensagemDeErro(falha));
      }
      return null;
    } finally {
      if (pedido === ultimoPedido.current) {
        setCarregando(false);
      }
    }
  }

  /** Navega para o caminho digitado no campo. */
  function irParaODigitado(): Promise<NavegacaoDePastas | null> {
    if (texto.trim() === "") {
      setErroDoCaminho("Digite o caminho de uma pasta.");
      campo.current?.focus();
      return Promise.resolve(null);
    }
    return abrir(texto, true);
  }

  async function usarEstaPasta(): Promise<void> {
    if (alterado) {
      const resposta = await irParaODigitado();
      if (resposta !== null) {
        aoEscolher(resposta.caminho);
      }
      return;
    }
    if (navegacao !== null) {
      aoEscolher(navegacao.caminho);
    }
  }

  function aoTeclarNoCampo(evento: TeclaNoCampo<HTMLInputElement>): void {
    if (evento.key === "Enter") {
      evento.preventDefault();
      void irParaODigitado();
      return;
    }
    // Esc com texto alterado só desfaz a digitação; sem alteração, fecha a janela como sempre.
    if (evento.key === "Escape" && alterado) {
      evento.preventDefault();
      evento.stopPropagation();
      setTexto(navegacao?.caminho ?? "");
      setErroDoCaminho(null);
    }
  }

  // Abre na pasta inicial só na montagem; depois a navegação controla o caminho.
  useEffect(() => {
    void abrir(caminhoInicial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function aoTeclar(evento: KeyboardEvent): void {
      if (evento.key === "Escape" && !evento.defaultPrevented) {
        aoFechar();
      }
    }
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [aoFechar]);

  return createPortal(
    <div
      className="fundo-que-esmaece fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 nodrag nowheel nopan"
      onClick={aoFechar}
      role="presentation"
    >
      <div
        className="surgir flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-border-forte bg-surface shadow-2xl"
        onClick={(evento) => evento.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Escolher pasta do computador"
      >
        <div className="flex items-center gap-2 border-b border-border bg-surface-2 px-4 py-3">
          <strong className="font-titulo text-[12.5px] font-semibold">escolher pasta do computador</strong>
          <span className="flex-1" />
          <button type="button" className="botao-icone" title="Fechar" aria-label="Fechar" onClick={aoFechar}>
            <IconeFechar tamanho={16} />
          </button>
        </div>

        <div className="border-b border-border px-4 py-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn btn-sm btn-outline"
              disabled={carregando || navegacao?.pai == null}
              onClick={() => navegacao?.pai != null && void abrir(navegacao.pai)}
              title="Subir uma pasta"
            >
              <IconeSetaAcima tamanho={14} /> acima
            </button>
            <input
              ref={campo}
              type="text"
              className={`mono h-7 min-w-0 flex-1 rounded-md border bg-transparent px-2 text-[12px] text-secondary outline-none transition-colors focus:bg-surface-2 focus:text-primary ${
                erroDoCaminho !== null ? "border-error" : "border-transparent hover:border-border-forte focus:border-active"
              }`}
              aria-label="Caminho da pasta"
              aria-invalid={erroDoCaminho !== null}
              aria-describedby={erroDoCaminho !== null ? idDoErro : undefined}
              title={texto}
              placeholder={navegacao === null && carregando ? "…" : "/caminho/da/pasta"}
              value={texto}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              autoComplete="off"
              onChange={(evento) => {
                setTexto(evento.target.value);
                setErroDoCaminho(null);
              }}
              onKeyDown={aoTeclarNoCampo}
            />
          </div>
          {erroDoCaminho !== null && (
            <p id={idDoErro} role="alert" className="mono texto-longo mt-1.5 text-[11.5px] text-error">
              ✗ {erroDoCaminho}
            </p>
          )}
        </div>

        <div className="custom-scrollbar min-h-32 flex-1 overflow-y-auto p-1.5">
          {carregando && <p className="mono px-2 py-2 text-caption text-muted">carregando pastas…</p>}
          {erro !== null && <p className="mono texto-longo px-2 py-2 text-error">✗ {erro}</p>}
          {!carregando && erro === null && navegacao !== null && navegacao.pastas.length === 0 && (
            <p className="mono px-2 py-2 text-caption text-muted">nenhuma subpasta aqui.</p>
          )}
          {!carregando &&
            erro === null &&
            navegacao?.pastas.map((pasta) => (
              <button
                key={pasta.caminho}
                type="button"
                className="mono flex w-full items-center gap-2 truncate rounded px-2 py-1.5 text-left text-[12.5px] text-primary hover:bg-surface-3"
                title={`Abrir ${pasta.nome} (duplo clique escolhe)`}
                onClick={() => void abrir(pasta.caminho)}
                onDoubleClick={() => aoEscolher(pasta.caminho)}
              >
                <IconePasta tamanho={14} className="shrink-0" />
                <span className="truncate">{pasta.nome}</span>
              </button>
            ))}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border bg-surface-2 px-4 py-3">
          <span className="hint">Digite o caminho ou navegue pela lista.</span>
          <div className="flex shrink-0 gap-2">
            <button type="button" className="btn btn-sm btn-ghost" onClick={aoFechar}>
              cancelar
            </button>
            <button
              type="button"
              className="btn btn-sm btn-cta"
              disabled={navegacao === null && !alterado}
              onClick={() => void usarEstaPasta()}
            >
              usar esta pasta ⏎
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
