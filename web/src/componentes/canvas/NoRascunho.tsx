import { type NodeProps, NodeResizer } from "@xyflow/react";
import { type FormEvent, useId, useMemo, useState } from "react";

import { api, mensagemDeErro } from "../../shared/api/cliente";
import type { DadosDaConfiguracao, NivelDePermissao, PastaDeProjeto } from "../../shared/api/tipos";
import { useCanvas } from "../../shared/canvas/contexto";
import { TAMANHO_MINIMO_DO_TERMINAL } from "../../shared/canvas/layout";
import { ALCA_DO_TERMINAL, type NoRascunho as TipoDoNo } from "../../shared/canvas/nos";
import { descreverAjustes, ROTULOS_DAS_PERMISSOES } from "../../shared/formatacao";
import { nomeDaPasta } from "../../shared/pastas";
import { CamposDaConfiguracao } from "../CamposDaConfiguracao";
import { EscolhaDePasta } from "./EscolhaDePasta";

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

/** A permissão dita pelo resultado, na língua de quem vai usar. */
const PERMISSOES: readonly NivelDePermissao[] = ["leitura", "edicao", "edicao_e_comandos"];

const MAXIMO_DE_RECENTES = 5;
const TAMANHO_MAXIMO_DO_NOME = 60;

/**
 * O terminal que abre ao clicar em "Novo orquestrador". Segue a linha de
 * raciocínio de quem cria: 1. em qual pasta, 2. o que o Claude pode fazer
 * nela, e começar. O resto já vem num padrão bom e fica recolhido em
 * "ajustar". Ao começar, vira o terminal do Orquestrador no mesmo lugar.
 */
