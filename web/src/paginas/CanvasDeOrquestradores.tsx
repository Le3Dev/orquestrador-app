import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
  type EdgeTypes,
  type FitViewOptions,
  type NodeTypes,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { IconeOrquestrador } from "../componentes/Icones";
import { ArestaDoBixinho } from "../componentes/canvas/ArestaDoBixinho";
import { NoBixinho } from "../componentes/canvas/NoBixinho";
import { NoNota } from "../componentes/canvas/NoNota";
import { NoRascunho } from "../componentes/canvas/NoRascunho";
import { NoTerminal } from "../componentes/canvas/NoTerminal";
import {
  AvisoDeConexao,
  BarraDoCanvas,
  Doca,
  ErroDoCanvas,
  StatusDoCanvas,
} from "../componentes/canvas/PaineisDoCanvas";
import type { ResumoDoOrquestrador } from "../shared/api/tipos";
import { type AcoesDoCanvas, ProvedorDoCanvas, servidorParaOsNos, type ValorDoCanvas } from "../shared/canvas/contexto";
import {
  type JanelaParaOrganizar,
  lerBixinhosLimpos,
  lerLayout,
  organizarComNotas,
  posicaoParaNovoTerminal,
  salvarBixinhosLimpos,
  TAMANHO_DA_NOTA,
  TAMANHO_DO_RASCUNHO,
  TAMANHO_DO_TERMINAL,
  type Viewport,
} from "../shared/canvas/layout";
import {
  ALCA_DO_TERMINAL,
  type ArestaDoCanvas,
  arestasDosBixinhos,
  ehBixinho,
  ehNota,
  ehTerminal,
  limparBixinhos,
  mesmasLigacoes,
  type NoDoCanvas,
  type NoRascunho as TipoDoRascunho,
  nosDoLayout,
  novoTerminal,
  reaproveitarArestas,
  semTerminal,
  sincronizarBixinhos,
  subagentesVisiveis,
} from "../shared/canvas/nos";
import { ProvedorDasNotas } from "../shared/canvas/notas";
import { useConversas } from "../shared/hooks/useConversas";
import { useMovimentoDoCanvas } from "../shared/hooks/useMovimentoDoCanvas";
import { useNotas } from "../shared/hooks/useNotas";
import { useOrquestradores } from "../shared/hooks/useOrquestradores";
import { useReaproveitado } from "../shared/hooks/useReaproveitado";
import { useServidor } from "../shared/hooks/useServidor";

// Tudo o que vai ao <ReactFlow> é constante ou estável: uma prop nova a cada
// renderização (e o canvas renderiza a cada quadro do arraste) faz o React
// Flow atualizar o estado interno e re-renderizar por dentro.
const TIPOS_DE_NO = { terminal: NoTerminal, rascunho: NoRascunho, bixinho: NoBixinho, nota: NoNota } satisfies NodeTypes;
const TIPOS_DE_ARESTA = { bixinho: ArestaDoBixinho } satisfies EdgeTypes;
const ENQUADRAMENTO_AO_ABRIR: FitViewOptions<NoDoCanvas> = { maxZoom: 1, padding: 0.15 };
const VIEWPORT_PADRAO: Viewport = { x: 0, y: 0, zoom: 1 };

function classeNoMinimapa(no: { type?: string }): string {
  return no.type === "bixinho" ? "minimapa-bixinho" : no.type === "nota" ? "minimapa-nota" : "minimapa-terminal";
}

/** O tamanho de uma janela do canvas para organizar: o do nó, o medido ou o padrão. */
function tamanhoParaOrganizar(no: NoDoCanvas, padrao: { largura: number; altura: number }): JanelaParaOrganizar {
  return {
    id: no.id,
    largura: no.width ?? no.measured?.width ?? padrao.largura,
    altura: no.height ?? no.measured?.height ?? padrao.altura,
  };
}

