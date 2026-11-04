import { type NodeProps, NodeResizer } from "@xyflow/react";
import { type FormEvent, type ReactNode, useId, useMemo, useState } from "react";

import { api, mensagemDeErro } from "../../shared/api/cliente";
import {
  type DadosDaConfiguracao,
  type ModeloClaude,
  type NivelDePermissao,
  type PastaDeProjeto,
  TAMANHO_MAXIMO_DAS_INSTRUCOES,
} from "../../shared/api/tipos";
import { useCanvas } from "../../shared/canvas/contexto";
import { TAMANHO_MINIMO_DO_TERMINAL } from "../../shared/canvas/layout";
import { ALCA_DO_TERMINAL, type NoRascunho as TipoDoNo } from "../../shared/canvas/nos";
import { ROTULOS_DAS_PERMISSOES, ROTULOS_DOS_MODELOS, rotuloDoEsforcoNaCriacao } from "../../shared/formatacao";
import { tamanhoDasInstrucoes } from "../../shared/instrucoes";
import { nomeDaPasta } from "../../shared/pastas";
import { Dica } from "../Dica";
import { PreviaDoPromptFinal } from "../PreviaDoPromptFinal";
import { ChipDeEsforco, ChipDeQuantidade } from "./ChipsDaCriacao";
import { EscolhaDePasta, TAMANHO_MAXIMO_DO_NOME } from "./EscolhaDePasta";
import { IconeFechar } from "../Icones";

// "Fazer o trivial sozinho" e "propor plano" não aparecem na criação: vão sempre ligados.
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

const PERMISSOES: readonly NivelDePermissao[] = ["leitura", "edicao", "edicao_e_comandos"];
const MODELOS: readonly ModeloClaude[] = ["opus", "sonnet", "haiku"];
const MAXIMO_DE_RECENTES = 5;

type Menu = "esforcoDoOrquestrador" | "esforcoDosSubagentes" | "quantidade";

/**
 * O terminal que abre ao clicar em "Novo orquestrador": tudo o que dá para
 * escolher numa tela só, já num padrão bom, para começar rápido. Ao começar,
 * vira o terminal do Orquestrador no mesmo lugar.
 */