export function NoRascunho({ id, selected }: NodeProps<TipoDoNo>) {
  const { acoes, servidor, orquestradores } = useCanvas();
  const idDaPergunta = useId();
  const [pasta, setPasta] = useState("");
  const [nome, setNome] = useState("");
  const [configuracao, setConfiguracao] = useState(CONFIGURACAO_PADRAO);
  const [ajustesAbertos, setAjustesAbertos] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [criando, setCriando] = useState(false);

  const recentes = useMemo(() => pastasRecentes([...orquestradores.values()]), [orquestradores]);

  /** O nome vem da pasta; um nome editado à mão não é trocado. */
  function escolherPasta(caminho: string): void {
    const sugeridoAntes = pasta === "" ? "" : nomeDaPasta(pasta).slice(0, TAMANHO_MAXIMO_DO_NOME);
    if (nome.trim() === "" || nome === sugeridoAntes) {
      setNome(nomeDaPasta(caminho).slice(0, TAMANHO_MAXIMO_DO_NOME));
    }
    setPasta(caminho);
    setErro(null);
  }

  const motivoParaNaoComecar =
    pasta === ""
      ? "Escolha uma pasta primeiro."
      : nome.trim() === ""
        ? "Dê um nome ao orquestrador."
        : !servidor.conectado
          ? "Servidor desconectado."
          : null;

  async function comecar(evento: FormEvent): Promise<void> {
    evento.preventDefault();
    if (motivoParaNaoComecar !== null || criando) {
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
      <form className="janela-terminal janela-terminal-ativa" onSubmit={(evento) => void comecar(evento)}>
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

        <div className="corpo-do-terminal custom-scrollbar flex flex-col gap-5 nodrag nowheel">
          <section className="passo-da-criacao" aria-labelledby={`${idDaPergunta}-1`}>
            <h2 id={`${idDaPergunta}-1`} className="pergunta-da-criacao">
              <span className="numero-do-passo">1</span> Em qual pasta o Claude vai trabalhar?
            </h2>
            {pasta === "" ? (
              <EscolhaDePasta recentes={recentes} aoEscolher={escolherPasta} conectado={servidor.conectado} />
            ) : (
              <div className="cartao-da-pasta" aria-live="polite">
                <span className="text-[18px]" aria-hidden="true">
                  📁
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <label className="flex items-center gap-1.5" title="Nome do orquestrador (clique para editar)">
                    <input
                      className="nome-editavel"
                      aria-label="Nome do orquestrador"
                      value={nome}
                      maxLength={TAMANHO_MAXIMO_DO_NOME}
                      placeholder="nome do orquestrador"
                      onChange={(evento) => setNome(evento.target.value)}
                    />
                    <span className="text-muted" aria-hidden="true">
                      ✎
                    </span>
                  </label>
                  <span className="mono truncate text-[11px] text-muted" title={pasta}>
                    {pasta}
                  </span>
                </div>
                <button type="button" className="btn btn-sm btn-ghost shrink-0" onClick={() => setPasta("")}>
                  trocar
                </button>
              </div>
            )}
          </section>

          {pasta !== "" && (
            <section className="passo-da-criacao" aria-labelledby={`${idDaPergunta}-2`}>
              <h2 id={`${idDaPergunta}-2`} className="pergunta-da-criacao">
                <span className="numero-do-passo">2</span> O que o Claude pode fazer nesta pasta?
              </h2>
              <div className="flex flex-col gap-1.5" role="radiogroup" aria-labelledby={`${idDaPergunta}-2`}>
                {PERMISSOES.map((nivel) => (
                  <label
                    key={nivel}
                    className={`opcao-de-permissao ${configuracao.nivelDePermissao === nivel ? "opcao-de-permissao-escolhida" : ""}`}
                  >
                    <input
                      type="radio"
                      name={`${idDaPergunta}-permissao`}
                      value={nivel}
                      checked={configuracao.nivelDePermissao === nivel}
                      onChange={() => setConfiguracao({ ...configuracao, nivelDePermissao: nivel })}
                    />
                    <span className="flex flex-col">
                      <span className="font-titulo text-[13px] font-medium">{ROTULOS_DAS_PERMISSOES[nivel].nome}</span>
                      <span className="text-[11.5px] text-muted">{descricaoNaCriacao(nivel)}</span>
                    </span>
                  </label>
                ))}
              </div>

              <div className="flex flex-col gap-3">
                <button
                  type="button"
                  className="linha-de-ajustes"
                  aria-expanded={ajustesAbertos}
                  onClick={() => setAjustesAbertos((abertos) => !abertos)}
                >
                  <span className="mono truncate text-[11.5px] text-muted">{descreverAjustes(configuracao)}</span>
                  <span className="shrink-0 text-[12px]">{ajustesAbertos ? "fechar ajustes ▴" : "ajustar ▾"}</span>
                </button>
                {ajustesAbertos && (
                  <CamposDaConfiguracao
                    valor={configuracao}
                    aoMudar={setConfiguracao}
                    pastaDeTrabalho={pasta}
                    semPermissoes
                  />
                )}
              </div>
            </section>
          )}

          {erro !== null && <p className="mono texto-longo text-error">✗ {erro}</p>}
        </div>

        <div className="prompt-do-terminal justify-end gap-3 nodrag">
          {motivoParaNaoComecar !== null && <span className="hint mr-auto">{motivoParaNaoComecar}</span>}
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => acoes.descartarRascunho(id)}>
            descartar
          </button>
          <button
            type="submit"
            className="btn btn-sm btn-cta"
            disabled={criando || motivoParaNaoComecar !== null}
          >
            {criando ? "começando…" : pasta === "" ? "começar ⏎" : `começar em ${nome.trim() || nomeDaPasta(pasta)} ⏎`}
          </button>
        </div>
      </form>
    </>
  );
}

/** As pastas dos orquestradores existentes, sem repetir, a mais recente primeiro. */
function pastasRecentes(
  orquestradores: readonly { pastaDeTrabalho: string; nomeDaPasta: string; criadoEm: string }[],
): PastaDeProjeto[] {
  const vistas = new Set<string>();
  return [...orquestradores]
    .sort((a, b) => b.criadoEm.localeCompare(a.criadoEm))
    .filter((orquestrador) => {
      if (vistas.has(orquestrador.pastaDeTrabalho)) {
        return false;
      }
      vistas.add(orquestrador.pastaDeTrabalho);
      return true;
    })
    .slice(0, MAXIMO_DE_RECENTES)
    .map((orquestrador) => ({ nome: orquestrador.nomeDaPasta, caminho: orquestrador.pastaDeTrabalho }));
}

/** Na criação, a nota sobre commit e push fica nos ajustes, onde está a opção. */
function descricaoNaCriacao(nivel: NivelDePermissao): string {
  return nivel === "edicao_e_comandos" ? "Também instala, testa e compila." : ROTULOS_DAS_PERMISSOES[nivel].descricao;
}
