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
  type NodeTypes,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { IconeOrquestrador } from "../componentes/Icones";
import { NoBixinho } from "../componentes/canvas/NoBixinho";
import { NoRascunho } from "../componentes/canvas/NoRascunho";
import { NoTerminal } from "../componentes/canvas/NoTerminal";
import { AvisoDeConexao, BarraDoCanvas, Doca, StatusDoCanvas } from "../componentes/canvas/PaineisDoCanvas";
import type { ResumoDoOrquestrador } from "../shared/api/tipos";
import { type AcoesDoCanvas, ContextoDoCanvas, type ValorDoCanvas } from "../shared/canvas/contexto";
import {
  lerLayout,
  organizarEmGrade,
  posicaoParaNovoTerminal,
  salvarLayout,
  TAMANHO_DO_RASCUNHO,
  TAMANHO_DO_TERMINAL,
  type Viewport,
} from "../shared/canvas/layout";
import {
  ALCA_DO_TERMINAL,
  arestasDosBixinhos,
  ehBixinho,
  ehTerminal,
  layoutDosNos,
  type NoDoCanvas,
  type NoRascunho as TipoDoRascunho,
  nosDoLayout,
  novoTerminal,
  semTerminal,
  sincronizarBixinhos,
  subagentesVisiveis,
} from "../shared/canvas/nos";
import { useConversas } from "../shared/hooks/useConversas";
import { useOrquestradores } from "../shared/hooks/useOrquestradores";
import { useServidor } from "../shared/hooks/useServidor";

const TIPOS_DE_NO = { terminal: NoTerminal, rascunho: NoRascunho, bixinho: NoBixinho } satisfies NodeTypes;

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
  // Enquadra só ao abrir com terminais salvos e sem posição de câmera salva.
  // Com o canvas vazio, o React Flow enquadraria o primeiro terminal criado
  // depois, com zoom exagerado.
  const [enquadrarAoAbrir] = useState(
    () => layoutInicial.viewport === null && Object.keys(layoutInicial.terminais).length > 0,
  );
  const [nos, setNos, aoMudarNos] = useNodesState<NoDoCanvas>(nosDoLayout(layoutInicial));
  const fluxo = useReactFlow<NoDoCanvas>();
  const viewport = useRef<Viewport | null>(layoutInicial.viewport);
  // Criados nesta sessão e ainda ausentes da lista: uma consulta que saiu
  // antes da criação não pode tirá-los do canvas ao voltar.
  const criadosAgora = useRef(new Set<string>());

  const servidor = useServidor();
  const idsNoCanvas = nos.filter(ehTerminal).map((no) => no.data.orquestradorId);
  const { conversas, conexoes, sinais } = useConversas(idsNoCanvas, servidor.conectado);

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
  }, [orquestradores, setNos]);

  // Bixinhos nascem e somem conforme os Subagentes de cada conversa.
  useEffect(() => {
    setNos((atuais) => sincronizarBixinhos(atuais, conversas));
  }, [conversas, setNos]);

  useEffect(() => {
    const espera = setTimeout(() => salvarLayout(layoutDosNos(nos, viewport.current)), 300);
    return () => clearTimeout(espera);
  }, [nos]);

  const arestas = useMemo(() => arestasDosBixinhos(nos, conversas), [nos, conversas]);

  const centroDaTela = useCallback(
    () => fluxo.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 }),
    [fluxo],
  );

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
        .filter((no) => !ehBixinho(no))
        .map((no) => ({
          id: no.id,
          largura: no.width ?? no.measured?.width ?? TAMANHO_DO_TERMINAL.largura,
          altura: no.height ?? no.measured?.height ?? TAMANHO_DO_TERMINAL.altura,
        }));
      const posicoes = organizarEmGrade(janelas);
      return atuais.map((no) => {
        const posicao = posicoes[no.id];
        return posicao === undefined ? no : { ...no, position: posicao };
      });
    });
    setTimeout(() => void fluxo.fitView({ duration: 600, padding: 0.12 }), ESPERA_PARA_MEDIR_MS);
  }, [fluxo, setNos]);

  const acoes = useMemo<AcoesDoCanvas>(
    () => ({ abrirTerminal, fecharTerminal, orquestradorCriado, descartarRascunho, recarregar }),
    [abrirTerminal, fecharTerminal, orquestradorCriado, descartarRascunho, recarregar],
  );
  const valor = useMemo<ValorDoCanvas>(
    () => ({ orquestradores: porId, conversas, conexoes, sinais, servidor, acoes }),
    [porId, conversas, conexoes, sinais, servidor, acoes],
  );

  const trabalhando = (orquestradores ?? []).filter((orquestrador) => orquestrador.situacao === "trabalhando").length;
  const bixinhosAtivos = [...conversas.values()].reduce(
    (total, conversa) =>
      total + subagentesVisiveis(conversa).filter((subagente) => subagente.situacao === "executando").length,
    0,
  );
  const cota = [...conversas.values()].find((conversa) => conversa.cota !== null)?.cota ?? null;
  const janelas = nos.filter((no) => !ehBixinho(no));

  return (
    <ContextoDoCanvas.Provider value={valor}>
      <div className={`relative h-screen w-screen ${servidor.conectado ? "" : "canvas-desconectado"}`}>
        <ReactFlow<NoDoCanvas>
          nodes={nos}
          edges={arestas}
          nodeTypes={TIPOS_DE_NO}
          onNodesChange={aoMudarNos}
          onMoveEnd={(_evento, novo) => {
            viewport.current = novo;
            salvarLayout(layoutDosNos(nos, novo));
          }}
          colorMode="dark"
          defaultViewport={layoutInicial.viewport ?? { x: 0, y: 0, zoom: 1 }}
          fitView={enquadrarAoAbrir}
          fitViewOptions={{ maxZoom: 1, padding: 0.15 }}
          minZoom={0.1}
          maxZoom={2}
          // Como no Excalidraw: a roda do mouse rola o canvas; com Ctrl, dá zoom.
          panOnScroll
          zoomActivationKeyCode="Control"
          deleteKeyCode={null}
        >
          <Background variant={BackgroundVariant.Dots} gap={24} size={1.4} />
          <Controls position="bottom-left" showInteractive={false} />
          <MiniMap
            position="bottom-right"
            pannable
            zoomable
            nodeClassName={(no) => (no.type === "bixinho" ? "minimapa-bixinho" : "minimapa-terminal")}
          />
          <Panel position="top-left">
            <BarraDoCanvas aoCriar={novoOrquestrador} aoOrganizar={organizar} podeOrganizar={janelas.length > 1} />
            <Doca
              orquestradores={orquestradores}
              noCanvas={new Set(idsNoCanvas)}
              erro={erro}
              aoAbrir={abrirTerminal}
            />
          </Panel>
          <Panel position="top-center">
            <AvisoDeConexao servidor={servidor} />
          </Panel>
          <Panel position="top-right">
            <StatusDoCanvas
              trabalhando={trabalhando}
              bixinhosAtivos={bixinhosAtivos}
              cota={cota}
              memoria={servidor.memoria}
            />
          </Panel>
        </ReactFlow>
        {janelas.length === 0 && <CanvasVazio aoCriar={novoOrquestrador} />}
      </div>
    </ContextoDoCanvas.Provider>
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
