import { type NodeProps, NodeResizer } from "@xyflow/react";
import { type FormEvent, useCallback, useEffect, useId, useState } from "react";

import { api, mensagemDeErro } from "../../shared/api/cliente";
import {
  type DadosDaConfiguracao,
  type NivelDePermissao,
  type PastaDeProjeto,
  TAMANHO_MAXIMO_DAS_INSTRUCOES,
} from "../../shared/api/tipos";
import { useCanvas } from "../../shared/canvas/contexto";
import {
  ESCALA_DA_LETRA_PADRAO,
  OPCOES_DA_ESCALA_DA_LETRA,
  TAMANHO_MINIMO_DO_TERMINAL,
} from "../../shared/canvas/layout";
import { ALCA_DO_TERMINAL, type NoRascunho as TipoDoNo } from "../../shared/canvas/nos";
import { AVISO_DO_ULTRACODE, ROTULOS_DAS_PERMISSOES } from "../../shared/formatacao";
import { ajudaDaPredefinicao, useEsforcosHerdados, usePredefinicoes } from "../../shared/hooks/useDadosDaConfiguracao";
import { tamanhoDasInstrucoes } from "../../shared/instrucoes";
import { CONFIGURACAO_PADRAO_DO_ORQUESTRADOR } from "../../shared/modelos";
import { resumoDaConfiguracao } from "../../shared/resumoDaConfiguracao";
import { IconeAlerta, IconeFechar } from "../Icones";
import { PreviaDoPromptFinal } from "../PreviaDoPromptFinal";
import { AvisoDoEsforcoHerdado, IconeDaPermissao, Rotulo } from "./LinhasDaConfiguracao";
import { MenuDeModelo } from "./MenuDeModelo";
import { NavegadorDePastas } from "./NavegadorDePastas";
import { QuantidadeDeSubagentes } from "./QuantidadeDeSubagentes";

const TAMANHO_MAXIMO_DO_NOME = 60;
const PERMISSOES: readonly NivelDePermissao[] = ["leitura", "edicao", "edicao_e_comandos"];

/** Nome exibido para um caminho: a última parte da pasta. */
function nomeDaPasta(caminho: string): string {
  const partes = caminho.split(/[\\/]/).filter((parte) => parte !== "");
  return partes[partes.length - 1] ?? caminho;
}

/**
 * O terminal que abre ao clicar em "Novo orquestrador": tudo o que dá para
 * escolher numa tela só, já num padrão bom, para começar rápido. Ao começar,
 * vira o terminal do Orquestrador no mesmo lugar.
 */