/** O mesmo array enquanto os ids e a ordem não mudam. */
function mesmosIds(anteriores: string[], novos: string[]): string[] {
  return anteriores.length === novos.length && anteriores.every((id, indice) => id === novos[indice]) ? anteriores : novos;
}

/** Atraso para o React Flow medir um nó recém-criado antes de enquadrá-lo. */
const ESPERA_PARA_MEDIR_MS = 80;

function CanvasVazio({ aoCriar }: { aoCriar: () => void }) {
  return (
    <div className="pointer-events-none absolute inset-0 grid place-items-center">
      <div className="painel-flutuante pointer-events-auto flex max-w-md flex-col items-center gap-4 px-8 py-7 text-center">
        <div className="no-orquestrador-icone h-12 w-12">
          <IconeOrquestrador tamanho={26} />
        </div>
        <div className="flex flex-col gap-1.5">
          <h2 className="text-[17px]">Seu canvas de agentes</h2>
          <p className="text-secondary">
            Cada orquestrador é um terminal: você conversa com ele, e cada subagente que ele instancia aparece como um
            bixinho ligado ao terminal. Arraste pela barra de título, redimensione pelas bordas e espalhe quantos quiser.
          </p>
        </div>
        <p className="mono text-muted">arrastar o fundo move o canvas · ctrl + roda do mouse dá zoom</p>
        <button type="button" className="btn btn-cta" onClick={aoCriar}>
          + Novo orquestrador
        </button>
      </div>
    </div>
  );
}

