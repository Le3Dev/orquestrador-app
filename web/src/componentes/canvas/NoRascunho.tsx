import { type NodeProps, NodeResizer } from "@xyflow/react";
import { type FormEvent, useId, useState } from "react";

import { api, mensagemDeErro } from "../../shared/api/cliente";
import type { DadosDaConfiguracao } from "../../shared/api/tipos";
import { useCanvas } from "../../shared/canvas/contexto";
import { TAMANHO_MINIMO_DO_TERMINAL } from "../../shared/canvas/layout";
import { ALCA_DO_TERMINAL, type NoRascunho as TipoDoNo } from "../../shared/canvas/nos";
import { nomeDaPasta } from "../../shared/pastas";
import { CamposDaConfiguracao } from "../CamposDaConfiguracao";
import { NavegadorDePastas } from "./NavegadorDePastas";

const CONFIGURACAO_PADRAO: DadosDaConfiguracao = {
  modeloDoOrquestrador: "opus",
  esforcoDoOrquestrador: "padrao",
  modeloDosSubagentes: "opus",
  esforcoDosSubagentes: "padrao",
  quantidadeDeSubagentes: { modo: "automatica", limite: 3 },
  nivelDePermissao: "leitura",
  permitirCommitEPush: false,
  permitirTrabalhoDireto: true,
  proporPlanoEmPedidosGrandes: true,
  instrucoesPersonalizadas: "",
};

/**
 * O terminal que abre ao clicar em "Novo orquestrador": pede a pasta, o nome
 * e a configuração e, ao iniciar, vira o terminal do Orquestrador no mesmo
 * lugar do canvas.
 */
export function NoRascunho({ id, selected }: NodeProps<TipoDoNo>) {
  const { acoes, servidor } = useCanvas();
  const idDoCampo = useId();
  const [nome, setNome] = useState("");
  const [pasta, setPasta] = useState("");
  const [configuracao, setConfiguracao] = useState(CONFIGURACAO_PADRAO);
  const [pastaPendente, setPastaPendente] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [criando, setCriando] = useState(false);

  /** Sugere o nome da pasta como nome do orquestrador, sem apagar um nome digitado. */
  function escolherPasta(caminho: string): void {
    const anterior = pasta === "" ? "" : nomeDaPasta(pasta).slice(0, 60);
    if (nome.trim() === "" || nome === anterior) {
      setNome(nomeDaPasta(caminho).slice(0, 60));
    }
    setPasta(caminho);
  }

  async function iniciar(evento: FormEvent): Promise<void> {
    evento.preventDefault();
    if (pastaPendente) {
      return;
    }
    setErro(null);
    setCriando(true);
    try {
      acoes.orquestradorCriado(id, await api.criarOrquestrador({ nome, pastaDeTrabalho: pasta, ...configuracao }));
    } catch (falha) {
      setErro(mensagemDeErro(falha));
      setCriando(false);
    }
  }

  return (
    <>
      <NodeResizer
        isVisible={selected}
        minWidth={TAMANHO_MINIMO_DO_TERMINAL.largura}
        minHeight={TAMANHO_MINIMO_DO_TERMINAL.altura}
        lineClassName="redimensionador-linha"
        handleClassName="redimensionador-alca"
      />
      <form className="janela-terminal janela-terminal-ativa" onSubmit={(evento) => void iniciar(evento)}>
        <div className={`barra-do-terminal ${ALCA_DO_TERMINAL}`}>
          <span className="semaforo" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <strong className="font-titulo text-[12.5px] font-semibold">novo orquestrador</strong>
          <span className="flex-1" />
          <button
            type="button"
            className="botao-icone nodrag"
            title="Descartar"
            onClick={() => acoes.descartarRascunho(id)}
          >
            ✕
          </button>
        </div>

        <div className="corpo-do-terminal custom-scrollbar flex flex-col gap-4 nodrag nowheel">
          <p className="mono text-caption">
            <span className="text-active">$</span> configurar orquestrador
            <span className="cursor" />
          </p>

          <div className="grid gap-4 @container">
            <div className="grid gap-4">
              <div className="field">
                <label className="label" htmlFor={`${idDoCampo}-pasta`}>
                  Pasta de trabalho
                </label>
                <NavegadorDePastas
                  id={`${idDoCampo}-pasta`}
                  valor={pasta}
                  aoEscolher={escolherPasta}
                  aoMudarPendencia={setPastaPendente}
                  conectado={servidor.conectado}
                />
                <span className="hint">
                  Qualquer pasta do computador. Os agentes só trabalham dentro dela.
                </span>
              </div>
              <div className="field">
                <label className="label" htmlFor={`${idDoCampo}-nome`}>
                  Nome
                </label>
                <input
                  id={`${idDoCampo}-nome`}
                  className="input"
                  value={nome}
                  maxLength={60}
                  onChange={(evento) => setNome(evento.target.value)}
                  placeholder="Ex.: Painel de salas"
                  required
                />
              </div>
            </div>
          </div>

          <CamposDaConfiguracao valor={configuracao} aoMudar={setConfiguracao} pastaDeTrabalho={pasta} />

          {erro !== null && <p className="mono texto-longo text-error">✗ {erro}</p>}
        </div>

        <div className="prompt-do-terminal justify-end nodrag">
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => acoes.descartarRascunho(id)}>
            descartar
          </button>
          <button
            type="submit"
            className="btn btn-sm btn-cta"
            disabled={criando || pasta === "" || pastaPendente || nome.trim() === "" || !servidor.conectado}
          >
            {criando ? "iniciando…" : "iniciar orquestrador ⏎"}
          </button>
        </div>
      </form>
    </>
  );
}