export function NoRascunho({ id, data, selected }: NodeProps<TipoDoNo>) {
  const { acoes, servidor } = useCanvas();
  const idDoCampo = useId();
  const idDaPermissao = useId();
  const idDaLetra = useId();
  // No nó, e não no estado do formulário: o terminal criado herda daqui.
  const escalaDaLetra = data.escalaDaLetra ?? ESCALA_DA_LETRA_PADRAO;
  const [nome, setNome] = useState("");
  const [pasta, setPasta] = useState("");
  const [configuracao, setConfiguracao] = useState<DadosDaConfiguracao>(CONFIGURACAO_PADRAO_DO_ORQUESTRADOR);
  const [opcoes, setOpcoes] = useState<{ raiz: string; pastas: PastaDeProjeto[] } | null>(null);
  // Pasta escolhida pelo navegador do computador, fora da lista de projetos.
  const [pastaExterna, setPastaExterna] = useState<PastaDeProjeto | null>(null);
  const [navegando, setNavegando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [criando, setCriando] = useState(false);
  const predefinicoes = usePredefinicoes();
  const economico = predefinicoes.find((predefinicao) => predefinicao.nome === "economico");

  // Tenta de novo quando o servidor volta: aberto com ele fora, o terminal
  // ficaria preso em "carregando pastas…".
  const carregou = opcoes !== null;
  useEffect(() => {
    if (carregou || !servidor.conectado) {
      return;
    }
    api
      .listarPastas()
      .then((resposta) => {
        setOpcoes(resposta);
        setErro(null);
      })
      .catch((falha: unknown) => setErro(mensagemDeErro(falha)));
  }, [carregou, servidor.conectado]);

  // O aviso de esforço depende dos modelos e da pasta escolhidos: a busca muda junto com eles.
  const { modeloDoOrquestrador, modeloDosSubagentes } = configuracao;
  const buscarEsforcoHerdado = useCallback(
    () => api.lerEsforcoHerdado(modeloDoOrquestrador, modeloDosSubagentes, pasta),
    [modeloDoOrquestrador, modeloDosSubagentes, pasta],
  );
  const herdados = useEsforcosHerdados(buscarEsforcoHerdado);

  function mudar<Campo extends keyof DadosDaConfiguracao>(campo: Campo, novo: DadosDaConfiguracao[Campo]): void {
    setConfiguracao((atual) => ({ ...atual, [campo]: novo }));
  }

  /** O nome de um caminho entre as opções: os projetos da raiz ou a pasta escolhida à mão. */
  function nomeDoCaminho(caminho: string): string {
    if (pastaExterna?.caminho === caminho) {
      return pastaExterna.nome;
    }
    if (opcoes !== null && caminho === opcoes.raiz) {
      return nomeDaPasta(caminho);
    }
    return opcoes?.pastas.find((opcao) => opcao.caminho === caminho)?.nome ?? "";
  }

  /** Sugere o nome da pasta como nome do orquestrador, sem apagar um nome digitado. */
  function sugerirNome(escolhida: string): void {
    const anterior = nomeDoCaminho(pasta).slice(0, TAMANHO_MAXIMO_DO_NOME);
    if (nome.trim() === "" || nome === anterior) {
      setNome(escolhida.slice(0, TAMANHO_MAXIMO_DO_NOME));
    }
  }

  function escolherPasta(caminho: string): void {
    sugerirNome(nomeDoCaminho(caminho));
    setPasta(caminho);
    setErro(null);
  }

  /** Confirma a pasta vinda do navegador do computador e a deixa selecionada. */
  function escolherPastaExterna(caminho: string): void {
    const externa = { nome: nomeDaPasta(caminho), caminho };
    sugerirNome(externa.nome);
    setPastaExterna(externa);
    setPasta(caminho);
    setErro(null);
    setNavegando(false);
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
        await api.criarOrquestrador({ nome: nome.trim(), pastaDeTrabalho: pasta, ...configuracao }),
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

        <div className="conteudo-do-cartao" style={{ zoom: escalaDaLetra }}>
          <div className="corpo-do-terminal corpo-da-criacao custom-scrollbar nodrag nowheel">
            <section className="pasta-da-criacao" aria-label="Pasta e nome">
              <div className="flex min-w-0 flex-col gap-1.5">
                <Rotulo
                  htmlFor={`${idDoCampo}-pasta`}
                  titulo="Pasta de trabalho"
                  discreto
                  dica="Onde ele trabalha."
                  explicacao='A pasta do projeto que o orquestrador vai ler e mudar; os agentes só trabalham dentro dela. Use "procurar…" para uma pasta fora dos projetos.'
                />
                <div className="flex min-w-0 items-stretch gap-2">
                  <select
                    id={`${idDoCampo}-pasta`}
                    className="select campo-escuro min-w-0 flex-1 font-mono text-[12px]"
                    value={pasta}
                    title={pasta || undefined}
                    onChange={(evento) => escolherPasta(evento.target.value)}
                  >
                    <option value="" disabled>
                      {opcoes === null ? "carregando pastas…" : "escolha um projeto"}
                    </option>
                    {opcoes?.pastas.map((opcao) => (
                      <option key={opcao.caminho} value={opcao.caminho}>
                        {opcao.nome}
                      </option>
                    ))}
                    {opcoes !== null && <option value={opcoes.raiz}>todos os projetos (pasta raiz)</option>}
                    {pastaExterna !== null && (
                      <option value={pastaExterna.caminho}>{pastaExterna.nome} (pasta do computador)</option>
                    )}
                  </select>
                  <button
                    type="button"
                    className="btn btn-outline botao-de-procurar shrink-0"
                    title="Escolher uma pasta qualquer do computador"
                    onClick={() => setNavegando(true)}
                  >
                    procurar…
                  </button>
                </div>
              </div>
              <div className="flex min-w-0 flex-col gap-1.5">
                <Rotulo
                  htmlFor={`${idDoCampo}-nome`}
                  titulo="Nome"
                  discreto
                  dica="Como ele aparece no canvas."
                  explicacao="Vem da pasta escolhida; um nome digitado aqui não é trocado ao mudar de pasta."
                />
                <input
                  id={`${idDoCampo}-nome`}
                  className="input campo-escuro"
                  value={nome}
                  maxLength={TAMANHO_MAXIMO_DO_NOME}
                  onChange={(evento) => setNome(evento.target.value)}
                  placeholder="Ex.: Painel de salas"
                  spellCheck={false}
                />
              </div>
            </section>

            <div className="linha-da-criacao mt-3.5">
              <Rotulo
                id={idDaPermissao}
                titulo="Permissão"
                dica="O que ele pode fazer na pasta."
                explicacao={`Vale para o orquestrador e para os subagentes. Comece em ${ROTULOS_DAS_PERMISSOES.leitura.nome} e libere mais quando precisar: dá para mudar depois, na engrenagem do terminal.`}
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
                htmlFor={`${idDoCampo}-orquestrador`}
                titulo="Orquestrador"
                dica="Quem conversa com você."
                explicacao="Ele entende o pedido, divide em tarefas e passa para os subagentes. Fable é para os desafios mais difíceis, Opus é o mais capaz no dia a dia, Sonnet equilibra e Haiku é rápido e gasta menos cota. O esforço é quanto ele pensa antes de responder; no automático, vale o padrão do Claude Code."
                alinharAoTopo
              />
              <div className="flex min-w-0 flex-col gap-1.5">
                <MenuDeModelo
                  id={`${idDoCampo}-orquestrador`}
                  rotulo="Modelo do orquestrador"
                  modelo={configuracao.modeloDoOrquestrador}
                  esforco={configuracao.esforcoDoOrquestrador}
                  comUltracode
                  aoEscolherModelo={(modelo) => mudar("modeloDoOrquestrador", modelo)}
                  aoEscolherEsforco={(esforco) => mudar("esforcoDoOrquestrador", esforco)}
                />
                <AvisoDoEsforcoHerdado esforco={configuracao.esforcoDoOrquestrador} herdado={herdados?.orquestrador ?? null} />
                {configuracao.esforcoDoOrquestrador === "ultracode" && (
                  <span className="hint-warning">{AVISO_DO_ULTRACODE}</span>
                )}
              </div>

              <Rotulo
                htmlFor={`${idDoCampo}-subagentes`}
                titulo="Subagentes"
                dica="Ajudantes que trabalham em paralelo."
                explicacao="O orquestrador lança um para cada tarefa, e eles aparecem como bixinhos ligados ao terminal. No padrão, ele decide quantos usar, até 3 ao mesmo tempo. Cada subagente consome a cota da sua assinatura do Claude."
                alinharAoTopo
              />
              <div className="flex min-w-0 flex-col gap-1.5">
                <MenuDeModelo
                  id={`${idDoCampo}-subagentes`}
                  rotulo="Modelo dos subagentes"
                  modelo={configuracao.modeloDosSubagentes}
                  esforco={configuracao.esforcoDosSubagentes}
                  aoEscolherModelo={(modelo) => mudar("modeloDosSubagentes", modelo)}
                  aoEscolherEsforco={(esforco) => mudar("esforcoDosSubagentes", esforco)}
                />
                <AvisoDoEsforcoHerdado esforco={configuracao.esforcoDosSubagentes} herdado={herdados?.subagentes ?? null} />
              </div>
            </div>

            <div className="linha-da-criacao">
              <Rotulo
                titulo="Quantidade"
                dica="Quantos ao mesmo tempo."
                explicacao="Automática: o orquestrador decide quantos subagentes usar, até o máximo escolhido (no padrão, até 3 ao mesmo tempo). Fixa: ele usa sempre essa quantidade. Cada subagente consome a cota da sua assinatura do Claude."
                alinharAoTopo
              />
              <QuantidadeDeSubagentes
                valor={configuracao.quantidadeDeSubagentes}
                aoMudar={(quantidade) => mudar("quantidadeDeSubagentes", quantidade)}
              />
            </div>

            <div className="linha-da-criacao">
              <Rotulo
                titulo="Opções"
                dica="Commit e push ficam travados."
                explicacao="Só acontecem quando você pedir na mensagem, e só com a permissão de rodar comandos. O Modo econômico troca modelos e esforço por outros que gastam menos cota; os campos continuam editáveis."
                alinharAoTopo
              />
              <div className="flex min-w-0 flex-col gap-1">
                <div className="flex min-w-0 items-center gap-3">
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
                  {economico !== undefined && (
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost ml-auto shrink-0"
                      title={ajudaDaPredefinicao(economico)}
                      onClick={() => setConfiguracao((atual) => ({ ...atual, ...economico.configuracao }))}
                    >
                      Modo econômico
                    </button>
                  )}
                </div>
                {/* O aviso fica embaixo: o Modo econômico não muda de lugar quando ele aparece. */}
                {commitSemComandos && (
                  <span className="text-[11.5px] text-warning">
                    Só vale com {ROTULOS_DAS_PERMISSOES.edicao_e_comandos.nome}.
                  </span>
                )}
              </div>
            </div>

            <div className="linha-da-criacao">
              <Rotulo
                id={idDaLetra}
                titulo="Tamanho da letra"
                dica="Só deste orquestrador, no canvas."
                explicacao="Aumenta a letra do cartão inteiro, na configuração e na conversa, e o cartão cresce junto. Fica guardado neste navegador; dá para mudar depois, na engrenagem do terminal."
              />
              <div className="permissoes-da-criacao w-fit" role="radiogroup" aria-labelledby={idDaLetra}>
                {OPCOES_DA_ESCALA_DA_LETRA.map((opcao) => (
                  <label key={opcao.valor} className="opcao-da-permissao">
                    <input
                      type="radio"
                      name={`${idDaLetra}-escala`}
                      value={opcao.valor}
                      checked={escalaDaLetra === opcao.valor}
                      onChange={() => acoes.mudarEscalaDaLetra(id, opcao.valor)}
                    />
                    {opcao.titulo}
                  </label>
                ))}
              </div>
            </div>

            <div className="linha-da-criacao">
              <Rotulo
                htmlFor={`${idDoCampo}-instrucoes`}
                titulo="Instruções"
                dica="Regras só deste orquestrador."
                explicacao="Entram no prompt dele, por exemplo o jeito de responder ou o que rodar antes de concluir. Vazio, valem as Instruções gerais (botão na barra). Não ampliam a permissão acima."
                alinharAoTopo
              />
              <div className="flex min-w-0 flex-col gap-1.5">
                <textarea
                  id={`${idDoCampo}-instrucoes`}
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
                  <IconeAlerta tamanho={15} className="shrink-0" />
                  {motivoParaNaoComecar}
                </span>
              ) : (
                <>
                  <span className="truncate text-[12.5px] text-primary">{resumoDaConfiguracao(configuracao)}</span>
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
        </div>
      </form>

      {navegando && (
        <NavegadorDePastas
          caminhoInicial={pastaExterna?.caminho ?? opcoes?.raiz}
          aoEscolher={escolherPastaExterna}
          aoFechar={() => setNavegando(false)}
        />
      )}
    </>
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
