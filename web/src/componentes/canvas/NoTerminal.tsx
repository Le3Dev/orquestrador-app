import { Handle, type NodeProps, NodeResizer, Position } from "@xyflow/react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { api, mensagemDeErro } from "../../shared/api/cliente";
import type { DadosDaConfiguracao, ModoDoTurno, ResumoDoOrquestrador } from "../../shared/api/tipos";
import { useCanvas } from "../../shared/canvas/contexto";
import { TAMANHO_MINIMO_DO_TERMINAL } from "../../shared/canvas/layout";
import { ALCA_DO_TERMINAL, type Ancora, type NoTerminal as TipoDoNo } from "../../shared/canvas/nos";
import { abrirPreviaSozinha } from "../../shared/enderecosLocais";
import { ESTADO_INICIAL } from "../../shared/estado/aplicarEvento";
import { formatarBytes } from "../../shared/formatacao";
import { type ImagemAnexada, lerImagem, problemaDaImagem } from "../../shared/imagens";
import { CamposDaConfiguracao } from "../CamposDaConfiguracao";
import { Etiqueta } from "../Etiqueta";
import { EtiquetaDeWorktree } from "../EtiquetaDeWorktree";
import { IconeEngrenagem, IconeFechar, IconeOrquestrador, IconePasta } from "../Icones";
import { BotaoDeLimparBixinhos } from "./BotaoDeLimparBixinhos";
import type { AcoesDoPlano } from "./CartaoDoPlano";
import { FaixaDeServidores } from "./FaixaDeServidores";
import { PromptDoTerminal } from "./PromptDoTerminal";
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

interface PropsDaConfiguracao {
  orquestrador: ResumoDoOrquestrador;
  trabalhando: boolean;
  aoFechar: () => void;
  /** Começa uma conversa nova (o mesmo que "/clear"); lança o erro do servidor, se houver. */
  aoLimparConversa: () => Promise<void>;
}

export function PainelDeConfiguracao({ orquestrador, trabalhando, aoFechar, aoLimparConversa }: PropsDaConfiguracao) {
  const { acoes } = useCanvas();
  const [configuracao, setConfiguracao] = useState(orquestrador.configuracao);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

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

  return (
    <div className="custom-scrollbar flex max-h-[70%] flex-col gap-4 overflow-y-auto border-b border-border bg-surface-2 px-4 py-3 nodrag nowheel">
      <span className="rotulo-tecnico">configuração · vale a partir do próximo pedido</span>
      <CamposDaConfiguracao
        valor={configuracao}
        aoMudar={setConfiguracao}
        pastaDeTrabalho={orquestrador.pastaDeTrabalho}
      />
      {erro !== null && <div className="alert alert-error">{erro}</div>}
      <div className="flex justify-between gap-2">
        <div className="flex gap-2">
          <button
            type="button"
            className="btn btn-sm btn-danger"
            onClick={() => void excluir()}
            disabled={trabalhando}
            title={trabalhando ? "Cancele o pedido em andamento antes de excluir." : undefined}
          >
            Excluir orquestrador
          </button>
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
        </div>
        <div className="flex gap-2">
          <button type="button" className="btn btn-sm btn-ghost" onClick={aoFechar}>
            Voltar
          </button>
          <button type="button" className="btn btn-sm btn-cta" onClick={() => void salvar()} disabled={salvando}>
            {salvando ? "Salvando…" : "Salvar"}
          </button>
        </div>
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
    permitirTrabalhoDireto,
    proporPlanoEmPedidosGrandes,
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
      permitirTrabalhoDireto,
      proporPlanoEmPedidosGrandes,
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
      permitirTrabalhoDireto,
      proporPlanoEmPedidosGrandes,
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
      <JanelaDoTerminal orquestrador={orquestrador} />
    </>
  );
}

/**
 * A janela do terminal: barra de título, transcrição e prompt. Só re-renderiza
 * com novidades do canvas, nunca no arraste; e a transcrição e o prompt,
 * memorizados e com props estáveis, só quando o que eles mostram muda.
 */
