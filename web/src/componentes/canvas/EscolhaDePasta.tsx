import { useEffect, useRef, useState } from "react";

import { api, ErroDaApi, mensagemDeErro } from "../../shared/api/cliente";
import type { PastaDeProjeto } from "../../shared/api/tipos";
import { NavegadorDePastas } from "./NavegadorDePastas";

interface Props {
  /** Pastas dos orquestradores que já existem, a mais recente primeiro. */
  recentes: readonly PastaDeProjeto[];
  aoEscolher: (caminho: string) => void;
  conectado: boolean;
}

type Situacao = "inicio" | "janela_aberta" | "navegando";

/**
 * Passo 1 da criação: em qual pasta o Claude vai trabalhar. O caminho
 * principal é a janela de escolher pasta do próprio sistema, a mesma de
 * qualquer programa. As recentes escolhem com um clique, e o navegador
 * interno fica de reserva (e abre sozinho se a janela não estiver disponível).
 */
export function EscolhaDePasta({ recentes, aoEscolher, conectado }: Props) {
  const [situacao, setSituacao] = useState<Situacao>("inicio");
  const [aviso, setAviso] = useState<string | null>(null);
  const janela = useRef<AbortController | null>(null);

  // Saiu da tela (descartou o rascunho) com a janela aberta: fecha a janela.
  useEffect(() => () => janela.current?.abort(), []);

  function abrirJanelaDoSistema(): void {
    const controle = new AbortController();
    janela.current = controle;
    setAviso(null);
    setSituacao("janela_aberta");
    api
      .escolherPastaNoSistema(recentes[0]?.caminho, controle.signal)
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

  if (situacao === "navegando") {
    return (
      <div className="flex flex-col gap-2">
        {aviso !== null && <p className="hint text-warning">{aviso}</p>}
        <NavegadorDePastas aoEscolher={aoEscolher} conectado={conectado} />
        <button type="button" className="botao-de-texto self-start text-[12px] text-muted" onClick={() => setSituacao("inicio")}>
          ‹ voltar
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {situacao === "janela_aberta" ? (
        <div className="espera-da-janela" role="status" aria-live="polite">
          <span className="ponto-de-status ponto-de-status-ativo" aria-hidden="true" />
          <div className="flex flex-1 flex-col gap-0.5">
            <strong className="font-titulo text-[13px]">Abrimos a janela de escolher pasta</strong>
            <span className="hint">Escolha a pasta nela. Não apareceu? Olhe a barra de tarefas ou o Dock.</span>
          </div>
          <button type="button" className="btn btn-sm btn-ghost" onClick={cancelarJanela}>
            cancelar
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="botao-escolher-pasta"
          disabled={!conectado}
          onClick={abrirJanelaDoSistema}
        >
          <span aria-hidden="true">📁</span> Escolher pasta do projeto…
        </button>
      )}

      {aviso !== null && <p className="mono texto-longo text-[11.5px] text-error">✗ {aviso}</p>}

      {recentes.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="rotulo-tecnico">recentes</span>
          <ul className="flex flex-col" aria-label="Pastas recentes">
            {recentes.map((recente) => (
              <li key={recente.caminho}>
                <button
                  type="button"
                  className="item-de-pasta"
                  title={recente.caminho}
                  disabled={situacao === "janela_aberta"}
                  onClick={() => aoEscolher(recente.caminho)}
                >
                  <span aria-hidden="true">📁</span>
                  <span className="shrink-0">{recente.nome}</span>
                  <span className="mono truncate text-[11px] text-muted">{recente.caminho}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <button
        type="button"
        className="botao-de-texto self-start text-[12px] text-muted"
        disabled={situacao === "janela_aberta"}
        onClick={() => setSituacao("navegando")}
      >
        ou procurar a pasta aqui dentro
      </button>
    </div>
  );
}
