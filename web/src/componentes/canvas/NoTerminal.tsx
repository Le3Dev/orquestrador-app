import { Handle, type NodeProps, NodeResizer, Position } from "@xyflow/react";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

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
import { useCanvas } from "../../shared/canvas/contexto";
import {
  DURACAO_DA_ENTREGA_MS,
  DURACAO_DO_PISCAR_MS,
  entregaRecente,
  houveEntrega,
  prefereMovimentoReduzido,
} from "../../shared/canvas/entrega";
import { ESCALA_DA_LETRA_PADRAO, type EscalaDaLetra, TAMANHO_MINIMO_DO_TERMINAL } from "../../shared/canvas/layout";
import { ALCA_DO_TERMINAL, type Ancora, type NoTerminal as TipoDoNo } from "../../shared/canvas/nos";
import { lerPedidoArrastado, temPedidoArrastado } from "../../shared/canvas/pedidoArrastado";
import { registrarPromptDoTerminal } from "../../shared/canvas/promptsDosTerminais";
import { useAcoesDosShellsSeHouver } from "../../shared/canvas/shells";
import { abrirPreviaSozinha } from "../../shared/enderecosLocais";
import {
  ESTADO_INICIAL,
  filaDePedidos,
  type SubagenteNaTela,
  type TurnoNaTela,
} from "../../shared/estado/aplicarEvento";
import { formatarBytes } from "../../shared/formatacao";
import { mesmoConteudo, useReaproveitado } from "../../shared/hooks/useReaproveitado";
import { type ImagemAnexada, lerImagem, problemaDaImagem } from "../../shared/imagens";
import { tamanhoDasInstrucoes } from "../../shared/instrucoes";
import { resumoDaConfiguracao } from "../../shared/resumoDaConfiguracao";
import { CamposDaConfiguracao } from "../CamposDaConfiguracao";
import { Etiqueta } from "../Etiqueta";
import { EtiquetaDeWorktree } from "../EtiquetaDeWorktree";
import { IconeAlerta, IconeEngrenagem, IconeFechar, IconeOrquestrador, IconePasta, IconeShell } from "../Icones";
import { BotaoDeAlteracoes } from "./BotaoDeAlteracoes";
import { BotaoDeArquivos } from "./BotaoDeArquivos";
import { BotaoDeLimparBixinhos } from "./BotaoDeLimparBixinhos";
import type { AcoesDoPlano } from "./CartaoDoPlano";
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
const SEM_SUBAGENTES: readonly SubagenteNaTela[] = [];

