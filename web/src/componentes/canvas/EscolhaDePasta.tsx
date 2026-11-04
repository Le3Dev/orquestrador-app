import { useEffect, useRef, useState } from "react";

import { api, ErroDaApi, mensagemDeErro } from "../../shared/api/cliente";
import type { PastaDeProjeto } from "../../shared/api/tipos";
import { IconePasta } from "../Icones";
import { NavegadorDePastas } from "./NavegadorDePastas";

export const TAMANHO_MAXIMO_DO_NOME = 60;

interface Props {
  /** A pasta escolhida, ou "" enquanto nenhuma foi escolhida. */
  pasta: string;
  /** Pastas dos orquestradores que já existem, a mais recente primeiro. */
  recentes: readonly PastaDeProjeto[];
  aoEscolher: (caminho: string) => void;
  conectado: boolean;
  nome: string;
  aoMudarNome: (nome: string) => void;
  /** O nome foi editado à mão: aparece o atalho para voltar ao nome da pasta. */
  nomeEditado: boolean;
  aoUsarNomeDaPasta: () => void;
}

type Situacao = "inicio" | "janela_aberta" | "navegando";

/**
 * A pasta de trabalho da criação, com o nome do orquestrador como título do
 * cartão. O caminho principal é a janela de escolher pasta do próprio sistema,
 * a mesma de qualquer programa. As recentes escolhem com um clique, e o
 * navegador interno fica de reserva (e abre sozinho se a janela não estiver
 * disponível).
 */