export function NoRascunho({ id, selected }: NodeProps<TipoDoNo>) {
  const { acoes, servidor, orquestradores } = useCanvas();
  const idDaPermissao = useId();
  const idDoModelo = useId();
  const idDasInstrucoes = useId();
  const [pasta, setPasta] = useState("");
  const [nome, setNome] = useState("");
  const [nomeEditado, setNomeEditado] = useState(false);
  const [configuracao, setConfiguracao] = useState(CONFIGURACAO_PADRAO);
  const [menuAberto, setMenuAberto] = useState<Menu | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [criando, setCriando] = useState(false);

  const recentes = useMemo(() => pastasRecentes([...orquestradores.values()]), [orquestradores]);

  function mudar<Campo extends keyof DadosDaConfiguracao>(campo: Campo, novo: DadosDaConfiguracao[Campo]): void {
    setConfiguracao((atual) => ({ ...atual, [campo]: novo }));
  }

  /** Um menu aberto por vez: abrir um fecha o outro. */
  function controleDoMenu(menu: Menu) {
    return {
      aberto: menuAberto === menu,
      aoMudarAberto: (aberto: boolean) =>
        setMenuAberto((atual) => (aberto ? menu : atual === menu ? null : atual)),
    };
  }

  const nomeDaPastaEscolhida = nomeDaPasta(pasta).slice(0, TAMANHO_MAXIMO_DO_NOME);

  /** O nome vem da pasta; um nome editado à mão (e diferente do da pasta) não é trocado. */
  function escolherPasta(caminho: string): void {
    if (!nomeEditado || nome.trim() === "" || nome === nomeDaPastaEscolhida) {
      setNome(nomeDaPasta(caminho).slice(0, TAMANHO_MAXIMO_DO_NOME));
      setNomeEditado(false);
    }
    setPasta(caminho);
    setErro(null);
  }

  const comandos = configuracao.nivelDePermissao === "edicao_e_comandos";
  // Commit e push são comandos git: sem permissão de rodar comandos, a opção não tem efeito.
  const commitSemComandos = configuracao.permitirCommitEPush && !comandos;
  const tamanho = tamanhoDasInstrucoes(configuracao.instrucoesPersonalizadas);
  const passouDoLimite = tamanho > TAMANHO_MAXIMO_DAS_INSTRUCOES;

  const motivoParaNaoComecar =
    pasta === ""
      ? "Escolha uma pasta para começar."
      : nome.trim() === ""
        ? "Dê um nome ao orquestrador para começar."
        : passouDoLimite
          ? "Encurte as instruções para começar."
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
      acoes.orquestradorCriado(
        id,
        await api.criarOrquestrador({
          nome: nome.trim(),
          pastaDeTrabalho: pasta,
          ...configuracao,
          permitirTrabalhoDireto: true,
          proporPlanoEmPedidosGrandes: true,
        }),
      );
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
          <strong className="font-titulo min-w-0 truncate text-[12.5px] font-semibold">
            {nome.trim() === "" ? "novo orquestrador" : `novo orquestrador · ${nome.trim()}`}
          </strong>
          <span className="flex-1" />
          <button
            type="button"
            className="botao-icone nodrag"
            title="Descartar"
            aria-label="Descartar rascunho"
            onClick={() => acoes.descartarRascunho(id)}
          >
            <IconeFechar tamanho={16} />
          </button>
        </div>

        <div className="corpo-do-terminal corpo-da-criacao custom-scrollbar nodrag nowheel">
          <section className="flex flex-col gap-1.5" aria-label="Pasta de trabalho">
            <Rotulo
              titulo="Pasta de trabalho"
              discreto
              dica="Onde ele trabalha."
              explicacao="A pasta do projeto que o orquestrador vai ler e mudar. O nome dele vem da pasta, e dá para editar clicando no título."
            />
            <EscolhaDePasta
              pasta={pasta}
              recentes={recentes}
              aoEscolher={escolherPasta}
              conectado={servidor.conectado}
              nome={nome}
              aoMudarNome={(novo) => {
                setNome(novo.slice(0, TAMANHO_MAXIMO_DO_NOME));
                setNomeEditado(true);
              }}
              nomeEditado={nomeEditado && nome !== nomeDaPastaEscolhida}
              aoUsarNomeDaPasta={() => {
                setNome(nomeDaPastaEscolhida);
                setNomeEditado(false);
              }}
            />
          </section>

          <div className="linha-da-criacao mt-3.5">
            <Rotulo
              id={idDaPermissao}
              titulo="Permissão"
              dica="O que ele pode fazer na pasta."
              explicacao="Vale para o orquestrador e para os subagentes. Comece em Só olhar e libere mais quando precisar: dá para mudar depois, na engrenagem do terminal."
              alinharAoTopo
            />
            <div className="flex min-w-0 flex-col gap-1.5">
              <div className="permissoes-da-criacao" role="radiogroup" aria-labelledby={idDaPermissao}>
                {PERMISSOES.map((nivel) => {
                  const escolhida = configuracao.nivelDePermissao === nivel;
                  return (
                    <label
                      key={nivel}
                      className={`opcao-da-permissao ${escolhida && nivel === "edicao_e_comandos" ? "opcao-da-permissao-risco" : ""}`}
                      title={ROTULOS_DAS_PERMISSOES[nivel].nome}
                    >
                      <input
                        type="radio"
                        name={`${idDaPermissao}-nivel`}
                        value={nivel}
                        checked={escolhida}
                        onChange={() => mudar("nivelDePermissao", nivel)}
                      />
                      <IconeDaPermissao nivel={nivel} />
                      <span className="truncate">{ROTULOS_DAS_PERMISSOES[nivel].nome}</span>
                    </label>
                  );
                })}
              </div>
              <span className={`text-[12px] ${comandos ? "text-warning" : "text-secondary"}`}>
                {comandos
                  ? "Edita, instala, testa e compila. Use só em pastas que você confia."
                  : ROTULOS_DAS_PERMISSOES[configuracao.nivelDePermissao].descricao}
              </span>
            </div>
          </div>

          <div className="linha-da-criacao">
            <Rotulo
              htmlFor={`${idDoModelo}-orquestrador`}
              titulo="Orquestrador"
              dica="Quem conversa com você."
              explicacao="Ele entende o pedido, divide em tarefas e passa para os subagentes. Opus é o mais capaz, Sonnet equilibra e Haiku é rápido e gasta menos cota. O esforço é quanto ele pensa antes de responder; no automático, vale o padrão do Claude Code."
            />
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <SeletorDeModelo
                id={`${idDoModelo}-orquestrador`}
                valor={configuracao.modeloDoOrquestrador}
                aoEscolher={(modelo) => mudar("modeloDoOrquestrador", modelo)}
              />
              <ChipDeEsforco
                dono="do orquestrador"
                valor={configuracao.esforcoDoOrquestrador}
                aoEscolher={(esforco) => mudar("esforcoDoOrquestrador", esforco)}
                {...controleDoMenu("esforcoDoOrquestrador")}
              />
            </div>

            <Rotulo
              htmlFor={`${idDoModelo}-subagentes`}
              titulo="Subagentes"
              dica="Ajudantes que trabalham em paralelo."
              explicacao="O orquestrador lança um para cada tarefa, e eles aparecem como bixinhos ligados ao terminal. No padrão, ele decide quantos usar, até 3 ao mesmo tempo. Os prontos você edita no botão Subagentes, na barra."
            />
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <SeletorDeModelo
                id={`${idDoModelo}-subagentes`}
                valor={configuracao.modeloDosSubagentes}
                aoEscolher={(modelo) => mudar("modeloDosSubagentes", modelo)}
              />
              <ChipDeEsforco
                dono="dos subagentes"
                valor={configuracao.esforcoDosSubagentes}
                aoEscolher={(esforco) => mudar("esforcoDosSubagentes", esforco)}
                {...controleDoMenu("esforcoDosSubagentes")}
              />
              <ChipDeQuantidade
                valor={configuracao.quantidadeDeSubagentes}
                padrao={CONFIGURACAO_PADRAO.quantidadeDeSubagentes}
                aoMudar={(quantidade) => mudar("quantidadeDeSubagentes", quantidade)}
                {...controleDoMenu("quantidade")}
              />
            </div>
          </div>

          <div className="linha-da-criacao">
            <Rotulo
              titulo="Opções"
              dica="Commit e push ficam travados."
              explicacao="Só acontecem quando você pedir na mensagem, e só com a permissão de rodar comandos. Fazer o trivial sozinho e propor um plano antes de mudanças grandes ficam sempre ligados."
            />
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
              <button
                type="button"
                role="switch"
                className="interruptor"
                aria-checked={configuracao.permitirCommitEPush}
                onClick={() => mudar("permitirCommitEPush", !configuracao.permitirCommitEPush)}
              >
                <span className={`interruptor-trilho ${commitSemComandos ? "interruptor-sem-efeito" : ""}`} aria-hidden="true" />
                Commit e push quando eu pedir
              </button>
              {commitSemComandos && (
                <span className="text-[11.5px] text-warning">Só vale com Mudar arquivos e rodar comandos.</span>
              )}
            </div>
          </div>

          <div className="linha-da-criacao">
            <Rotulo
              htmlFor={idDasInstrucoes}
              titulo="Instruções"
              dica="Regras só deste orquestrador."
              explicacao="Entram no prompt dele, por exemplo o jeito de responder ou o que rodar antes de concluir. Vazio, valem as Instruções gerais (botão na barra)."
              alinharAoTopo
            />
            <div className="flex min-w-0 flex-col gap-1.5">
              <textarea
                id={idDasInstrucoes}
                className="textarea instrucoes-da-criacao custom-scrollbar"
                rows={7}
                value={configuracao.instrucoesPersonalizadas}
                placeholder="Opcional. Ex.: Responda em tópicos curtos. Rode os testes antes de concluir."
                aria-invalid={passouDoLimite}
                spellCheck
                onChange={(evento) => mudar("instrucoesPersonalizadas", evento.target.value)}
              />
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <PreviaDoPromptFinal configuracao={configuracao} pastaDeTrabalho={pasta || undefined} comoLink />
                </div>
                <span className={`mono shrink-0 text-[11px] ${passouDoLimite ? "text-error" : "text-muted"}`} aria-live="polite">
                  {tamanho.toLocaleString("pt-BR")} / {TAMANHO_MAXIMO_DAS_INSTRUCOES.toLocaleString("pt-BR")}
                </span>
              </div>
              {passouDoLimite && (
                <span className="text-[11px] text-error" role="alert">
                  Passou do limite de {TAMANHO_MAXIMO_DAS_INSTRUCOES.toLocaleString("pt-BR")} caracteres: encurte o texto
                  para conseguir começar.
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="rodape-da-criacao nodrag">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            {erro !== null ? (
              <p className="mono texto-longo line-clamp-3 text-[11.5px] text-error" role="alert">
                ✗ {erro}
              </p>
            ) : motivoParaNaoComecar !== null ? (
              <span className="flex items-center gap-2 text-[12.5px] text-warning">
                <IconeDeAviso />
                {motivoParaNaoComecar}
              </span>
            ) : (
              <>
                <span className="truncate text-[12.5px] text-primary">{resumo(configuracao)}</span>
                <span className="mono truncate text-[11px] text-muted" title={pasta}>
                  {detalhes(configuracao, pasta)}
                </span>
              </>
            )}
          </div>
          <button type="button" className="btn btn-ghost shrink-0" onClick={() => acoes.descartarRascunho(id)}>
            Descartar
          </button>
          <button
            type="submit"
            className="btn btn-cta botao-de-comecar"
            disabled={criando || motivoParaNaoComecar !== null}
          >
            <span className="truncate">
              {criando ? "Começando…" : motivoParaNaoComecar === null ? `Começar em ${nome.trim()}` : "Começar"}
            </span>
            <span aria-hidden="true">⏎</span>
          </button>
        </div>
      </form>
    </>
  );
}

interface PropsDoRotulo {
  titulo: string;
  dica: string;
  explicacao: string;
  /** Liga o rótulo a um campo (`<label>`); sem ele, é texto com `id` para `aria-labelledby`. */
  htmlFor?: string;
  id?: string;
  /** Linhas altas (permissão, instruções): o rótulo fica na altura do primeiro controle. */
  alinharAoTopo?: boolean;
  /** A pasta fica acima das linhas, na largura toda: o rótulo dela é mais apagado. */
  discreto?: boolean;
}

/** Nome do campo na coluna da esquerda, com a Dica ao lado. */
function Rotulo({ titulo, dica, explicacao, htmlFor, id, alinharAoTopo = false, discreto = false }: PropsDoRotulo) {
  const classe = `rotulo-da-criacao ${discreto ? "rotulo-da-criacao-discreto" : ""}`;
  const texto: ReactNode =
    htmlFor === undefined ? (
      <span id={id} className={classe}>
        {titulo}
      </span>
    ) : (
      <label htmlFor={htmlFor} className={classe}>
        {titulo}
      </label>
    );
  return (
    <div className={`flex items-center gap-1.5 ${alinharAoTopo ? "self-start pt-2" : discreto ? "" : "self-center"}`}>
      {texto}
      <Dica sobre={titulo} titulo={dica}>
        {explicacao}
      </Dica>
    </div>
  );
}

function SeletorDeModelo({ id, valor, aoEscolher }: { id: string; valor: ModeloClaude; aoEscolher: (modelo: ModeloClaude) => void }) {
  return (
    <select
      id={id}
      className="select select-compacto"
      value={valor}
      title={ROTULOS_DOS_MODELOS[valor].descricao}
      onChange={(evento) => {
        const escolhido = MODELOS.find((modelo) => modelo === evento.target.value);
        if (escolhido !== undefined) {
          aoEscolher(escolhido);
        }
      }}
    >
      {MODELOS.map((modelo) => (
        <option key={modelo} value={modelo} title={ROTULOS_DOS_MODELOS[modelo].descricao}>
          {ROTULOS_DOS_MODELOS[modelo].nome}
        </option>
      ))}
    </select>
  );
}

/** Olho, lápis e terminal: do mais seguro ao que roda comandos. */
function IconeDaPermissao({ nivel }: { nivel: NivelDePermissao }) {
  return (
    <svg
      aria-hidden="true"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
    >
      {nivel === "leitura" ? (
        <>
          <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
          <circle cx="12" cy="12" r="3" />
        </>
      ) : nivel === "edicao" ? (
        <>
          <path d="M4 20h4L19 9l-4-4L4 16z" />
          <path d="m13.5 6.5 4 4" />
        </>
      ) : (
        <>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="m7 9 3 3-3 3M13 15h4" />
        </>
      )}
    </svg>
  );
}

function IconeDeAviso() {
  return (
    <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="shrink-0">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v5M12 16.5v.01" />
    </svg>
  );
}

/** Ex.: "Opus (esforço automático)". */
function modeloComEsforco(modelo: ModeloClaude, esforco: DadosDaConfiguracao["esforcoDoOrquestrador"]): string {
  return `${ROTULOS_DOS_MODELOS[modelo].nome} (esforço ${rotuloDoEsforcoNaCriacao(esforco).toLowerCase()})`;
}

/** Ex.: "Só olhar e responder, Opus (esforço automático) com até 3 subagentes Opus." */
function resumo(configuracao: DadosDaConfiguracao): string {
  const { quantidadeDeSubagentes: quantidade } = configuracao;
  const contagem = quantidade.modo === "automatica" ? `até ${quantidade.limite}` : `sempre ${quantidade.limite}`;
  const subagentes = quantidade.limite === 1 ? "subagente" : "subagentes";
  const modeloDosSubagentes =
    configuracao.esforcoDosSubagentes === "padrao"
      ? ROTULOS_DOS_MODELOS[configuracao.modeloDosSubagentes].nome
      : modeloComEsforco(configuracao.modeloDosSubagentes, configuracao.esforcoDosSubagentes);
  return (
    `${ROTULOS_DAS_PERMISSOES[configuracao.nivelDePermissao].nome}, ` +
    `${modeloComEsforco(configuracao.modeloDoOrquestrador, configuracao.esforcoDoOrquestrador)} ` +
    `com ${contagem} ${subagentes} ${modeloDosSubagentes}.`
  );
}

/** Ex.: "/p/meu-app · commit e push · instruções próprias". */
function detalhes(configuracao: DadosDaConfiguracao, pasta: string): string {
  return [
    pasta,
    ...(configuracao.permitirCommitEPush && configuracao.nivelDePermissao === "edicao_e_comandos" ? ["commit e push"] : []),
    configuracao.instrucoesPersonalizadas.trim() === "" ? "instruções gerais" : "instruções próprias",
  ].join(" · ");
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
