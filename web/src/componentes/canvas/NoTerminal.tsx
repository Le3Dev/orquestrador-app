import { Handle, type NodeProps, NodeResizer, Position, useNodesData } from "@xyflow/react";
import {
  Fragment,
  type KeyboardEvent as EventoDeTecladoDoReact,
  memo,
  type MouseEvent as EventoDeMouseDoReact,
  type ReactNode,
  type RefObject,
  type SyntheticEvent,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { api, mensagemDeErro } from "../../shared/api/cliente";
import {
  type DadosDaConfiguracao,
  type DadosDoPedidoNaFila,
  type ModoDoTurno,
  type NomeDaPredefinicao,
  type ResumoDoOrquestrador,
  type SituacaoDoSubagente,
  TAMANHO_MAXIMO_DAS_INSTRUCOES,
} from "../../shared/api/tipos";
import { type ChipDaBarra, chipsParaOMenu } from "../../shared/canvas/barraDoTerminal";
import { useCanvas } from "../../shared/canvas/contexto";
import {
  DURACAO_DA_ENTREGA_MS,
  DURACAO_DO_PISCAR_MS,
  entregaRecente,
  houveEntrega,
  prefereMovimentoReduzido,
} from "../../shared/canvas/entrega";
import { ESCALA_DA_LETRA_PADRAO, type EscalaDaLetra, TAMANHO_MINIMO_DO_TERMINAL } from "../../shared/canvas/layout";
import { useArtefato } from "../../shared/canvas/artefatos";
import {
  ALCA_DO_TERMINAL,
  type Ancora,
  CHEGADA_DA_LIGACAO,
  type NoPrevia,
  type NoTerminal as TipoDoNo,
} from "../../shared/canvas/nos";
import { useNota } from "../../shared/canvas/notas";
import { lerPedidoArrastado, temPedidoArrastado } from "../../shared/canvas/pedidoArrastado";
import { registrarPromptDoTerminal } from "../../shared/canvas/promptsDosTerminais";
import { useAcoesDosShellsSeHouver } from "../../shared/canvas/shells";
import { abrirPreviaSozinha, enderecoCurto } from "../../shared/enderecosLocais";
import {
  ESTADO_INICIAL,
  filaDePedidos,
  type SubagenteNaTela,
  type TurnoNaTela,
} from "../../shared/estado/aplicarEvento";
import { mesmoConteudo, useReaproveitado } from "../../shared/hooks/useReaproveitado";
import {
  type ImagemAnexada,
  imagensParaEnvio,
  lerImagem,
  liberarImagens,
  problemaDaImagem,
} from "../../shared/imagens";
import { tamanhoDasInstrucoes } from "../../shared/instrucoes";
import { resumoDaConfiguracao } from "../../shared/resumoDaConfiguracao";
import { CamposDaConfiguracao } from "../CamposDaConfiguracao";
import { EtiquetaDeWorktree } from "../EtiquetaDeWorktree";
import {
  IconeAlerta,
  IconeEngrenagem,
  IconeFechar,
  IconeNavegador,
  IconeOrquestrador,
  IconePasta,
  IconeShell,
} from "../Icones";
import { BotaoDeAlteracoes } from "./BotaoDeAlteracoes";
import { BotaoDeArquivos } from "./BotaoDeArquivos";
import { BotaoDeLimparBixinhos } from "./BotaoDeLimparBixinhos";
import type { AcoesDoPlano } from "./CartaoDoPlano";
import { ControlesDoNo } from "./ControlesDoNo";
import { FaixaDeServidores } from "./FaixaDeServidores";
import { Rotulo } from "./LinhasDaConfiguracao";
import { type ControleDoPrompt, PromptDoTerminal } from "./PromptDoTerminal";
import { TranscricaoDoTerminal } from "./TranscricaoDoTerminal";

/** Distância do fim (px) em que o terminal ainda acompanha as novidades sozinho. */
const MARGEM_DE_ACOMPANHAMENTO = 120;

/**
 * Anúncios de servidor que já abriram a prévia sozinhos, por orquestrador e
 * sequência do evento: guardados na sessão para que recarregar a tela não
 * reabra uma prévia que o usuário fechou.
 */
const CHAVE_DAS_PREVIAS_ABERTAS = "previas-abertas-sozinhas";
const previasAbertasSozinhas = new Set<string>(lerPreviasAbertas());

function lerPreviasAbertas(): string[] {
  try {
    const salvo: unknown = JSON.parse(sessionStorage.getItem(CHAVE_DAS_PREVIAS_ABERTAS) ?? "[]");
    return Array.isArray(salvo) ? salvo.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function jaAbertoSozinho(orquestradorId: string, sequencia: number): boolean {
  return previasAbertasSozinhas.has(`${orquestradorId}:${sequencia}`);
}

function marcarAbertoSozinho(orquestradorId: string, sequencia: number): void {
  previasAbertasSozinhas.add(`${orquestradorId}:${sequencia}`);
  try {
    sessionStorage.setItem(CHAVE_DAS_PREVIAS_ABERTAS, JSON.stringify([...previasAbertasSozinhas].slice(-200)));
  } catch {
    // Sem armazenamento da sessão: vale só enquanto a página estiver aberta.
  }
}

/**
 * Quanto a fila espera o servidor mandar o próximo pedido, depois de um turno
 * que terminou bem, antes de se dizer pausada.
 */
const ESPERA_DO_PROXIMO_DA_FILA_MS = 5_000;

const SEM_FILA: readonly DadosDoPedidoNaFila[] = [];
const SEM_ITENS_LIGADOS: readonly string[] = [];
const SEM_SUBAGENTES: readonly SubagenteNaTela[] = [];

/** A fila anterior enquanto o conteúdo não muda: o prompt (memorizado) não re-renderiza à toa. */
function reaproveitarFila(
  anterior: readonly DadosDoPedidoNaFila[],
  nova: readonly DadosDoPedidoNaFila[],
): readonly DadosDoPedidoNaFila[] {
  return mesmoConteudo(anterior, nova) ? anterior : nova;
}

/** Como o servidor confere (`TAMANHO_MAXIMO_DO_NOME`). */
const TAMANHO_MAXIMO_DO_NOME = 60;

/** Campo do nome na barra, aberto no clique duplo (como o título do artefato). Enter confirma; Esc desiste. */
function CampoDoNome({ nome, aoConcluir }: { nome: string; aoConcluir: (novo: string | null) => void }) {
  const campo = useRef<HTMLInputElement>(null);
  const desistiu = useRef(false);

  useEffect(() => {
    // Sem rolar: o foco num elemento do canvas faria o navegador deslocá-lo.
    campo.current?.focus({ preventScroll: true });
    campo.current?.select();
  }, []);

  return (
    <input
      ref={campo}
      className="campo-do-titulo-do-artefato nodrag"
      aria-label="Nome do orquestrador"
      defaultValue={nome}
      maxLength={TAMANHO_MAXIMO_DO_NOME}
      onKeyDown={(evento) => {
        if (evento.key === "Enter") {
          evento.currentTarget.blur();
        } else if (evento.key === "Escape") {
          desistiu.current = true;
          evento.currentTarget.blur();
        }
      }}
      onBlur={(evento) => aoConcluir(desistiu.current ? null : evento.currentTarget.value)}
    />
  );
}

/** O que está sendo arrastado sobre o terminal, para o aviso de soltar. */
type Arraste = "imagens" | "pedido";

/**
 * Se a borda do terminal está piscando: o envelope do relatório de um
 * Subagente do pedido atual chegou. Quando um deles passa de executando a
 * concluído (`houveEntrega`), a borda pisca depois de `DURACAO_DA_ENTREGA_MS`
 * (o tempo do envelope pela linha), por `DURACAO_DO_PISCAR_MS`.
 *
 * Não pisca ao abrir ou recarregar com Subagentes já concluídos (a primeira
 * leitura só registra as situações, e o histórico reenviado chega com a hora
 * antiga), com o servidor desconectado nem com o reduzir movimento do sistema.
 * Só roda quando os Subagentes deste terminal mudam: eventos de outros
 * Orquestradores não o acordam.
 */
function usePiscarNaEntrega(subagentes: readonly SubagenteNaTela[], conectado: boolean): boolean {
  const [piscando, setPiscando] = useState(false);
  const situacoes = useRef<ReadonlyMap<string, SituacaoDoSubagente> | null>(null);
  const relogios = useRef(new Set<ReturnType<typeof setTimeout>>());
  const conectadoAgora = useRef(conectado);

  useEffect(() => {
    conectadoAgora.current = conectado;
  }, [conectado]);

  useEffect(() => {
    const anteriores = situacoes.current;
    situacoes.current = new Map(subagentes.map((subagente) => [subagente.id, subagente.situacao]));
    if (anteriores === null || !conectadoAgora.current || prefereMovimentoReduzido()) {
      return;
    }
    const agora = Date.now();
    const entregou = subagentes.some(
      (subagente) =>
        houveEntrega(anteriores.get(subagente.id), subagente.situacao) && entregaRecente(subagente.encerradoEm, agora),
    );
    if (!entregou) {
      return;
    }
    const agendar = (acao: () => void, esperaMs: number): void => {
      const relogio = setTimeout(() => {
        relogios.current.delete(relogio);
        acao();
      }, esperaMs);
      relogios.current.add(relogio);
    };
    agendar(() => {
      // O servidor caiu enquanto o envelope andava: nada no canvas está ao vivo.
      if (!conectadoAgora.current) {
        return;
      }
      setPiscando(true);
      agendar(() => setPiscando(false), DURACAO_DO_PISCAR_MS);
    }, DURACAO_DA_ENTREGA_MS);
  }, [subagentes]);

  useEffect(() => {
    const pendentes = relogios.current;
    return () => {
      for (const relogio of pendentes) {
        clearTimeout(relogio);
      }
      pendentes.clear();
    };
  }, []);

  return piscando;
}

/**
 * Se o próximo pedido da fila está a caminho: há pedidos à espera e o último
 * turno terminou concluído, sem plano pendente, há menos de
 * `ESPERA_DO_PROXIMO_DA_FILA_MS`. Nesse intervalo o servidor ainda fecha o
 * turno e manda o próximo; sem isto, a fila apareceria "pausada", com o
 * *enviar agora*, por um instante. Passado o prazo sem turno novo, a fila
 * volta a ser dada como pausada. Com a hora antiga (abrir o terminal,
 * recarregar a página), já começa pausada.
 *
 * De layout: decide antes de o navegador pintar a fila como pausada.
 */
function useProximoDaFilaACaminho(ultimoTurno: TurnoNaTela | undefined, temFila: boolean): boolean {
  const terminouBem = ultimoTurno?.situacao === "concluido" && ultimoTurno.decisaoDoPlano !== "pendente";
  const encerradoEm = terminouBem && temFila ? ultimoTurno.encerradoEm : null;
  // O fim de turno (`encerradoEm`) cujo próximo pedido está a caminho; nulo fora do prazo.
  const [aCaminhoApos, setACaminhoApos] = useState<string | null>(null);

  useLayoutEffect(() => {
    const restante = encerradoEm === null ? 0 : Date.parse(encerradoEm) + ESPERA_DO_PROXIMO_DA_FILA_MS - Date.now();
    if (restante <= 0) {
      setACaminhoApos(null);
      return undefined;
    }
    setACaminhoApos(encerradoEm);
    const prazo = setTimeout(() => setACaminhoApos(null), restante);
    return () => clearTimeout(prazo);
  }, [encerradoEm]);

  return encerradoEm !== null && aCaminhoApos === encerradoEm;
}

/**
 * Só os campos que o formulário mudou em relação a `antes`. A quantidade de
 * subagentes é um objeto e a escolha dos subagentes prontos pode ser uma
 * lista: compara o conteúdo, não a referência.
 */
function camposAlterados(antes: DadosDaConfiguracao, depois: DadosDaConfiguracao): Partial<DadosDaConfiguracao> {
  const alterados: Partial<DadosDaConfiguracao> = {};
  for (const campo of Object.keys(depois) as (keyof DadosDaConfiguracao)[]) {
    const igual =
      campo === "quantidadeDeSubagentes"
        ? antes.quantidadeDeSubagentes.modo === depois.quantidadeDeSubagentes.modo &&
          antes.quantidadeDeSubagentes.limite === depois.quantidadeDeSubagentes.limite
        : campo === "subagentesProntos"
          ? JSON.stringify(antes.subagentesProntos ?? "todos") === JSON.stringify(depois.subagentesProntos ?? "todos")
          : antes[campo] === depois[campo];
    if (!igual) {
      Object.assign(alterados, { [campo]: depois[campo] });
    }
  }
  return alterados;
}

function palavras(texto: string): string[] {
  return texto
    .toLowerCase()
    .split(/\s+/)
    .filter((palavra) => palavra !== "");
}

/**
 * Se as instruções foram apagadas ou mudaram mais da metade: menos da metade
 * das palavras de `antes` continua em `depois` (contando as repetidas).
 * Acrescentar texto ou corrigir uma palavra não conta; instruções que não
 * existiam também não, porque nada antigo fica pesando no histórico.
 */
function instrucoesMudaramMuito(antes: string, depois: string): boolean {
  const deAntes = palavras(antes);
  if (deAntes.length === 0) {
    return false;
  }
  const restantes = new Map<string, number>();
  for (const palavra of palavras(depois)) {
    restantes.set(palavra, (restantes.get(palavra) ?? 0) + 1);
  }
  let mantidas = 0;
  for (const palavra of deAntes) {
    const quantas = restantes.get(palavra) ?? 0;
    if (quantas > 0) {
      mantidas += 1;
      restantes.set(palavra, quantas - 1);
    }
  }
  return mantidas * 2 < deAntes.length;
}

interface PropsDaConfiguracao {
  orquestrador: ResumoDoOrquestrador;
  trabalhando: boolean;
  /**
   * Se a conversa atual já tem pedidos: com as instruções apagadas ou muito
   * mudadas, o rodapé sugere salvar e começar uma conversa nova, porque as
   * antigas continuam no histórico.
   */
  conversaComTurnos?: boolean;
  aoFechar: () => void;
  /** Começa uma conversa nova (o mesmo que "/clear"); lança o erro do servidor, se houver. */
  aoLimparConversa: () => Promise<void>;
  /** O tamanho da letra deste terminal no canvas: muda na hora, sem o Salvar (não é dado do servidor). */
  tamanhoDaLetra?: { valor: EscalaDaLetra; aoMudar: (escala: EscalaDaLetra) => void };
  /** O nome como a barra mostra agora (o do evento chega antes do resumo); sem ele, o do resumo. */
  nome?: string;
}

export function PainelDeConfiguracao({
  orquestrador,
  trabalhando,
  conversaComTurnos = false,
  aoFechar,
  aoLimparConversa,
  tamanhoDaLetra,
  nome: nomeAtual = orquestrador.nome,
}: PropsDaConfiguracao) {
  const { acoes } = useCanvas();
  const idDoNome = useId();
  const [configuracao, setConfiguracao] = useState(orquestrador.configuracao);
  // A configuração com que o formulário abriu (ou a devolvida pela predefinição):
  // o Salvar manda só o que mudou desde ela, para não desfazer o que outra aba salvou.
  const [configuracaoDeOrigem, setConfiguracaoDeOrigem] = useState(orquestrador.configuracao);
  // O nome tem rota própria: vai só se mudou desde que o painel abriu (ou desde o último renomear).
  const [nome, setNome] = useState(nomeAtual);
  const [nomeDeOrigem, setNomeDeOrigem] = useState(nomeAtual);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const { id: orquestradorId, pastaDeTrabalho } = orquestrador;
  const nomeAparado = nome.trim();
  const nomeVazio = nomeAparado === "";
  const { recarregar } = acoes;
  const salvos = orquestrador.configuracao;

  // O aviso de esforço segue os modelos do formulário: com os salvos, o servidor
  // resolve pelo Orquestrador; com outros ainda não salvos, pela pasta de trabalho.
  const { modeloDoOrquestrador, modeloDosSubagentes } = configuracao;
  const modelosSalvos =
    modeloDoOrquestrador === salvos.modeloDoOrquestrador && modeloDosSubagentes === salvos.modeloDosSubagentes;
  const buscarEsforcoHerdado = useCallback(
    () =>
      modelosSalvos
        ? api.lerEsforcoHerdadoDoOrquestrador(orquestradorId)
        : api.lerEsforcoHerdado(modeloDoOrquestrador, modeloDosSubagentes, pastaDeTrabalho),
    [modelosSalvos, orquestradorId, modeloDoOrquestrador, modeloDosSubagentes, pastaDeTrabalho],
  );

  /** O modo econômico vale na hora (no servidor); o formulário passa a mostrar a configuração devolvida. */
  const aplicarPredefinicao = useCallback(
    async (predefinicao: NomeDaPredefinicao): Promise<DadosDaConfiguracao> => {
      const resumo = await api.aplicarPredefinicao(orquestradorId, predefinicao);
      setConfiguracaoDeOrigem(resumo.configuracao);
      void recarregar();
      return resumo.configuracao;
    },
    [orquestradorId, recarregar],
  );

  /** Se há o que mandar ao servidor: o nome mudou ou algum campo da configuração. */
  function temAlteracoes(): boolean {
    return nomeAparado !== nomeDeOrigem || Object.keys(camposAlterados(configuracaoDeOrigem, configuracao)).length > 0;
  }

  /**
   * Manda o que mudou: o nome primeiro, pela rota dele (um nome recusado não
   * deixa a configuração salva pela metade), e depois só os campos alterados
   * da configuração. Lança o erro do servidor; o do nome vem com o contexto.
   */
  async function salvarAlteracoes(): Promise<void> {
    if (nomeAparado !== nomeDeOrigem) {
      try {
        await api.renomearOrquestrador(orquestradorId, nomeAparado);
      } catch (falha) {
        throw new Error(`Não foi possível renomear: ${mensagemDeErro(falha)}`, { cause: falha });
      }
      setNomeDeOrigem(nomeAparado);
    }
    const alteracoes = camposAlterados(configuracaoDeOrigem, configuracao);
    if (Object.keys(alteracoes).length > 0) {
      await api.alterarConfiguracao(orquestradorId, alteracoes);
    }
  }

  /** Manda só o que mudou; sem nada, não chama o servidor e só fecha. Nome em branco não salva. */
  async function salvar(): Promise<void> {
    if (nomeVazio) {
      return;
    }
    if (!temAlteracoes()) {
      aoFechar();
      return;
    }
    setErro(null);
    setSalvando(true);
    try {
      await salvarAlteracoes();
      await acoes.recarregar();
      aoFechar();
    } catch (falha) {
      setErro(mensagemDeErro(falha));
    } finally {
      setSalvando(false);
    }
  }

  async function excluir(): Promise<void> {
    if (!window.confirm(`Excluir "${orquestrador.nome}" e todo o histórico desta conversa?`)) {
      return;
    }
    try {
      await api.removerOrquestrador(orquestrador.id);
      acoes.fecharTerminal(orquestrador.id);
      await acoes.recarregar();
    } catch (falha) {
      setErro(mensagemDeErro(falha));
    }
  }

  async function novaConversa(): Promise<void> {
    if (!window.confirm("Começar uma conversa nova? A conversa atual será arquivada.")) {
      return;
    }
    setErro(null);
    try {
      await aoLimparConversa();
      aoFechar();
    } catch (falha) {
      setErro(mensagemDeErro(falha));
    }
  }

  /**
   * O aviso das instruções muito mudadas: salva o que mudou e segue o fluxo da
   * Nova conversa (confirmação antes de tudo; recusada, nada é salvo).
   */
  async function salvarEComecarConversaNova(): Promise<void> {
    if (nomeVazio || !window.confirm("Salvar e começar uma conversa nova? A conversa atual será arquivada.")) {
      return;
    }
    setErro(null);
    setSalvando(true);
    try {
      await salvarAlteracoes();
      await aoLimparConversa();
      aoFechar();
    } catch (falha) {
      setErro(mensagemDeErro(falha));
    } finally {
      setSalvando(false);
    }
  }

  const passouDoLimite = tamanhoDasInstrucoes(configuracao.instrucoesPersonalizadas) > TAMANHO_MAXIMO_DAS_INSTRUCOES;
  const sugerirConversaNova =
    conversaComTurnos &&
    instrucoesMudaramMuito(configuracaoDeOrigem.instrucoesPersonalizadas, configuracao.instrucoesPersonalizadas);

  // As mesmas linhas e o mesmo rodapé do cartão de criação (NoRascunho).
  return (
    <div className="painel-da-configuracao nodrag">
      <div className="corpo-do-terminal corpo-da-criacao corpo-da-configuracao custom-scrollbar nodrag nowheel">
        <span className="rotulo-tecnico">configuração · vale a partir do próximo pedido</span>
        <div className="linhas-da-configuracao mt-2.5">
          <div className="linha-da-criacao">
            <Rotulo
              htmlFor={idDoNome}
              titulo="Nome"
              dica="Como ele aparece no canvas."
              explicacao={`Até ${TAMANHO_MAXIMO_DO_NOME} caracteres. Muda na barra, na doca e nos avisos; a conversa e a pasta continuam as mesmas. Também dá para renomear com clique duplo no nome da barra.`}
            />
            <input
              id={idDoNome}
              className="input campo-escuro"
              value={nome}
              maxLength={TAMANHO_MAXIMO_DO_NOME}
              onChange={(evento) => setNome(evento.target.value)}
              placeholder="Ex.: Painel de salas"
              spellCheck={false}
            />
          </div>
          <CamposDaConfiguracao
            valor={configuracao}
            aoMudar={setConfiguracao}
            buscarEsforcoHerdado={buscarEsforcoHerdado}
            aplicarPredefinicao={aplicarPredefinicao}
            pastaDeTrabalho={pastaDeTrabalho}
            nome={nomeVazio ? nomeDeOrigem : nomeAparado}
            tamanhoDaLetra={tamanhoDaLetra}
          />
          <div className="linha-da-criacao">
            <Rotulo
              titulo="Conversa"
              dica="Começar de novo ou excluir."
              explicacao="Nova conversa arquiva a conversa atual e começa outra do zero (o mesmo que /clear no prompt). Excluir apaga o orquestrador e todo o histórico. Os dois pedem confirmação e esperam o pedido em andamento acabar."
            />
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <button
                type="button"
                className="btn btn-sm btn-outline"
                onClick={() => void novaConversa()}
                disabled={trabalhando}
                title={
                  trabalhando
                    ? "Cancele o pedido em andamento antes de começar uma conversa nova."
                    : "Arquiva a conversa atual e começa outra do zero (o mesmo que /clear no prompt)."
                }
              >
                Nova conversa
              </button>
              <button
                type="button"
                className="btn btn-sm btn-danger"
                onClick={() => void excluir()}
                disabled={trabalhando}
                title={trabalhando ? "Cancele o pedido em andamento antes de excluir." : undefined}
              >
                Excluir orquestrador
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="rodape-da-criacao rodape-da-configuracao">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          {erro !== null ? (
            <p className="mono texto-longo line-clamp-3 text-[11.5px] text-error" role="alert">
              ✗ {erro}
            </p>
          ) : nomeVazio ? (
            <span className="flex items-center gap-2 text-[12.5px] text-warning">
              <IconeAlerta tamanho={15} className="shrink-0" />
              Dê um nome ao orquestrador para salvar.
            </span>
          ) : passouDoLimite ? (
            <span className="flex items-center gap-2 text-[12.5px] text-warning">
              <IconeAlerta tamanho={15} className="shrink-0" />
              Encurte as instruções para salvar.
            </span>
          ) : sugerirConversaNova ? (
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <span
                className="flex min-w-0 items-center gap-1.5 text-[12px] text-warning"
                title="O Claude ainda vê no histórico desta conversa as instruções de antes. Numa conversa nova, só valem as novas."
              >
                <IconeAlerta tamanho={14} className="shrink-0" />
                <span className="truncate">As instruções antigas seguem no histórico.</span>
              </span>
              <button
                type="button"
                className="btn btn-sm btn-outline shrink-0"
                onClick={() => void salvarEComecarConversaNova()}
                disabled={salvando || trabalhando}
                title={
                  trabalhando
                    ? "Cancele o pedido em andamento antes de começar uma conversa nova."
                    : "Salva a configuração e arquiva a conversa atual (o mesmo que /clear no prompt)."
                }
              >
                Salvar e começar conversa nova
              </button>
            </div>
          ) : (
            <span className="truncate text-[12.5px] text-primary" title={resumoDaConfiguracao(configuracao)}>
              {resumoDaConfiguracao(configuracao)}
            </span>
          )}
        </div>
        <button type="button" className="btn btn-ghost shrink-0" onClick={aoFechar}>
          Voltar
        </button>
        <button
          type="button"
          className="btn btn-cta shrink-0"
          onClick={() => void salvar()}
          disabled={salvando || passouDoLimite || nomeVazio}
        >
          {salvando ? "Salvando…" : "Salvar"}
        </button>
      </div>
    </div>
  );
}

/**
 * A configuração com a mesma referência enquanto o conteúdo não muda: a lista
 * de Orquestradores é consultada a cada poucos segundos e chega sempre com
 * objetos novos, o que re-renderizaria a transcrição inteira à toa.
 */
function useConfiguracaoEstavel(atual: DadosDaConfiguracao): DadosDaConfiguracao {
  const {
    modeloDoOrquestrador,
    esforcoDoOrquestrador,
    modeloDosSubagentes,
    esforcoDosSubagentes,
    nivelDePermissao,
    permitirCommitEPush,
    instrucoesPersonalizadas,
  } = atual;
  const { modo, limite } = atual.quantidadeDeSubagentes;
  return useMemo<DadosDaConfiguracao>(
    () => ({
      modeloDoOrquestrador,
      esforcoDoOrquestrador,
      modeloDosSubagentes,
      esforcoDosSubagentes,
      quantidadeDeSubagentes: { modo, limite },
      nivelDePermissao,
      permitirCommitEPush,
      instrucoesPersonalizadas,
    }),
    [
      modeloDoOrquestrador,
      esforcoDoOrquestrador,
      modeloDosSubagentes,
      esforcoDosSubagentes,
      modo,
      limite,
      nivelDePermissao,
      permitirCommitEPush,
      instrucoesPersonalizadas,
    ],
  );
}

/** De onde as linhas podem sair: o meio de cada lado. A de baixo vem primeiro, a padrão. */
const ANCORAS_DO_TERMINAL: readonly { id: Ancora; posicao: Position }[] = [
  { id: "baixo", posicao: Position.Bottom },
  { id: "cima", posicao: Position.Top },
  { id: "direita", posicao: Position.Right },
  { id: "esquerda", posicao: Position.Left },
];

/**
 * As âncoras das linhas: cada linha sai do lado voltado para o bixinho dela
 * (`ladoDoBixinho`). Existem desde a primeira medida: o React Flow só mede as
 * âncoras quando o nó muda de tamanho. Memorizadas: o arraste não as
 * re-renderiza a cada quadro.
 */
const AncorasDoTerminal = memo(function AncorasDoTerminal() {
  return (
    <>
      {ANCORAS_DO_TERMINAL.map(({ id, posicao }) => (
        <Handle key={id} id={id} type="source" position={posicao} className="ancora" isConnectable={false} />
      ))}
      {/* Onde chega a linha puxada de uma nota, prévia ou artefato: cobre o terminal
          inteiro e só recebe o mouse durante a ligação (daqui não se puxa nada). */}
      <Handle
        id={CHEGADA_DA_LIGACAO}
        type="target"
        position={Position.Left}
        className="chegada-da-ligacao"
        isConnectableStart={false}
      />
    </>
  );
});

type TipoDoItemLigado = "nota" | "previa" | "artefato";

const ROTULO_DO_ITEM_LIGADO: Readonly<Record<TipoDoItemLigado, string>> = {
  nota: "a nota",
  previa: "a prévia",
  artefato: "o artefato",
};

/** O ícone do chip: a folha da nota, o navegador da prévia e o documento do artefato. */
function IconeDoItemLigado({ tipo }: { tipo: TipoDoItemLigado }) {
  if (tipo === "previa") {
    return <IconeNavegador tamanho={11} className="shrink-0" />;
  }
  return (
    <svg width={11} height={11} viewBox="0 0 24 24" fill="none" aria-hidden="true" className="shrink-0">
      {tipo === "nota" ? (
        <path
          d="M5 4h14v11l-5 5H5zM14 20v-5h5M8 9h8M8 13h5"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      ) : (
        <path
          d="M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 16h6"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}

function ChipDoItemLigado({
  tipo,
  titulo,
  dica,
  aoDesligar,
}: {
  tipo: TipoDoItemLigado;
  titulo: string;
  dica: string;
  aoDesligar: () => void;
}) {
  return (
    <span className={`chip chip-item-ligado chip-item-ligado-${tipo}`} title={dica}>
      <IconeDoItemLigado tipo={tipo} />
      <span className="min-w-0 truncate">{titulo}</span>
      <button
        type="button"
        className="desligar-item-ligado nodrag"
        aria-label={`Desligar ${ROTULO_DO_ITEM_LIGADO[tipo]} ${titulo}`}
        title="Desligar deste orquestrador"
        onClick={aoDesligar}
      >
        <IconeFechar tamanho={10} />
      </button>
    </span>
  );
}

function ChipDaNotaLigada({ notaId, aoDesligar }: { notaId: string; aoDesligar: () => void }) {
  const nota = useNota(notaId);
  const titulo = nota?.titulo ?? "nota";
  return (
    <ChipDoItemLigado
      tipo="nota"
      titulo={titulo}
      dica={`Nota "${titulo}": o texto vai como contexto no próximo pedido`}
      aoDesligar={aoDesligar}
    />
  );
}

function ChipDaPreviaLigada({ itemId, aoDesligar }: { itemId: string; aoDesligar: () => void }) {
  const url = useNodesData<NoPrevia>(itemId)?.data.url ?? "";
  return (
    <ChipDoItemLigado
      tipo="previa"
      titulo={url === "" ? "prévia sem endereço" : enderecoCurto(url).replace(/\/$/, "")}
      dica={url === "" ? "Prévia sem endereço: não vai no pedido" : `Prévia ${url}: o endereço vai no próximo pedido`}
      aoDesligar={aoDesligar}
    />
  );
}

function ChipDoArtefatoLigado({ artefatoId, aoDesligar }: { artefatoId: string; aoDesligar: () => void }) {
  const artefato = useArtefato(artefatoId);
  const titulo = artefato?.titulo ?? "artefato";
  return (
    <ChipDoItemLigado
      tipo="artefato"
      titulo={titulo}
      dica={`Artefato "${titulo}": o caminho do arquivo vai no próximo pedido`}
      aoDesligar={aoDesligar}
    />
  );
}

/**
 * Os itens ligados ao terminal (notas, prévias e artefatos), logo acima do
 * prompt: um chip por item, com o × que desliga. É o que vai como contexto no
 * próximo pedido. Memorizados: só mudam quando a lista muda.
 */
const ItensLigados = memo(function ItensLigados({
  ligados,
  aoDesligar,
}: {
  ligados: readonly string[];
  aoDesligar: (itemId: string) => void;
}) {
  if (ligados.length === 0) {
    return null;
  }
  return (
    <div className="itens-ligados nodrag" role="group" aria-label="Itens ligados a este orquestrador">
      <span className="text-muted">ligados</span>
      {ligados.map((itemId) => {
        const desligar = () => aoDesligar(itemId);
        if (itemId.startsWith("nota:")) {
          return <ChipDaNotaLigada key={itemId} notaId={itemId.slice("nota:".length)} aoDesligar={desligar} />;
        }
        if (itemId.startsWith("previa:")) {
          return <ChipDaPreviaLigada key={itemId} itemId={itemId} aoDesligar={desligar} />;
        }
        if (itemId.startsWith("artefato:")) {
          return (
            <ChipDoArtefatoLigado key={itemId} artefatoId={itemId.slice("artefato:".length)} aoDesligar={desligar} />
          );
        }
        return null;
      })}
    </div>
  );
});

/** As alças de redimensionar. Memorizadas: o arraste não as re-renderiza a cada quadro. */
const Redimensionador = memo(function Redimensionador({ visivel }: { visivel: boolean }) {
  return (
    <NodeResizer
      isVisible={visivel}
      minWidth={TAMANHO_MINIMO_DO_TERMINAL.largura}
      minHeight={TAMANHO_MINIMO_DO_TERMINAL.altura}
      lineClassName="redimensionador-linha"
      handleClassName="redimensionador-alca"
    />
  );
});

/**
 * A largura da barra de título (`clientWidth`, com o recuo) e a do grupo dos
 * controles, acompanhadas pelo `ResizeObserver`. As duas ignoram o zoom do
 * canvas (são do layout, não da tela). Sem o observador (jsdom), ficam em
 * zero e nada vai para o "⋯".
 */
function useLargurasDaBarra(
  barra: RefObject<HTMLDivElement | null>,
  controles: RefObject<HTMLDivElement | null>,
  /** Muda quando a barra é montada de novo (a tela cheia): o observador passa para a barra nova. */
  montagem: unknown,
): { barra: number; controles: number } {
  const [larguraDaBarra, setLarguraDaBarra] = useState(0);
  const [larguraDosControles, setLarguraDosControles] = useState(0);

  useEffect(() => {
    const elementoDaBarra = barra.current;
    const elementoDosControles = controles.current;
    if (elementoDaBarra === null || elementoDosControles === null || typeof ResizeObserver === "undefined") {
      return undefined;
    }
    const medir = (): void => {
      setLarguraDaBarra(Math.round(elementoDaBarra.clientWidth));
      setLarguraDosControles(Math.round(elementoDosControles.offsetWidth));
    };
    const observador = new ResizeObserver(medir);
    observador.observe(elementoDaBarra);
    observador.observe(elementoDosControles);
    return () => observador.disconnect();
  }, [barra, controles, montagem]);

  return { barra: larguraDaBarra, controles: larguraDosControles };
}

/** Um chip da barra do terminal: na barra, cortado com reticências; no "⋯", inteiro. */
interface ItemDaBarra {
  id: ChipDaBarra;
  elemento: ReactNode;
}

/**
 * "⋯" na barra do terminal: os chips que não couberam, num menu que desce
 * encostado à direita. Clique fora e Esc fecham.
 */
function MaisDaBarra({ itens }: { itens: readonly ItemDaBarra[] }) {
  const [aberto, setAberto] = useState(false);
  const raiz = useRef<HTMLDivElement>(null);
  const idDoMenu = useId();

  // Clique fora fecha.
  useEffect(() => {
    if (!aberto) {
      return;
    }
    const aoPressionar = (evento: MouseEvent) => {
      if (raiz.current !== null && evento.target instanceof Node && !raiz.current.contains(evento.target)) {
        setAberto(false);
      }
    };
    document.addEventListener("mousedown", aoPressionar, true);
    return () => document.removeEventListener("mousedown", aoPressionar, true);
  }, [aberto]);

  const aoTeclar = (evento: EventoDeTecladoDoReact<HTMLDivElement>) => {
    if (evento.key === "Escape") {
      evento.preventDefault();
      evento.stopPropagation();
      setAberto(false);
    }
  };

  return (
    <div ref={raiz} className="ancora-do-mais-da-barra nodrag" onKeyDown={aoTeclar}>
      <button
        type="button"
        className="botao-icone nodrag"
        aria-label="Mais da barra"
        aria-haspopup="true"
        aria-expanded={aberto}
        aria-controls={aberto ? idDoMenu : undefined}
        title="O que não coube na barra deste terminal"
        onClick={() => setAberto((anterior) => !anterior)}
      >
        ⋯
      </button>
      {aberto && (
        <div id={idDoMenu} role="group" aria-label="O que não coube na barra" className="menu-da-barra-do-terminal painel-flutuante">
          {itens.map((item) => (
            <div key={item.id} className="item-da-barra-no-menu">
              {item.elemento}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Eventos da tela cheia não sobem até o nó: o React Flow não arrasta nem seleciona por baixo. */
function naoPropagar(evento: SyntheticEvent): void {
  evento.stopPropagation();
}

/**
 * O terminal em tela cheia (a bolinha verde do Mac): um painel flutuante
 * sobre a área do canvas (no `.react-flow`, fora do viewport: não escala com
 * o zoom), como o artefato ampliado. Esc e um clique na margem voltam; o Esc
 * que alguém lá dentro já usou (cancelar o pedido no prompt, fechar um menu,
 * desistir do nome) não.
 */
function TerminalEmTelaCheia({
  nome,
  alvo,
  aoSair,
  children,
}: {
  nome: string;
  alvo: HTMLElement;
  aoSair: () => void;
  children: ReactNode;
}) {
  // Esc com o foco fora de qualquer campo (no corpo da página) também volta.
  useEffect(() => {
    const aoTeclar = (evento: KeyboardEvent) => {
      if (evento.key === "Escape" && !evento.defaultPrevented && evento.target === document.body) {
        evento.preventDefault();
        aoSair();
      }
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [aoSair]);

  const aoTeclar = (evento: EventoDeTecladoDoReact<HTMLDivElement>) => {
    evento.stopPropagation();
    if (evento.key === "Escape" && !evento.defaultPrevented && !(evento.target instanceof HTMLInputElement)) {
      evento.preventDefault();
      aoSair();
    }
  };

  const aoPressionarOFundo = (evento: EventoDeMouseDoReact<HTMLDivElement>) => {
    evento.stopPropagation();
    if (evento.target === evento.currentTarget) {
      aoSair();
    }
  };

  return createPortal(
    <div
      data-testid="fundo-do-terminal-em-tela-cheia"
      className="fundo-do-terminal-em-tela-cheia fundo-que-esmaece nodrag nopan nowheel nokey"
      onMouseDown={aoPressionarOFundo}
      onClick={naoPropagar}
      onDoubleClick={naoPropagar}
      onPointerDown={naoPropagar}
      onContextMenu={naoPropagar}
      onWheel={naoPropagar}
      onKeyDown={aoTeclar}
      onKeyUp={naoPropagar}
    >
      <div role="dialog" aria-label={`${nome} em tela cheia`} className="painel-flutuante surgir terminal-em-tela-cheia">
        {children}
      </div>
    </div>,
    alvo,
  );
}

/**
 * Um Orquestrador no canvas: uma janela de terminal que se arrasta pela barra
 * de título e se redimensiona pelas bordas quando selecionada. Os bixinhos dos
 * Subagentes nascem abaixo dela, ligados por linhas.
 *
 * O React Flow re-renderiza o nó a cada quadro do arraste (posição,
 * `dragging`, `selected`). Por isso aqui fica só a moldura; o conteúdo está
 * em `JanelaDoTerminal`, memorizada, que não recebe nada disso.
 */
export function NoTerminal({ data, selected }: NodeProps<TipoDoNo>) {
  const { orquestradores } = useCanvas();
  const orquestrador = orquestradores.get(data.orquestradorId);

  // As âncoras das linhas existem desde a primeira medida, até carregando.
  if (orquestrador === undefined) {
    return (
      <>
        <AncorasDoTerminal />
        <div className="janela-terminal grid place-items-center mono text-muted">carregando orquestrador…</div>
      </>
    );
  }

  const minimizada = data.minimizada === true;
  return (
    <>
      <Redimensionador visivel={selected && !minimizada} />
      <AncorasDoTerminal />
      <JanelaDoTerminal
        orquestrador={orquestrador}
        escalaDaLetra={data.escalaDaLetra ?? ESCALA_DA_LETRA_PADRAO}
        minimizada={minimizada}
        ligados={data.ligados ?? SEM_ITENS_LIGADOS}
      />
    </>
  );
}

/**
 * A janela do terminal: barra de título, transcrição e prompt. Só re-renderiza
 * com novidades do canvas, nunca no arraste; e a transcrição e o prompt,
 * memorizados e com props estáveis, só quando o que eles mostram muda. O
 * tamanho da letra (`escalaDaLetra`) vale para tudo abaixo da barra de título.
 *
 * No app desktop do Mac, as bolinhas da barra fecham, minimizam e põem em
 * tela cheia (`BolinhasDoMac`), e o ✕ da direita sai; no Windows e no
 * navegador, elas são só o desenho, e o ✕ fica. Minimizado, o conteúdo fica
 * montado e escondido (o prompt não perde o texto). Em tela cheia, a janela
 * vai para um portal e o conteúdo é montado de novo: a conversa vem do
 * canvas, e o texto do prompt passa pelo `textoInicial`.
 */
const JanelaDoTerminal = memo(function JanelaDoTerminal({
  orquestrador,
  escalaDaLetra,
  minimizada,
  ligados,
}: {
  orquestrador: ResumoDoOrquestrador;
  escalaDaLetra: EscalaDaLetra;
  minimizada: boolean;
  /** Os ids dos nós ligados a este terminal (`DadosDoTerminal.ligados`). */
  ligados: readonly string[];
}) {
  const { conversas, conexoes, sinais, servidor, acoes } = useCanvas();
  const orquestradorId = orquestrador.id;
  const conversa = conversas.get(orquestradorId) ?? ESTADO_INICIAL;
  // Onde a tela cheia é desenhada (a área do canvas); nulo fora dela.
  const [telaCheiaEm, setTelaCheiaEm] = useState<HTMLElement | null>(null);
  const emTelaCheia = telaCheiaEm !== null;
  // Em tela cheia o conteúdo aparece mesmo com o nó minimizado no canvas.
  const escondido = minimizada && !emTelaCheia;
  // O texto do prompt na hora de entrar ou sair da tela cheia, para o prompt novo nascer com ele.
  const [textoDoPrompt, setTextoDoPrompt] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [configurando, setConfigurando] = useState(false);
  const [editandoNome, setEditandoNome] = useState(false);
  const [nomePendente, setNomePendente] = useState<string | null>(null);
  const [cancelamentoPedido, setCancelamentoPedido] = useState(false);
  const [imagens, setImagens] = useState<ImagemAnexada[]>([]);
  // As anexadas agora, para liberar as miniaturas ao remover e ao desmontar.
  const imagensAtuais = useRef(imagens);
  imagensAtuais.current = imagens;
  useEffect(() => () => liberarImagens(imagensAtuais.current), []);
  const [arraste, setArraste] = useState<Arraste | null>(null);
  // Modo do próximo pedido; "planejamento" é o Plan Mode (Shift+Tab no prompt).
  const [modo, setModo] = useState<ModoDoTurno>("execucao");
  const configuracao = useConfiguracaoEstavel(orquestrador.configuracao);
  const rolagem = useRef<HTMLDivElement>(null);
  const campoDoPrompt = useRef<HTMLTextAreaElement>(null);
  const controleDoPrompt = useRef<ControleDoPrompt>(null);
  const acompanhando = useRef(true);
  const barra = useRef<HTMLDivElement>(null);
  const controlesDaBarra = useRef<HTMLDivElement>(null);
  // Entrar ou sair da tela cheia monta a barra de novo: as medidas recomeçam nela.
  const larguras = useLargurasDaBarra(barra, controlesDaBarra, telaCheiaEm);

  // O nome do evento chega na hora; o do resumo, na próxima consulta da lista.
  const nome = nomePendente ?? conversa.nome ?? orquestrador.nome;
  const ultimoTurno = conversa.turnos.at(-1);
  const trabalhando = ultimoTurno?.situacao === "em_andamento";
  const cancelando = cancelamentoPedido && trabalhando;
  const piscando = usePiscarNaEntrega(ultimoTurno?.subagentes ?? SEM_SUBAGENTES, servidor.conectado);

  // A fila vem do resumo do servidor, corrigida pelos eventos (ver `filaDePedidos`).
  const fila = useReaproveitado<readonly DadosDoPedidoNaFila[]>(
    filaDePedidos(conversa, orquestrador.fila ?? SEM_FILA),
    reaproveitarFila,
  );
  const proximoDaFilaACaminho = useProximoDaFilaACaminho(ultimoTurno, fila.length > 0);

  // Também ao entrar e sair da tela cheia: a transcrição montada de novo começa do topo.
  useEffect(() => {
    const elemento = rolagem.current;
    if (elemento !== null && acompanhando.current) {
      elemento.scrollTop = elemento.scrollHeight;
    }
  }, [conversa.ultimaSequencia, erro, telaCheiaEm]);

  // Em tela cheia, já dá para escrever.
  useEffect(() => {
    if (telaCheiaEm !== null) {
      campoDoPrompt.current?.focus({ preventScroll: true });
    }
  }, [telaCheiaEm]);

  // Começo e fim de pedido atualizam a doca e a barra de status na hora.
  const { recarregar, lerItensLigados, desligarItem } = acoes;
  const aoDesligarItem = useCallback(
    (itemId: string) => desligarItem?.(orquestradorId, itemId),
    [desligarItem, orquestradorId],
  );
  useEffect(() => {
    void recarregar();
  }, [trabalhando, recarregar]);

  // As funções abaixo são estáveis (useCallback/useMemo): a transcrição e o
  // prompt são memorizados e só re-renderizam se alguma prop mudar de fato.

  const anexar = useCallback(
    async (arquivos: File[]): Promise<void> => {
      setErro(null);
      let quantidade = imagens.length;
      for (const arquivo of arquivos) {
        const problema = problemaDaImagem(arquivo, quantidade);
        if (problema !== null) {
          setErro(problema);
          continue;
        }
        quantidade += 1;
        try {
          const imagem = await lerImagem(arquivo);
          setImagens((atuais) => [...atuais, imagem]);
        } catch (falha) {
          setErro(mensagemDeErro(falha));
        }
      }
    },
    [imagens.length],
  );

  const aoAnexar = useCallback((arquivos: File[]) => void anexar(arquivos), [anexar]);

  const aoRemoverImagem = useCallback((id: string) => {
    liberarImagens(imagensAtuais.current.filter((imagem) => imagem.id === id));
    setImagens((atuais) => atuais.filter((imagem) => imagem.id !== id));
  }, []);

  const aoAlternarModo = useCallback(
    () => setModo((atual) => (atual === "planejamento" ? "execucao" : "planejamento")),
    [],
  );

  const enviar = useCallback(
    async (texto: string): Promise<boolean> => {
      setErro(null);
      try {
        // Só imagens, sem texto: o servidor exige uma mensagem, então vai uma padrão.
        const mensagem = texto.trim() === "" ? "Analise as imagens anexadas." : texto;
        // O base64 só nasce aqui, no envio.
        const anexos = imagens.length === 0 ? [] : await imagensParaEnvio(imagens);
        // Os itens ligados vão lidos na hora do envio; sem nenhum, o pedido é igual ao de antes.
        const itensLigados = lerItensLigados?.(orquestradorId) ?? [];
        await (itensLigados.length > 0
          ? api.enviarMensagem(orquestradorId, mensagem, anexos, modo, itensLigados)
          : api.enviarMensagem(orquestradorId, mensagem, anexos, modo));
        // As enviadas (e as que chegaram durante o envio, que também saem) liberam a miniatura.
        liberarImagens(imagensAtuais.current);
        setImagens([]);
        acompanhando.current = true;
        setCancelamentoPedido(false);
        return true;
      } catch (falha) {
        setErro(mensagemDeErro(falha));
        return false;
      }
    },
    [orquestradorId, imagens, modo, lerItensLigados],
  );

  /**
   * Com um pedido rodando, o Enter põe o texto na fila, com o modo escolhido
   * (o prompt já barra as imagens). O pedido aparece na fila pelo evento
   * `pedido_enfileirado`; com a fila cheia, o servidor recusa e o erro aparece
   * no terminal.
   */
  const enfileirar = useCallback(
    async (texto: string): Promise<boolean> => {
      setErro(null);
      try {
        // A fila guarda os itens ligados como estão agora.
        const itensLigados = lerItensLigados?.(orquestradorId) ?? [];
        await (itensLigados.length > 0
          ? api.enfileirarPedido(orquestradorId, texto, modo, itensLigados)
          : api.enfileirarPedido(orquestradorId, texto, modo));
        return true;
      } catch (falha) {
        setErro(mensagemDeErro(falha));
        return false;
      }
    },
    [orquestradorId, modo, lerItensLigados],
  );

  const removerDaFila = useCallback(
    async (pedidoId: string): Promise<void> => {
      setErro(null);
      try {
        await api.removerDaFila(orquestradorId, pedidoId);
      } catch (falha) {
        setErro(mensagemDeErro(falha));
      }
    },
    [orquestradorId],
  );

  const aoRemoverDaFila = useCallback((pedidoId: string) => void removerDaFila(pedidoId), [removerDaFila]);

  /** "Enviar agora" (fila pausada): o pedido sai da fila e vira um turno, como um envio. */
  const enviarDaFila = useCallback(
    async (pedidoId: string): Promise<void> => {
      setErro(null);
      try {
        await api.enviarDaFila(orquestradorId, pedidoId);
        acompanhando.current = true;
        setCancelamentoPedido(false);
      } catch (falha) {
        setErro(mensagemDeErro(falha));
      }
    },
    [orquestradorId],
  );

  const aoEnviarDaFila = useCallback((pedidoId: string) => void enviarDaFila(pedidoId), [enviarDaFila]);

  const cancelar = useCallback(async (): Promise<void> => {
    setErro(null);
    setCancelamentoPedido(true);
    try {
      await api.cancelar(orquestradorId);
    } catch (falha) {
      setErro(mensagemDeErro(falha));
      setCancelamentoPedido(false);
    }
  }, [orquestradorId]);

  const aoCancelar = useCallback(() => void cancelar(), [cancelar]);

  /**
   * Conversa nova: a atual fica arquivada no servidor, que avisa pelo evento
   * `conversa_limpa` (é ele que esvazia a transcrição). Lança o erro do servidor
   * — ex.: 409 durante um pedido. Sem `trabalhando` nas dependências: o prompt
   * e o painel já bloqueiam durante o pedido, e a função segue estável.
   */
  const iniciarConversaNova = useCallback(async (): Promise<void> => {
    await api.limparConversa(orquestradorId);
    acompanhando.current = true;
    setCancelamentoPedido(false);
    void recarregar();
  }, [orquestradorId, recarregar]);

  /** "/clear" no prompt: o erro aparece no terminal e o comando fica no campo. */
  const limparConversa = useCallback(async (): Promise<boolean> => {
    setErro(null);
    try {
      await iniciarConversaNova();
      return true;
    } catch (falha) {
      setErro(mensagemDeErro(falha));
      return false;
    }
  }, [iniciarConversaNova]);

  const aprovarPlano = useCallback(async (commitarAoFinal: boolean): Promise<void> => {
    setErro(null);
    try {
      await api.aprovarPlano(orquestradorId, "", commitarAoFinal);
      // A execução começa na hora: sai do Plan Mode e acompanha o turno novo, como num envio.
      setModo("execucao");
      acompanhando.current = true;
      setCancelamentoPedido(false);
    } catch (falha) {
      setErro(mensagemDeErro(falha));
    }
  }, [orquestradorId]);

  const descartarPlano = useCallback(async (): Promise<void> => {
    setErro(null);
    try {
      await api.descartarPlano(orquestradorId);
    } catch (falha) {
      setErro(mensagemDeErro(falha));
    }
  }, [orquestradorId]);

  // O modo atual sem trocar a identidade da resposta às perguntas: a transcrição
  // é memorizada e não precisa re-renderizar quando o Plan Mode liga ou desliga.
  const modoAtual = useRef(modo);
  useEffect(() => {
    modoAtual.current = modo;
  }, [modo]);

  /**
   * A escolha nas perguntas do Orquestrador vai como um pedido novo, pelo mesmo
   * envio do prompt e no modo atual (sem as imagens anexadas no prompt). Lança
   * o erro do servidor (ex.: 409 com um pedido rodando): o cartão o mostra.
   */
  const responderPergunta = useCallback(
    async (texto: string): Promise<void> => {
      setErro(null);
      await api.enviarMensagem(orquestradorId, texto, [], modoAtual.current);
      acompanhando.current = true;
      setCancelamentoPedido(false);
    },
    [orquestradorId],
  );

  /** O ajuste vai como um novo pedido de planejamento, escrito no prompt. */
  const ajustarPlano = useCallback((): void => {
    setModo("planejamento");
    campoDoPrompt.current?.focus();
  }, []);

  /** Renomear pelo clique duplo no nome: vale também durante um pedido. Esc ou em branco mantém o nome. */
  async function concluirNome(novo: string | null): Promise<void> {
    setEditandoNome(false);
    const aparado = novo?.trim() ?? "";
    if (aparado === "" || aparado === nome) {
      return;
    }
    setErro(null);
    setNomePendente(aparado);
    try {
      await api.renomearOrquestrador(orquestradorId, aparado);
      await recarregar();
    } catch (falha) {
      setErro(`Não foi possível renomear: ${mensagemDeErro(falha)}`);
    } finally {
      setNomePendente(null);
    }
  }

  /** Sai da tela cheia; o prompt montado de novo nasce com o texto que estava escrito. */
  const sairDaTelaCheia = useCallback(() => {
    setTextoDoPrompt(campoDoPrompt.current?.value ?? "");
    setTelaCheiaEm(null);
  }, []);

  /** A bolinha verde: a tela cheia cobre a área do canvas (o `.react-flow` em volta do nó). */
  function alternarTelaCheia(): void {
    if (emTelaCheia) {
      sairDaTelaCheia();
      return;
    }
    setTextoDoPrompt(campoDoPrompt.current?.value ?? "");
    setTelaCheiaEm(barra.current?.closest<HTMLElement>(".react-flow") ?? document.body);
  }

  /** A bolinha amarela e o duplo clique na barra minimizada; em tela cheia, sai dela antes de minimizar. */
  function minimizarOuRestaurar(): void {
    if (emTelaCheia) {
      sairDaTelaCheia();
    }
    acoes.minimizarOuRestaurarTerminal(orquestradorId);
  }

  /** "abrir prévia" na faixa dos servidores: a prévia nasce ligada a este terminal. */
  const { abrirPrevia } = acoes;
  const aoAbrirPrevia = useCallback((url: string) => abrirPrevia(orquestradorId, url), [abrirPrevia, orquestradorId]);

  /** O campo "Tamanho da letra" do ⚙: o nó do terminal tem o id do Orquestrador. */
  const { mudarEscalaDaLetra } = acoes;
  const tamanhoDaLetra = useMemo(
    () => ({
      valor: escalaDaLetra,
      aoMudar: (escala: EscalaDaLetra) => mudarEscalaDaLetra(orquestradorId, escala),
    }),
    [escalaDaLetra, mudarEscalaDaLetra, orquestradorId],
  );

  // Um agente acabou de subir um servidor: a prévia abre sozinha, ao lado
  // deste terminal e selecionada. Cada anúncio abre uma vez só.
  const detectado = conversa.ultimoEnderecoDetectado;
  useEffect(() => {
    if (detectado === null || jaAbertoSozinho(orquestradorId, detectado.sequencia)) {
      return;
    }
    marcarAbertoSozinho(orquestradorId, detectado.sequencia);
    if (abrirPreviaSozinha(detectado, Date.now(), window.location.origin)) {
      abrirPrevia(orquestradorId, detectado.url);
    }
  }, [abrirPrevia, detectado, orquestradorId]);

  // O bloco "Terminal" ligado a este Orquestrador escreve no prompt por aqui (o "enviar ao orquestrador").
  useEffect(
    () =>
      registrarPromptDoTerminal(orquestradorId, {
        acrescentarTexto: (texto) => controleDoPrompt.current?.acrescentarTexto(texto),
      }),
    [orquestradorId],
  );

  /** "Abrir terminal": um shell na pasta (ou worktree) deste Orquestrador, ligado a ele. */
  const acoesDosShells = useAcoesDosShellsSeHouver();

  const acoesDoPlano = useMemo<AcoesDoPlano>(
    () => ({ aoAprovar: aprovarPlano, aoAjustar: ajustarPlano, aoDescartar: descartarPlano }),
    [aprovarPlano, ajustarPlano, descartarPlano],
  );

  // Os chips da barra: à esquerda do espaçador, a pasta e a branch; à direita, o resto.
  // Cortados com reticências (o texto inteiro no `title`); sem espaço nem assim, vão para o "⋯".
  const chipsDaEsquerda: ItemDaBarra[] = [
    {
      id: "pasta",
      elemento: (
        <span className="flex min-w-0 items-center gap-1 mono text-muted" title={orquestrador.pastaDeTrabalho}>
          <IconePasta className="shrink-0" />
          <span className="truncate">{orquestrador.nomeDaPasta}</span>
        </span>
      ),
    },
  ];
  if (orquestrador.worktree !== null) {
    chipsDaEsquerda.push({
      id: "branch",
      elemento: <EtiquetaDeWorktree worktree={orquestrador.worktree} className="max-w-[9rem]" />,
    });
  }
  const chipsDaDireita: ItemDaBarra[] = [];
  if (orquestrador.instrucoesAtivas !== null) {
    chipsDaDireita.push({
      id: "instrucoes",
      elemento: (
        <span
          className="chip chip-instrucoes min-w-0 overflow-hidden"
          title={
            orquestrador.instrucoesAtivas === "orquestrador"
              ? "Instruções personalizadas deste orquestrador ativas (na engrenagem, para ver ou editar)"
              : "Instruções gerais ativas (botão Instruções gerais, na barra do canvas)"
          }
        >
          <span className="min-w-0 truncate">
            {orquestrador.instrucoesAtivas === "orquestrador" ? "instruções" : "instruções gerais"}
          </span>
        </span>
      ),
    });
  }
  if (servidor.conectado && conexoes.get(orquestradorId) === "reconectando") {
    chipsDaDireita.push({
      id: "reconectando",
      elemento: (
        <span className="min-w-0 truncate mono text-error" title="Reconectando à conversa deste orquestrador">
          reconectando…
        </span>
      ),
    });
  }
  const noMenu = chipsParaOMenu(
    larguras.barra,
    larguras.controles,
    [...chipsDaEsquerda, ...chipsDaDireita].map((chip) => chip.id),
  );
  const naBarra = (chip: ItemDaBarra): boolean => !noMenu.has(chip.id);
  const foraDaBarra = [...chipsDaEsquerda, ...chipsDaDireita].filter((chip) => noMenu.has(chip.id));

  /** Minimizado, o duplo clique na barra restaura (menos nos botões dela). */
  const aoDuploCliqueNaBarra = (evento: EventoDeMouseDoReact<HTMLDivElement>) => {
    if (!(evento.target instanceof Element && evento.target.closest("button, input") !== null)) {
      minimizarOuRestaurar();
    }
  };

  const controlesDaJanela = {
    objeto: "o terminal",
    aoFechar: () => acoes.fecharTerminal(orquestradorId),
    dicaDoFechar: "Fechar o terminal (o orquestrador e o histórico continuam salvos)",
    aoMinimizar: minimizarOuRestaurar,
    minimizada,
    aoAmpliar: alternarTelaCheia,
    ampliada: emTelaCheia,
  };

  const janela = (
    <div
      className={`janela-terminal ${trabalhando ? "janela-terminal-ativa" : ""} ${modo === "planejamento" ? "janela-terminal-planejando" : ""} ${piscando ? "janela-terminal-entrega" : ""} ${escondido ? "janela-terminal-minimizada" : ""}`}
      onDragOver={(evento) => {
        // Uma linha ou uma nota arrastada vira texto no prompt; arquivos, imagens anexadas.
        if (temPedidoArrastado(evento.dataTransfer)) {
          evento.preventDefault();
          evento.dataTransfer.dropEffect = "copy";
          setArraste("pedido");
        } else if (evento.dataTransfer.types.includes("Files")) {
          evento.preventDefault();
          setArraste("imagens");
        }
      }}
      onDragLeave={(evento) => {
        if (!evento.currentTarget.contains(evento.relatedTarget as Node | null)) {
          setArraste(null);
        }
      }}
      onDrop={(evento) => {
        setArraste(null);
        if (temPedidoArrastado(evento.dataTransfer)) {
          // Também impede o campo de texto de colar o texto puro do arraste por conta própria.
          evento.preventDefault();
          const pedido = lerPedidoArrastado(evento.dataTransfer);
          if (pedido !== null) {
            // Só escreve no prompt: quem envia é o usuário.
            controleDoPrompt.current?.acrescentarTexto(pedido.texto);
          }
          return;
        }
        if (evento.dataTransfer.files.length > 0) {
          evento.preventDefault();
          void anexar([...evento.dataTransfer.files]);
        }
      }}
    >
      {arraste === "imagens" && (
        <div className="soltar-imagens">solte para anexar as imagens a este orquestrador</div>
      )}
      {arraste === "pedido" && (
        <div className="soltar-imagens">solte para escrever no prompt — nada é enviado até você apertar enter</div>
      )}
      <div
        ref={barra}
        className={`barra-do-terminal ${ALCA_DO_TERMINAL}`}
        onDoubleClick={escondido ? aoDuploCliqueNaBarra : undefined}
      >
        {/* Os mesmos controles dos outros nós: bolinhas no Mac, botões à direita nos demais. */}
        <ControlesDoNo lado="inicio" {...controlesDaJanela} />
        <IconeOrquestrador tamanho={14} className="shrink-0 text-active" />
        {editandoNome ? (
          <CampoDoNome nome={nome} aoConcluir={(novo) => void concluirNome(novo)} />
        ) : (
          // Minimizado, o clique duplo é da barra (restaurar), e não do renomear.
          <strong
            className="truncate font-titulo text-[12.5px] font-semibold"
            title={escondido ? `${nome} · clique duplo para restaurar` : `${nome} · clique duplo para renomear`}
            onDoubleClick={escondido ? undefined : () => setEditandoNome(true)}
          >
            {nome}
          </strong>
        )}
        {chipsDaEsquerda.filter(naBarra).map((chip) => (
          <Fragment key={chip.id}>{chip.elemento}</Fragment>
        ))}
        <span className="flex-1" />
        {chipsDaDireita.filter(naBarra).map((chip) => (
          <Fragment key={chip.id}>{chip.elemento}</Fragment>
        ))}
        {foraDaBarra.length > 0 && <MaisDaBarra itens={foraDaBarra} />}
        {/* Os controles nunca encolhem nem saem da barra: quem cede espaço são os chips. */}
        <div ref={controlesDaBarra} className="controles-da-barra">
          <BotaoDeLimparBixinhos orquestradorId={orquestradorId} />
          <BotaoDeAlteracoes orquestradorId={orquestradorId} />
          <BotaoDeArquivos orquestradorId={orquestradorId} nomeDoOrquestrador={nome} />
          {acoesDosShells !== null && (
            <button
              type="button"
              className="botao-icone nodrag"
              title="Abrir um terminal na pasta deste orquestrador"
              aria-label="Abrir terminal"
              onClick={() => acoesDosShells.abrirShell({ orquestradorId })}
            >
              <IconeShell tamanho={16} />
            </button>
          )}
          <button
            type="button"
            className="botao-icone nodrag"
            title="Configurar"
            aria-label="Configurar"
            aria-pressed={configurando}
            onClick={() => {
              // Minimizado, o ⚙ restaura o terminal e já abre a configuração.
              if (escondido) {
                minimizarOuRestaurar();
                setConfigurando(true);
              } else {
                setConfigurando((atual) => !atual);
              }
            }}
          >
            <IconeEngrenagem />
          </button>
          <ControlesDoNo lado="fim" {...controlesDaJanela} />
        </div>
      </div>

      {/* Minimizado, fica montado e escondido: o prompt e a rolagem não se perdem. */}
      <div className="conteudo-do-cartao" style={{ zoom: escalaDaLetra }} hidden={escondido}>
        {configurando && (
          <PainelDeConfiguracao
            orquestrador={orquestrador}
            trabalhando={trabalhando}
            conversaComTurnos={conversa.turnos.length > 0}
            aoFechar={() => setConfigurando(false)}
            aoLimparConversa={iniciarConversaNova}
            tamanhoDaLetra={tamanhoDaLetra}
            nome={nome}
          />
        )}

        <div
          ref={rolagem}
          onScroll={() => {
            const elemento = rolagem.current;
            if (elemento !== null) {
              acompanhando.current =
                elemento.scrollHeight - elemento.scrollTop - elemento.clientHeight < MARGEM_DE_ACOMPANHAMENTO;
            }
          }}
          className="corpo-do-terminal custom-scrollbar nodrag nowheel"
        >
          <TranscricaoDoTerminal
            orquestradorId={orquestradorId}
            nome={nome}
            pastaDeTrabalho={orquestrador.pastaDeTrabalho}
            configuracao={configuracao}
            predefinicao={orquestrador.predefinicaoCorrespondente ?? null}
            turnos={conversa.turnos}
            conversaIniciadaEm={conversa.conversaIniciadaEm}
            avisosDaConversaNova={conversa.avisosDaConversaNova}
            sinal={sinais.get(orquestradorId)}
            desconectado={!servidor.conectado}
            acoesDoPlano={acoesDoPlano}
            aoResponderPergunta={responderPergunta}
          />
          {erro !== null && <p className="mono texto-longo mt-3 text-error">✗ {erro}</p>}
        </div>

        <FaixaDeServidores enderecos={conversa.enderecosLocais} aoAbrir={aoAbrirPrevia} />
        <ItensLigados ligados={ligados} aoDesligar={aoDesligarItem} />
        <PromptDoTerminal
          pasta={orquestrador.nomeDaPasta}
          desconectado={!servidor.conectado}
          trabalhando={trabalhando}
          cancelando={cancelando}
          modo={modo}
          aoAlternarModo={aoAlternarModo}
          campo={campoDoPrompt}
          controle={controleDoPrompt}
          imagens={imagens}
          aoAnexar={aoAnexar}
          aoRemoverImagem={aoRemoverImagem}
          aoEnviar={enviar}
          aoEnfileirar={enfileirar}
          fila={fila}
          proximoDaFilaACaminho={proximoDaFilaACaminho}
          aoRemoverDaFila={aoRemoverDaFila}
          aoEnviarDaFila={aoEnviarDaFila}
          aoLimparConversa={limparConversa}
          aoCancelar={aoCancelar}
          textoInicial={textoDoPrompt}
        />
      </div>
      {trabalhando && servidor.conectado && <div className="faixa-de-progresso" />}
    </div>
  );

  if (telaCheiaEm === null) {
    return janela;
  }
  // Em tela cheia, o nó fica no canvas só como o lugar para onde a janela volta.
  return (
    <>
      <div className="janela-terminal grid place-items-center mono text-muted">em tela cheia · Esc volta</div>
      <TerminalEmTelaCheia nome={nome} alvo={telaCheiaEm} aoSair={sairDaTelaCheia}>
        {janela}
      </TerminalEmTelaCheia>
    </>
  );
});