export function EscolhaDePasta({
  pasta,
  recentes,
  aoEscolher,
  conectado,
  nome,
  aoMudarNome,
  nomeEditado,
  aoUsarNomeDaPasta,
}: Props) {
  const [situacao, setSituacao] = useState<Situacao>("inicio");
  const [aviso, setAviso] = useState<string | null>(null);
  const janela = useRef<AbortController | null>(null);

  // Saiu da tela (descartou o rascunho) com a janela aberta: fecha a janela.
  useEffect(() => () => janela.current?.abort(), []);

  function escolher(caminho: string): void {
    setAviso(null);
    setSituacao("inicio");
    aoEscolher(caminho);
  }

  function abrirJanelaDoSistema(): void {
    const controle = new AbortController();
    janela.current = controle;
    setAviso(null);
    setSituacao("janela_aberta");
    // A janela abre na pasta atual ou, sem ela, na recente mais nova.
    api
      .escolherPastaNoSistema(pasta || recentes[0]?.caminho, controle.signal)
      .then(({ caminho }) => {
        if (caminho !== null) {
          aoEscolher(caminho);
        }
        setSituacao("inicio");
      })
      .catch((falha: unknown) => {
        if (controle.signal.aborted) {
          return;
        }
        setAviso(mensagemDeErro(falha));
        // Sem janela no sistema: o navegador daqui mesmo assume.
        setSituacao(falha instanceof ErroDaApi && falha.status === 503 ? "navegando" : "inicio");
      })
      .finally(() => {
        if (janela.current === controle) {
          janela.current = null;
        }
      });
  }

  function cancelarJanela(): void {
    janela.current?.abort();
    janela.current = null;
    setSituacao("inicio");
  }

  const esperando = situacao === "janela_aberta";

  return (
    <div className="flex flex-col gap-2.5">
      {situacao === "navegando" ? (
        <div className="flex flex-col gap-2">
          {aviso !== null && <p className="text-[11px] text-warning">{aviso}</p>}
          <NavegadorDePastas aoEscolher={escolher} conectado={conectado} />
          <button
            type="button"
            className="botao-de-texto self-start text-[12px] text-muted"
            onClick={() => {
              setAviso(null);
              setSituacao("inicio");
            }}
          >
            ‹ voltar
          </button>
        </div>
      ) : esperando ? (
        <div className="espera-da-janela" role="status" aria-live="polite">
          <span className="ponto-de-status ponto-de-status-ativo" aria-hidden="true" />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <strong className="font-titulo text-[13px] font-medium text-primary">Abrimos a janela de escolher pasta</strong>
            <span className="hint">Escolha a pasta nela. Não apareceu? Olhe a barra de tarefas ou o Dock.</span>
          </div>
          <button type="button" className="btn btn-sm btn-ghost shrink-0" onClick={cancelarJanela}>
            cancelar
          </button>
        </div>
      ) : pasta === "" ? (
        <div className="cartao-da-pasta cartao-da-pasta-vazio">
          <IconePasta tamanho={20} className="shrink-0 text-muted" />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-[13.5px] text-primary">Nenhuma pasta escolhida</span>
            <span className="text-[11.5px] text-muted">Escolha uma recente ou abra a janela do sistema</span>
          </div>
          <button type="button" className="botao-de-destaque shrink-0" disabled={!conectado} onClick={abrirJanelaDoSistema}>
            Escolher pasta…
          </button>
        </div>
      ) : (
        <div className="cartao-da-pasta">
          <IconePasta tamanho={20} className="shrink-0 text-active" />
          <div className="flex min-w-0 flex-1 flex-col">
            <label className="-ml-1.5 flex min-w-0 items-center gap-1" title="Nome do orquestrador (clique para editar)">
              <input
                className="nome-editavel"
                aria-label="Nome do orquestrador"
                value={nome}
                maxLength={TAMANHO_MAXIMO_DO_NOME}
                placeholder="nome do orquestrador"
                spellCheck={false}
                size={Math.max(12, Math.min(40, nome.length + 2))}
                onChange={(evento) => aoMudarNome(evento.target.value)}
              />
              <IconeDeLapis className="text-muted" />
            </label>
            <span className="flex min-w-0 items-center gap-2">
              <span className="mono truncate text-[11.5px] text-muted" title={pasta}>
                {pasta}
              </span>
              {nomeEditado && (
                <button type="button" className="botao-link shrink-0 text-[11.5px]" onClick={aoUsarNomeDaPasta}>
                  usar nome da pasta
                </button>
              )}
            </span>
          </div>
          <button
            type="button"
            className="btn btn-sm btn-outline shrink-0"
            disabled={!conectado}
            onClick={abrirJanelaDoSistema}
          >
            Trocar…
          </button>
        </div>
      )}

      {aviso !== null && situacao === "inicio" && (
        <p className="mono texto-longo text-[11.5px] text-error">✗ {aviso}</p>
      )}

      {situacao !== "navegando" && (
        <div className="flex flex-wrap items-center gap-2">
          {recentes.length > 0 && (
            <>
              <span className="mono text-[11px] text-muted">recentes</span>
              <ul className="flex min-w-0 flex-wrap gap-2" aria-label="Pastas recentes">
                {recentes.map((recente) => (
                  <li key={recente.caminho} className="min-w-0">
                    <button
                      type="button"
                      className="chip-de-pasta"
                      title={recente.caminho}
                      aria-pressed={recente.caminho === pasta}
                      disabled={esperando}
                      onClick={() => escolher(recente.caminho)}
                    >
                      <IconePasta tamanho={13} className="shrink-0" />
                      <span className="truncate">{recente.nome}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          <button
            type="button"
            className="botao-de-texto ml-auto text-[11.5px] text-muted"
            disabled={esperando}
            onClick={() => {
              setAviso(null);
              setSituacao("navegando");
            }}
          >
            ou procurar aqui dentro
          </button>
        </div>
      )}
    </div>
  );
}

/** Lápis de traço: o que tem ele ao lado se edita clicando. */
export function IconeDeLapis({ tamanho = 13, className = "" }: { tamanho?: number; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      width={tamanho}
      height={tamanho}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
    >
      <path d="M4 20h4L19 9l-4-4L4 16z" />
      <path d="m13.5 6.5 4 4" />
    </svg>
  );
}