const JanelaDoTerminal = memo(function JanelaDoTerminal({ orquestrador }: { orquestrador: ResumoDoOrquestrador }) {
  const { conversas, conexoes, sinais, servidor, acoes } = useCanvas();
  const orquestradorId = orquestrador.id;
  const conversa = conversas.get(orquestradorId) ?? ESTADO_INICIAL;
  const [erro, setErro] = useState<string | null>(null);
  const [configurando, setConfigurando] = useState(false);
  const [cancelamentoPedido, setCancelamentoPedido] = useState(false);
  const [imagens, setImagens] = useState<ImagemAnexada[]>([]);
  const [arrastandoImagens, setArrastandoImagens] = useState(false);
  // Modo do próximo pedido; "planejamento" é o Plan Mode (Shift+Tab no prompt).
  const [modo, setModo] = useState<ModoDoTurno>("execucao");
  const memoriaDoProcesso = servidor.memoria?.porOrquestrador[orquestradorId] ?? 0;
  const configuracao = useConfiguracaoEstavel(orquestrador.configuracao);
  const rolagem = useRef<HTMLDivElement>(null);
  const campoDoPrompt = useRef<HTMLTextAreaElement>(null);
  const acompanhando = useRef(true);

  const trabalhando = conversa.turnos.at(-1)?.situacao === "em_andamento";
  const cancelando = cancelamentoPedido && trabalhando;

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

  /** O ajuste vai como um novo pedido de planejamento, escrito no prompt. */
  const ajustarPlano = useCallback((): void => {
    setModo("planejamento");
    campoDoPrompt.current?.focus();
  }, []);

  /** "abrir prévia" na faixa dos servidores: a prévia nasce ligada a este terminal. */
  const { abrirPrevia } = acoes;
  const aoAbrirPrevia = useCallback((url: string) => abrirPrevia(orquestradorId, url), [abrirPrevia, orquestradorId]);

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

  const acoesDoPlano = useMemo<AcoesDoPlano>(
    () => ({ aoAprovar: aprovarPlano, aoAjustar: ajustarPlano, aoDescartar: descartarPlano }),
    [aprovarPlano, ajustarPlano, descartarPlano],
  );

  return (
    <div
      className={`janela-terminal ${trabalhando ? "janela-terminal-ativa" : ""} ${modo === "planejamento" ? "janela-terminal-planejando" : ""}`}
      onDragOver={(evento) => {
        if (evento.dataTransfer.types.includes("Files")) {
          evento.preventDefault();
          setArrastandoImagens(true);
        }
      }}
      onDragLeave={(evento) => {
        if (!evento.currentTarget.contains(evento.relatedTarget as Node | null)) {
          setArrastandoImagens(false);
        }
      }}
      onDrop={(evento) => {
        if (evento.dataTransfer.files.length > 0) {
          evento.preventDefault();
          setArrastandoImagens(false);
          void anexar([...evento.dataTransfer.files]);
        }
      }}
    >
      {arrastandoImagens && <div className="soltar-imagens">solte para anexar as imagens a este orquestrador</div>}
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
        <button
          type="button"
          className="botao-icone nodrag"
          title="Configurar"
          aria-pressed={configurando}
          aria-label="Configurar"
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

      {configurando && (
        <PainelDeConfiguracao
          orquestrador={orquestrador}
          trabalhando={trabalhando}
          aoFechar={() => setConfigurando(false)}
          aoLimparConversa={iniciarConversaNova}
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
          turnos={conversa.turnos}
          conversaIniciadaEm={conversa.conversaIniciadaEm}
          sinal={sinais.get(orquestradorId)}
          desconectado={!servidor.conectado}
          acoesDoPlano={acoesDoPlano}
        />
        {erro !== null && <p className="mono texto-longo mt-3 text-error">✗ {erro}</p>}
      </div>

      <FaixaDeServidores enderecos={conversa.enderecosLocais} aoAbrir={aoAbrirPrevia} />
      <PromptDoTerminal
        desconectado={!servidor.conectado}
        trabalhando={trabalhando}
        cancelando={cancelando}
        modo={modo}
        aoAlternarModo={aoAlternarModo}
        campo={campoDoPrompt}
        imagens={imagens}
        aoAnexar={aoAnexar}
        aoRemoverImagem={aoRemoverImagem}
        aoEnviar={enviar}
        aoLimparConversa={limparConversa}
        aoCancelar={aoCancelar}
      />
      {trabalhando && servidor.conectado && <div className="faixa-de-progresso" />}
    </div>
  );
});