function Canvas() {
  const { orquestradores, erro, recarregar } = useOrquestradores();
  const [layoutInicial] = useState(lerLayout);
  // Enquadra só ao abrir com terminais (ou notas) salvos e sem posição de
  // câmera salva. Com o canvas vazio, o React Flow enquadraria o primeiro
  // terminal criado depois, com zoom exagerado.
  const [enquadrarAoAbrir] = useState(
    () =>
      layoutInicial.viewport === null &&
      Object.keys(layoutInicial.terminais).length + Object.keys(layoutInicial.notas).length > 0,
  );
  const [nosIniciais] = useState(() => nosDoLayout(layoutInicial));
  const [nos, setNos, aoMudarNos] = useNodesState<NoDoCanvas>(nosIniciais);
  const [bixinhosLimpos, setBixinhosLimpos] = useState(lerBixinhosLimpos);
  const fluxo = useReactFlow<NoDoCanvas>();
  // Grava o layout (só depois de soltar um arraste) e marca quando algo se move.
  const movimento = useMovimentoDoCanvas(nos, layoutInicial.viewport);
  // Criados nesta sessão e ainda ausentes da lista: uma consulta que saiu
  // antes da criação não pode tirá-los do canvas ao voltar.
  const criadosAgora = useRef(new Set<string>());

  const servidor = useServidor();
  // O mesmo array enquanto os terminais abertos não mudam: arrastar não o troca.
  const idsNoCanvas = useReaproveitado(
    nos.filter(ehTerminal).map((no) => no.data.orquestradorId),
    mesmosIds,
  );
  const noCanvas = useMemo(() => new Set(idsNoCanvas), [idsNoCanvas]);
  const { conversas, conexoes, sinais } = useConversas(idsNoCanvas, servidor.conectado);
  // Limpar lê as conversas por aqui, para as ações do canvas não mudarem a cada evento.
  const conversasAtuais = useRef(conversas);

  useEffect(() => {
    conversasAtuais.current = conversas;
  }, [conversas]);

  // A aba do navegador também avisa: o canvas pode estar atrás de outra janela.
  useEffect(() => {
    const titulo = "Orquestrador de Agentes";
    document.title = servidor.conectado ? titulo : `⚠ Desconectado · ${titulo}`;
  }, [servidor.conectado]);
  const porId = useMemo(
    () => new Map((orquestradores ?? []).map((orquestrador) => [orquestrador.id, orquestrador])),
    [orquestradores],
  );

  // Terminais de orquestradores excluídos (por outra aba, por exemplo) saem do canvas.
  useEffect(() => {
    if (orquestradores === null) {
      return;
    }
    const existentes = new Set(orquestradores.map((orquestrador) => orquestrador.id));
    for (const id of criadosAgora.current) {
      if (existentes.has(id)) {
        criadosAgora.current.delete(id);
      }
    }
    setNos((atuais) => {
      const orfaos = atuais
        .filter(ehTerminal)
        .filter((terminal) => !existentes.has(terminal.id) && !criadosAgora.current.has(terminal.id));
      return orfaos.length === 0 ? atuais : orfaos.reduce((restantes, terminal) => semTerminal(restantes, terminal.id), atuais);
    });
    // A limpeza de um orquestrador excluído não serve mais: sai do armazenamento.
    setBixinhosLimpos((atuais) => {
      const restantes = [...atuais].filter(([id]) => existentes.has(id) || criadosAgora.current.has(id));
      return restantes.length === atuais.size ? atuais : new Map(restantes);
    });
  }, [orquestradores, setNos]);

  // Bixinhos nascem e somem conforme os Subagentes de cada conversa e o que o usuário limpou.
  useEffect(() => {
    setNos((atuais) => sincronizarBixinhos(atuais, conversas, bixinhosLimpos));
  }, [conversas, bixinhosLimpos, setNos]);

  useEffect(() => {
    salvarBixinhosLimpos(bixinhosLimpos);
  }, [bixinhosLimpos]);

  // As linhas só são recalculadas quando um bixinho nasce, some ou muda de
  // terminal, ou quando chega um evento; e o React Flow só recebe um array
  // novo quando alguma linha mudou de fato. Arrastar não muda nenhuma.
  const bixinhos = useReaproveitado(nos.filter(ehBixinho), mesmasLigacoes);
  const arestasCalculadas = useMemo(() => arestasDosBixinhos(bixinhos, conversas), [bixinhos, conversas]);
  const arestas = useReaproveitado(arestasCalculadas, reaproveitarArestas);

  const centroDaTela = useCallback(
    () => fluxo.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 }),
    [fluxo],
  );

  // O conteúdo das notas fica numa loja própria: digitar ou salvar uma nota não re-renderiza o canvas.
  const notas = useNotas(setNos, centroDaTela, servidor.conectado);
  const { criarNota, erro: erroDasNotas, descartarErro: descartarErroDasNotas } = notas;
  const novaNota = useCallback(() => void criarNota(), [criarNota]);

  const focar = useCallback(
    (id: string) => {
      setTimeout(() => void fluxo.fitView({ nodes: [{ id }], duration: 500, padding: 0.3, maxZoom: 1 }), ESPERA_PARA_MEDIR_MS);
    },
    [fluxo],
  );

  const novoOrquestrador = useCallback(() => {
    const id = `rascunho:${crypto.randomUUID()}`;
    setNos((atuais) => {
      const posicao = posicaoParaNovoTerminal(
        centroDaTela(),
        TAMANHO_DO_RASCUNHO,
        atuais.filter((no) => !ehBixinho(no)).map((no) => no.position),
      );
      const rascunho: TipoDoRascunho = {
        id,
        type: "rascunho",
        position: posicao,
        width: TAMANHO_DO_RASCUNHO.largura,
        height: TAMANHO_DO_RASCUNHO.altura,
        dragHandle: `.${ALCA_DO_TERMINAL}`,
        data: {},
        selected: true,
      };
      return [...atuais.map((no) => ({ ...no, selected: false })), rascunho];
    });
  }, [centroDaTela, setNos]);

  const abrirTerminal = useCallback(
    (orquestradorId: string) => {
      setNos((atuais) => {
        if (atuais.some((no) => no.id === orquestradorId)) {
          return atuais;
        }
        const posicao = posicaoParaNovoTerminal(
          centroDaTela(),
          TAMANHO_DO_TERMINAL,
          atuais.filter(ehTerminal).map((no) => no.position),
        );
        return [...atuais, novoTerminal(orquestradorId, posicao, TAMANHO_DO_TERMINAL.largura, TAMANHO_DO_TERMINAL.altura)];
      });
      focar(orquestradorId);
    },
    [centroDaTela, focar, setNos],
  );

  const fecharTerminal = useCallback(
    (orquestradorId: string) => setNos((atuais) => semTerminal(atuais, orquestradorId)),
    [setNos],
  );

  const limparBixinhosDoTerminal = useCallback(
    (orquestradorId: string) =>
      setBixinhosLimpos((atuais) => {
        const limpos = limparBixinhos(conversasAtuais.current.get(orquestradorId), atuais.get(orquestradorId));
        return limpos === null ? atuais : new Map(atuais).set(orquestradorId, limpos);
      }),
    [],
  );

  const orquestradorCriado = useCallback(
    (rascunhoId: string, orquestrador: ResumoDoOrquestrador) => {
      criadosAgora.current.add(orquestrador.id);
      setNos((atuais) => {
        const rascunho = atuais.find((no) => no.id === rascunhoId);
        const terminal = novoTerminal(
          orquestrador.id,
          rascunho?.position ?? centroDaTela(),
          rascunho?.width ?? TAMANHO_DO_TERMINAL.largura,
          TAMANHO_DO_TERMINAL.altura,
        );
        return [...atuais.filter((no) => no.id !== rascunhoId), { ...terminal, selected: true }];
      });
      void recarregar();
    },
    [centroDaTela, recarregar, setNos],
  );

  const descartarRascunho = useCallback(
    (rascunhoId: string) => setNos((atuais) => atuais.filter((no) => no.id !== rascunhoId)),
    [setNos],
  );

  const organizar = useCallback(() => {
    setNos((atuais) => {
      const janelas = atuais
        .filter((no) => !ehBixinho(no) && !ehNota(no))
        .map((no) => tamanhoParaOrganizar(no, TAMANHO_DO_TERMINAL));
      const notasNoCanvas = atuais.filter(ehNota).map((no) => tamanhoParaOrganizar(no, TAMANHO_DA_NOTA));
      const posicoes = organizarComNotas(janelas, notasNoCanvas);
      return atuais.map((no) => {
        const posicao = posicoes[no.id];
        return posicao === undefined ? no : { ...no, position: posicao };
      });
    });
    setTimeout(() => void fluxo.fitView({ duration: 600, padding: 0.12 }), ESPERA_PARA_MEDIR_MS);
  }, [fluxo, setNos]);

  const acoes = useMemo<AcoesDoCanvas>(
    () => ({
      abrirTerminal,
      fecharTerminal,
      limparBixinhos: limparBixinhosDoTerminal,
      orquestradorCriado,
      descartarRascunho,
      recarregar,
    }),
    [abrirTerminal, fecharTerminal, limparBixinhosDoTerminal, orquestradorCriado, descartarRascunho, recarregar],
  );
  // Os nós só leem do servidor a conexão e a memória por Orquestrador: a
  // memória livre do computador, que muda a cada leitura, não os re-renderiza.
  const servidorDosNos = useReaproveitado(servidor, servidorParaOsNos);
  // Não depende de `nos`: arrastar e mover o canvas não trocam o valor.
  const valor = useMemo<ValorDoCanvas>(
    () => ({ orquestradores: porId, conversas, conexoes, sinais, bixinhosLimpos, servidor: servidorDosNos, acoes }),
    [porId, conversas, conexoes, sinais, bixinhosLimpos, servidorDosNos, acoes],
  );

  const trabalhando = useMemo(
    () => (orquestradores ?? []).filter((orquestrador) => orquestrador.situacao === "trabalhando").length,
    [orquestradores],
  );
  const bixinhosAtivos = useMemo(
    () =>
      [...conversas.values()].reduce(
        (total, conversa) =>
          total + subagentesVisiveis(conversa).filter((subagente) => subagente.situacao === "executando").length,
        0,
      ),
    [conversas],
  );
  const cota = useMemo(
    () => [...conversas.values()].find((conversa) => conversa.cota !== null)?.cota ?? null,
    [conversas],
  );
  const quantidadeDeJanelas = nos.filter((no) => !ehBixinho(no)).length;
  const podeOrganizar = quantidadeDeJanelas > 1;

  // Os painéis não dependem da posição dos nós: memorizados, não re-renderizam
  // a cada quadro do arraste.
  const painelDaEsquerda = useMemo(
    () => (
      <Panel position="top-left">
        <BarraDoCanvas
          aoCriar={novoOrquestrador}
          aoCriarNota={novaNota}
          aoOrganizar={organizar}
          podeOrganizar={podeOrganizar}
        />
        {erroDasNotas !== null && <ErroDoCanvas erro={erroDasNotas} aoFechar={descartarErroDasNotas} />}
        <Doca orquestradores={orquestradores} noCanvas={noCanvas} erro={erro} aoAbrir={abrirTerminal} />
      </Panel>
    ),
    [
      novoOrquestrador,
      novaNota,
      organizar,
      podeOrganizar,
      erroDasNotas,
      descartarErroDasNotas,
      orquestradores,
      noCanvas,
      erro,
      abrirTerminal,
    ],
  );
  const painelDoCentro = useMemo(
    () => (
      <Panel position="top-center">
        <AvisoDeConexao servidor={servidor} />
      </Panel>
    ),
    [servidor],
  );
  const painelDaDireita = useMemo(
    () => (
      <Panel position="top-right">
        <StatusDoCanvas
          trabalhando={trabalhando}
          bixinhosAtivos={bixinhosAtivos}
          cota={cota}
          memoria={servidor.memoria}
        />
      </Panel>
    ),
    [trabalhando, bixinhosAtivos, cota, servidor.memoria],
  );

  return (
    <ProvedorDoCanvas valor={valor}>
      <ProvedorDasNotas valor={notas.valor}>
        <div
          className={`relative h-screen w-screen ${servidor.conectado ? "" : "canvas-desconectado"} ${movimento.movendo ? "canvas-movendo" : ""}`}
        >
          <ReactFlow<NoDoCanvas, ArestaDoCanvas>
            nodes={nos}
            edges={arestas}
            nodeTypes={TIPOS_DE_NO}
            edgeTypes={TIPOS_DE_ARESTA}
            onNodesChange={aoMudarNos}
            onNodeDragStart={movimento.aoComecarArraste}
            onNodeDragStop={movimento.aoTerminarArraste}
            onMoveStart={movimento.aoComecarMovimento}
            onMoveEnd={movimento.aoTerminarMovimento}
            colorMode="dark"
            defaultViewport={layoutInicial.viewport ?? VIEWPORT_PADRAO}
            fitView={enquadrarAoAbrir}
            fitViewOptions={ENQUADRAMENTO_AO_ABRIR}
            minZoom={0.1}
            maxZoom={2}
            // Como no Excalidraw: a roda do mouse rola o canvas; com Ctrl, dá zoom.
            panOnScroll
            zoomActivationKeyCode="Control"
            deleteKeyCode={null}
          >
            <Background variant={BackgroundVariant.Dots} gap={24} size={1.4} />
            <Controls position="bottom-left" showInteractive={false} />
            <MiniMap position="bottom-right" pannable zoomable nodeClassName={classeNoMinimapa} />
            {painelDaEsquerda}
            {painelDoCentro}
            {painelDaDireita}
          </ReactFlow>
          {quantidadeDeJanelas === 0 && <CanvasVazio aoCriar={novoOrquestrador} />}
        </div>
      </ProvedorDasNotas>
    </ProvedorDoCanvas>
  );
}

/** A tela inteira: um canvas infinito com os terminais dos Orquestradores e seus bixinhos. */
export function CanvasDeOrquestradores() {
  return (
    <ReactFlowProvider>
      <Canvas />
    </ReactFlowProvider>
  );
}