/** A fila anterior enquanto o conteúdo não muda: o prompt (memorizado) não re-renderiza à toa. */
function reaproveitarFila(
  anterior: readonly DadosDoPedidoNaFila[],
  nova: readonly DadosDoPedidoNaFila[],
): readonly DadosDoPedidoNaFila[] {
  return mesmoConteudo(anterior, nova) ? anterior : nova;
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

interface PropsDaConfiguracao {
  orquestrador: ResumoDoOrquestrador;
  trabalhando: boolean;
  aoFechar: () => void;
  /** Começa uma conversa nova (o mesmo que "/clear"); lança o erro do servidor, se houver. */
  aoLimparConversa: () => Promise<void>;
  /** O tamanho da letra deste terminal no canvas: muda na hora, sem o Salvar (não é dado do servidor). */
  tamanhoDaLetra?: { valor: EscalaDaLetra; aoMudar: (escala: EscalaDaLetra) => void };
}

export function PainelDeConfiguracao({
  orquestrador,
  trabalhando,
  aoFechar,
  aoLimparConversa,
  tamanhoDaLetra,
}: PropsDaConfiguracao) {
  const { acoes } = useCanvas();
  const [configuracao, setConfiguracao] = useState(orquestrador.configuracao);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const { id: orquestradorId, pastaDeTrabalho } = orquestrador;
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
      void recarregar();
      return resumo.configuracao;
    },
    [orquestradorId, recarregar],
  );

  async function salvar(): Promise<void> {
    setErro(null);
    setSalvando(true);
    try {
      await api.alterarConfiguracao(orquestrador.id, configuracao);
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

  const passouDoLimite = tamanhoDasInstrucoes(configuracao.instrucoesPersonalizadas) > TAMANHO_MAXIMO_DAS_INSTRUCOES;

  // As mesmas linhas e o mesmo rodapé do cartão de criação (NoRascunho).
  return (
    <div className="painel-da-configuracao nodrag">
      <div className="corpo-do-terminal corpo-da-criacao corpo-da-configuracao custom-scrollbar nodrag nowheel">
        <span className="rotulo-tecnico">configuração · vale a partir do próximo pedido</span>
        <div className="linhas-da-configuracao mt-2.5">
          <CamposDaConfiguracao
            valor={configuracao}
            aoMudar={setConfiguracao}
            buscarEsforcoHerdado={buscarEsforcoHerdado}
            aplicarPredefinicao={aplicarPredefinicao}
            pastaDeTrabalho={pastaDeTrabalho}
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
          ) : passouDoLimite ? (
            <span className="flex items-center gap-2 text-[12.5px] text-warning">
              <IconeAlerta tamanho={15} className="shrink-0" />
              Encurte as instruções para salvar.
            </span>
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
          disabled={salvando || passouDoLimite}
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
    </>
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

  return (
    <>
      <Redimensionador visivel={selected} />
      <AncorasDoTerminal />
      <JanelaDoTerminal orquestrador={orquestrador} escalaDaLetra={data.escalaDaLetra ?? ESCALA_DA_LETRA_PADRAO} />
    </>
  );
}

/**
 * A janela do terminal: barra de título, transcrição e prompt. Só re-renderiza
 * com novidades do canvas, nunca no arraste; e a transcrição e o prompt,
 * memorizados e com props estáveis, só quando o que eles mostram muda. O
 * tamanho da letra (`escalaDaLetra`) vale para tudo abaixo da barra de título.
 */
const JanelaDoTerminal = memo(function JanelaDoTerminal({
  orquestrador,
  escalaDaLetra,
}: {
  orquestrador: ResumoDoOrquestrador;
  escalaDaLetra: EscalaDaLetra;
}) {
  const { conversas, conexoes, sinais, servidor, acoes } = useCanvas();
  const orquestradorId = orquestrador.id;
  const conversa = conversas.get(orquestradorId) ?? ESTADO_INICIAL;
  const [erro, setErro] = useState<string | null>(null);
  const [configurando, setConfigurando] = useState(false);
  const [cancelamentoPedido, setCancelamentoPedido] = useState(false);
  const [imagens, setImagens] = useState<ImagemAnexada[]>([]);
  const [arraste, setArraste] = useState<Arraste | null>(null);
  // Modo do próximo pedido; "planejamento" é o Plan Mode (Shift+Tab no prompt).
  const [modo, setModo] = useState<ModoDoTurno>("execucao");
  const memoriaDoProcesso = servidor.memoria?.porOrquestrador[orquestradorId] ?? 0;
  const configuracao = useConfiguracaoEstavel(orquestrador.configuracao);
  const rolagem = useRef<HTMLDivElement>(null);
  const campoDoPrompt = useRef<HTMLTextAreaElement>(null);
  const controleDoPrompt = useRef<ControleDoPrompt>(null);
  const acompanhando = useRef(true);

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

  useEffect(() => {
    const elemento = rolagem.current;
    if (elemento !== null && acompanhando.current) {
      elemento.scrollTop = elemento.scrollHeight;
    }
  }, [conversa.ultimaSequencia, erro]);

  // Começo e fim de pedido atualizam a doca e a barra de status na hora.
  const { recarregar } = acoes;
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

  const aoRemoverImagem = useCallback(
    (id: string) => setImagens((atuais) => atuais.filter((imagem) => imagem.id !== id)),
    [],
  );

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
        await api.enviarMensagem(
          orquestradorId,
          mensagem,
          imagens.map((imagem) => ({ nome: imagem.nome, tipoDeMidia: imagem.tipoDeMidia, base64: imagem.base64 })),
          modo,
        );
        setImagens([]);
        acompanhando.current = true;
        setCancelamentoPedido(false);
        return true;
      } catch (falha) {
        setErro(mensagemDeErro(falha));
        return false;
      }
    },
    [orquestradorId, imagens, modo],
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
        await api.enfileirarPedido(orquestradorId, texto, modo);
        return true;
      } catch (falha) {
        setErro(mensagemDeErro(falha));
        return false;
      }
    },
    [orquestradorId, modo],
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

  const aprovarPlano = useCallback(async (): Promise<void> => {
    setErro(null);
    try {
      await api.aprovarPlano(orquestradorId);
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

  return (
    <div
      className={`janela-terminal ${trabalhando ? "janela-terminal-ativa" : ""} ${modo === "planejamento" ? "janela-terminal-planejando" : ""} ${piscando ? "janela-terminal-entrega" : ""}`}
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
      <div className={`barra-do-terminal ${ALCA_DO_TERMINAL}`}>
        <span className="semaforo" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <IconeOrquestrador tamanho={14} className="shrink-0 text-active" />
        <strong className="truncate font-titulo text-[12.5px] font-semibold">{orquestrador.nome}</strong>
        <span className="flex min-w-0 items-center gap-1 mono text-muted" title={orquestrador.pastaDeTrabalho}>
          <IconePasta className="shrink-0" />
          <span className="truncate">{orquestrador.nomeDaPasta}</span>
        </span>
        <EtiquetaDeWorktree worktree={orquestrador.worktree} className="max-w-[9rem]" />
        <span className="flex-1" />
        {orquestrador.instrucoesAtivas !== null && (
          <span
            className="chip chip-instrucoes"
            title={
              orquestrador.instrucoesAtivas === "orquestrador"
                ? "Instruções personalizadas deste orquestrador ativas (na engrenagem, para ver ou editar)"
                : "Instruções gerais ativas (botão Instruções gerais, na barra do canvas)"
            }
          >
            {orquestrador.instrucoesAtivas === "orquestrador" ? "instruções" : "instruções gerais"}
          </span>
        )}
        {servidor.conectado && conexoes.get(orquestradorId) === "reconectando" && (
          <span className="mono text-error">reconectando…</span>
        )}
        {/* A medição é a cada 5 s: fora de um pedido, o número seria de um processo que já acabou. */}
        {trabalhando && memoriaDoProcesso > 0 && (
          <span className="chip" title="Memória usada agora pelo processo do Claude deste orquestrador (com os subagentes)">
            RAM {formatarBytes(memoriaDoProcesso)}
          </span>
        )}
        <Etiqueta situacao={trabalhando ? "trabalhando" : "ocioso"} />
        <BotaoDeLimparBixinhos orquestradorId={orquestradorId} />
        <BotaoDeAlteracoes orquestradorId={orquestradorId} />
        <BotaoDeArquivos orquestradorId={orquestradorId} nomeDoOrquestrador={orquestrador.nome} />
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
          onClick={() => setConfigurando((atual) => !atual)}
        >
          <IconeEngrenagem />
        </button>
        <button
          type="button"
          className="botao-icone nodrag"
          title="Fechar o terminal (o orquestrador e o histórico continuam salvos)"
          aria-label="Fechar o terminal"
          onClick={() => acoes.fecharTerminal(orquestradorId)}
        >
          <IconeFechar />
        </button>
      </div>

      <div className="conteudo-do-cartao" style={{ zoom: escalaDaLetra }}>
        {configurando && (
          <PainelDeConfiguracao
            orquestrador={orquestrador}
            trabalhando={trabalhando}
            aoFechar={() => setConfigurando(false)}
            aoLimparConversa={iniciarConversaNova}
            tamanhoDaLetra={tamanhoDaLetra}
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
            nome={orquestrador.nome}
            pastaDeTrabalho={orquestrador.pastaDeTrabalho}
            configuracao={configuracao}
            predefinicao={orquestrador.predefinicaoCorrespondente ?? null}
            turnos={conversa.turnos}
            conversaIniciadaEm={conversa.conversaIniciadaEm}
            sinal={sinais.get(orquestradorId)}
            desconectado={!servidor.conectado}
            acoesDoPlano={acoesDoPlano}
            aoResponderPergunta={responderPergunta}
          />
          {erro !== null && <p className="mono texto-longo mt-3 text-error">✗ {erro}</p>}
        </div>

        <FaixaDeServidores enderecos={conversa.enderecosLocais} aoAbrir={aoAbrirPrevia} />
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
        />
      </div>
      {trabalhando && servidor.conectado && <div className="faixa-de-progresso" />}
    </div>
  );
});
