import { useEffect, useState } from "react";
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
 */
export function NavegadorDePastas({ caminhoInicial, aoEscolher, aoFechar }: Props) {
  const [navegacao, setNavegacao] = useState<NavegacaoDePastas | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  function abrir(caminho?: string): void {
    setCarregando(true);
    setErro(null);
    api
      .navegarPastas(caminho)
      .then((resposta) => setNavegacao(resposta))
      .catch((falha: unknown) => setErro(mensagemDeErro(falha)))
      .finally(() => setCarregando(false));
  }

  // Abre na pasta inicial só na montagem; depois a navegação controla o caminho.
  useEffect(() => {
    abrir(caminhoInicial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function aoTeclar(evento: KeyboardEvent): void {
      if (evento.key === "Escape") {
        aoFechar();
      }
    }
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [aoFechar]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 nodrag nowheel nopan"
      onClick={aoFechar}
      role="presentation"
    >
      <div
        className="flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-border-forte bg-surface shadow-2xl"
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

        <div className="flex items-center gap-2 border-b border-border px-4 py-2">
          <button
            type="button"
            className="btn btn-sm btn-outline"
            disabled={carregando || navegacao?.pai == null}
            onClick={() => navegacao?.pai != null && abrir(navegacao.pai)}
            title="Subir uma pasta"
          >
            <IconeSetaAcima tamanho={14} /> acima
          </button>
          <span className="mono min-w-0 flex-1 truncate text-[12px] text-secondary" title={navegacao?.caminho ?? ""}>
            {navegacao?.caminho ?? "…"}
          </span>
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
                onClick={() => abrir(pasta.caminho)}
                onDoubleClick={() => aoEscolher(pasta.caminho)}
              >
                <IconePasta tamanho={14} className="shrink-0" />
                <span className="truncate">{pasta.nome}</span>
              </button>
            ))}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border bg-surface-2 px-4 py-3">
          <span className="hint">Abra a pasta e clique em "Usar esta pasta".</span>
          <div className="flex gap-2">
            <button type="button" className="btn btn-sm btn-ghost" onClick={aoFechar}>
              cancelar
            </button>
            <button
              type="button"
              className="btn btn-sm btn-cta"
              disabled={navegacao === null}
              onClick={() => navegacao !== null && aoEscolher(navegacao.caminho)}
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
