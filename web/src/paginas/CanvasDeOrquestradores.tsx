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
  type NodeChange,
  type NodeTypes,
} from "@xyflow/react";
import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { IconeOrquestrador } from "../componentes/Icones";
import { ChatRapido } from "../componentes/chat/ChatRapido";
import { ArestaDoBixinho } from "../componentes/canvas/ArestaDoBixinho";
import { NoBixinho } from "../componentes/canvas/NoBixinho";
import { NoNota } from "../componentes/canvas/NoNota";
import { NoRascunho } from "../componentes/canvas/NoRascunho";
import { NoTerminal } from "../componentes/canvas/NoTerminal";
import { BarraDeTituloDoApp } from "../componentes/canvas/BarraDeTituloDoApp";
import { type ControleDaPaleta, PaletaDeComandos } from "../componentes/canvas/PaletaDeComandos";
import { rodandoNoDesktop } from "../shared/ponteDoDesktop";
import {
  AvisoDeConexao,
  AvisoDeMemoria,
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
import { AVISO_DO_LIMITE_DE_ORQUESTRADORES, cabeOutroTerminal } from "../shared/canvas/limiteDeTerminais";
import {
  ALCA_DO_TERMINAL,
  type ArestaDoCanvas,
  arestasDosBixinhos,
  ehBixinho,
  ehNota,
  ehTerminal,
  idDoNoDaNota,
  limparBixinhos,
  mesmasLigacoes,
  type NoDoCanvas,
  type NoRascunho as TipoDoRascunho,
  nosDoLayout,
  novoTerminal,
  reacomodarBixinhos,
  reaproveitarArestas,
  semTerminal,
  sincronizarBixinhos,
  subagentesVisiveis,
} from "../shared/canvas/nos";
import { ProvedorDasNotas } from "../shared/canvas/notas";
import { useChat } from "../shared/hooks/useChat";
import { useConversas } from "../shared/hooks/useConversas";
import { useMovimentoDoCanvas } from "../shared/hooks/useMovimentoDoCanvas";
import { useNotas } from "../shared/hooks/useNotas";
import { useOrquestradores } from "../shared/hooks/useOrquestradores";
import { useReaproveitado } from "../shared/hooks/useReaproveitado";
import { useServidor } from "../shared/hooks/useServidor";
import type { AcaoDaPaleta, FonteDaPaleta, ItemDaPaleta } from "../shared/paletaDeComandos";

// Tudo o que vai ao <ReactFlow> é constante ou estável: uma prop nova a cada
// renderização (e o canvas renderiza a cada quadro do arraste) faz o React
// Flow atualizar o estado interno e re-renderizar por dentro.
const TIPOS_DE_NO = { terminal: NoTerminal, rascunho: NoRascunho, bixinho: NoBixinho, nota: NoNota } satisfies NodeTypes;
const TIPOS_DE_ARESTA = { bixinho: ArestaDoBixinho } satisfies EdgeTypes;
// Nunca acima de 100%: o texto dos terminais só fica nítido em zoom inteiro
// (100%), e enquadrar não deve ampliar além disso.
const ENQUADRAMENTO_AO_ABRIR: FitViewOptions<NoDoCanvas> = { maxZoom: 1, padding: 0.15 };
const VIEWPORT_PADRAO: Viewport = { x: 0, y: 0, zoom: 1 };

/** Foco num campo de texto: o atalho é do campo, não do canvas. */
function focoEmCampoDeTexto(alvo: EventTarget | null): boolean {
  return (
    alvo instanceof HTMLElement &&
    (alvo.isContentEditable || alvo.tagName === "INPUT" || alvo.tagName === "TEXTAREA" || alvo.tagName === "SELECT")
  );
}

/**
 * O viewport em 100% mantendo no lugar o ponto do centro da área do canvas; a
 * posição arredondada também evita texto borrado (meio pixel).
 */
function viewportEmCemPorCento(atual: Viewport, largura: number, altura: number): Viewport {
  const centroX = largura / 2;
  const centroY = altura / 2;
  const escala = 1 / atual.zoom;
  return {
    x: Math.round(centroX - (centroX - atual.x) * escala),
    y: Math.round(centroY - (centroY - atual.y) * escala),
    zoom: 1,
  };
}

/** A classe de cada nó no minimapa; o terminal de um Orquestrador trabalhando também brilha. */
function classeNoMinimapa(no: NoDoCanvas, trabalhando: ReadonlySet<string>): string {
  if (ehBixinho(no)) {
    return "minimapa-bixinho";
  }
  if (ehNota(no)) {
    return "minimapa-nota";
  }
  return ehTerminal(no) && trabalhando.has(no.data.orquestradorId)
    ? "minimapa-terminal minimapa-terminal-trabalhando"
    : "minimapa-terminal";
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

/**
 * O valor que mudou por último entre dois (nulo não conta como leitura). Ao
 * começar, vale o primeiro não nulo.
 */
function useMaisRecente<Valor>(a: Valor | null, b: Valor | null): Valor | null {
  const [registro, setRegistro] = useState({ a, b, atual: b ?? a });
  if (registro.a !== a || registro.b !== b) {
    // Ajuste durante o render (padrão do React para estado derivado de props).
    const atual = registro.b !== b && b !== null ? b : registro.a !== a && a !== null ? a : registro.atual;
    setRegistro({ a, b, atual });
    return atual;
  }
  return registro.atual;
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
  // Dentro do app desktop, a barra de título é da tela (com o status).
  const [desktop] = useState(rodandoNoDesktop);
  const areaDoCanvas = useRef<HTMLDivElement>(null);
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
  const { aoTerminarArraste } = movimento;

  // Bixinhos que ficaram por cima de outra janela se reacomodam ao soltar um
  // arraste, ao terminar de redimensionar, ao abrir uma janela e ao organizar
  // — nunca a cada quadro do arraste. Sem conflito, o array não muda.
  const reacomodar = useCallback(() => setNos(reacomodarBixinhos), [setNos]);

  // O React Flow aplica a posição final do arraste antes de avisar o fim dele.
  const aoSoltarNo = useCallback(() => {
    aoTerminarArraste();
    reacomodar();
  }, [aoTerminarArraste, reacomodar]);

  const aoMudarNosEReacomodar = useCallback(
    (mudancas: NodeChange<NoDoCanvas>[]) => {
      aoMudarNos(mudancas);
      // Fim de um redimensionamento (o React Flow manda `resizing: false` só ao soltar a alça).
      if (mudancas.some((mudanca) => mudanca.type === "dimensions" && mudanca.resizing === false)) {
        reacomodar();
      }
    },
    [aoMudarNos, reacomodar],
  );

  // As notas criadas, restauradas ou trazidas do servidor também tiram os
  // bixinhos de baixo delas. Digitar numa nota não passa por aqui.
  const setNosDasNotas = useCallback<Dispatch<SetStateAction<NoDoCanvas[]>>>(
    (atualizacao) =>
      setNos((atuais) => reacomodarBixinhos(typeof atualizacao === "function" ? atualizacao(atuais) : atualizacao)),
    [setNos],
  );
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
  const chatAoVivo = useChat(servidor.conectado);
  const { chat } = chatAoVivo;
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
  // A paleta lê a lista por aqui, só ao abrir: as ações dela não mudam a cada consulta.
  const orquestradoresAtuais = useRef(orquestradores);
  useEffect(() => {
    orquestradoresAtuais.current = orquestradores;
  }, [orquestradores]);

  // Quem está trabalhando: o mesmo array enquanto ninguém começa nem para.
  const idsTrabalhando = useReaproveitado(
    (orquestradores ?? [])
      .filter((orquestrador) => orquestrador.situacao === "trabalhando")
      .map((orquestrador) => orquestrador.id),
    mesmosIds,
  );
  // Estável: uma função nova re-renderizaria todos os nós do minimapa (ver ADR-11).
  const classeDoMinimapa = useMemo(() => {
    const trabalhando = new Set(idsTrabalhando);
    return (no: NoDoCanvas) => classeNoMinimapa(no, trabalhando);
  }, [idsTrabalhando]);

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

  // As linhas só são recalculadas quando um bixinho nasce, some, muda de
  // terminal ou passa para outro lado dele (as pontas seguem o lado), ou
  // quando chega um evento; e o React Flow só recebe um array novo quando
  // alguma linha mudou de fato. Arrastar sem trocar de lado não muda nenhuma.
  const ligados = useReaproveitado(
    nos.filter((no) => ehTerminal(no) || ehBixinho(no)),
    mesmasLigacoes,
  );
  const arestasCalculadas = useMemo(() => arestasDosBixinhos(ligados, conversas), [ligados, conversas]);
  const arestas = useReaproveitado(arestasCalculadas, reaproveitarArestas);

  // O centro da área do canvas (no desktop, abaixo da barra de título).
  const centroDaTela = useCallback(() => {
    const area = areaDoCanvas.current?.getBoundingClientRect();
    return fluxo.screenToFlowPosition(
      area !== undefined && area.width > 0
        ? { x: area.left + area.width / 2, y: area.top + area.height / 2 }
        : { x: window.innerWidth / 2, y: window.innerHeight / 2 },
    );
  }, [fluxo]);

  // O conteúdo das notas fica numa loja própria: digitar ou salvar uma nota não re-renderiza o canvas.
  const notas = useNotas(setNosDasNotas, centroDaTela, servidor.conectado);
  const { criarNota, erro: erroDasNotas, descartarErro: descartarErroDasNotas } = notas;
  const novaNota = useCallback(() => void criarNota(), [criarNota]);

  const focar = useCallback(
    (id: string) => {
      setTimeout(() => void fluxo.fitView({ nodes: [{ id }], duration: 500, padding: 0.3, maxZoom: 1 }), ESPERA_PARA_MEDIR_MS);
    },
    [fluxo],
  );

  // Trava de terminais abertos: lê os nós por aqui, para as ações não mudarem a cada arraste.
  const nosAtuais = useRef(nos);
  useLayoutEffect(() => {
    nosAtuais.current = nos;
  }, [nos]);
  const [avisoDoLimite, setAvisoDoLimite] = useState(false);

  /** Se cabe abrir o terminal pedido (nulo: um terminal novo). Ponto único da trava. */
  const temVagaPara = useCallback((orquestradorId: string | null) => {
    const atuais = nosAtuais.current;
    return cabeOutroTerminal(
      atuais.filter(ehTerminal).map((no) => no.data.orquestradorId),
      atuais.filter((no) => no.type === "rascunho").map((no) => no.id),
      orquestradorId,
    );
  }, []);

  /** Confere a vaga e, sem ela, mostra o aviso abaixo da barra do canvas. */
  const reservarVaga = useCallback(
    (orquestradorId: string | null) => {
      const cabe = temVagaPara(orquestradorId);
      setAvisoDoLimite(!cabe);
      return cabe;
    },
    [temVagaPara],
  );

  const novoOrquestrador = useCallback(() => {
    if (!reservarVaga(null)) {
      return;
    }
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
      return reacomodarBixinhos([...atuais.map((no) => ({ ...no, selected: false })), rascunho]);
    });
  }, [centroDaTela, reservarVaga, setNos]);

  const abrirTerminal = useCallback(
    (orquestradorId: string) => {
      // Já aberto sempre cabe: só ganha o foco.
      if (!reservarVaga(orquestradorId)) {
        return;
      }
      setNos((atuais) => {
        if (atuais.some((no) => no.id === orquestradorId)) {
          return atuais;
        }
        const posicao = posicaoParaNovoTerminal(
          centroDaTela(),
          TAMANHO_DO_TERMINAL,
          atuais.filter(ehTerminal).map((no) => no.position),
        );
        return reacomodarBixinhos([
          ...atuais,
          novoTerminal(orquestradorId, posicao, TAMANHO_DO_TERMINAL.largura, TAMANHO_DO_TERMINAL.altura),
        ]);
      });
      focar(orquestradorId);
    },
    [centroDaTela, focar, reservarVaga, setNos],
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
        return reacomodarBixinhos([...atuais.filter((no) => no.id !== rascunhoId), { ...terminal, selected: true }]);
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
      return reacomodarBixinhos(
        atuais.map((no) => {
          const posicao = posicoes[no.id];
          return posicao === undefined ? no : { ...no, position: posicao };
        }),
      );
    });
    setTimeout(() => void fluxo.fitView({ duration: 600, padding: 0.12, maxZoom: 1 }), ESPERA_PARA_MEDIR_MS);
  }, [fluxo, setNos]);

  /** Zoom em 100% (texto nítido) sem sair do lugar: o Ctrl+0 e a paleta. */
  const zoomEmCemPorCento = useCallback(() => {
    const area = areaDoCanvas.current?.getBoundingClientRect();
    void fluxo.setViewport(viewportEmCemPorCento(fluxo.getViewport(), area?.width ?? 0, area?.height ?? 0));
  }, [fluxo]);

  /** Mostra tudo o que está no canvas, sem passar de 100% (ver ADR-20). */
  const enquadrarTudo = useCallback(
    () => void fluxo.fitView({ duration: 500, padding: 0.12, maxZoom: 1 }),
    [fluxo],
  );

  // Ctrl+0: volta o zoom para 100% (texto nítido) sem sair do lugar.
  useEffect(() => {
    const aoApertarTecla = (evento: KeyboardEvent) => {
      if (!evento.ctrlKey || evento.altKey || evento.shiftKey || evento.metaKey) {
        return;
      }
      if (evento.key !== "0" && evento.code !== "Digit0" && evento.code !== "Numpad0") {
        return;
      }
      if (focoEmCampoDeTexto(evento.target)) {
        return;
      }
      evento.preventDefault();
      zoomEmCemPorCento();
    };
    window.addEventListener("keydown", aoApertarTecla);
    return () => window.removeEventListener("keydown", aoApertarTecla);
  }, [zoomEmCemPorCento]);

  // Paleta de comandos (Ctrl+K): o estado é dela; o canvas só entrega o que
  // listar (lido na hora de abrir) e executa o escolhido. Tudo estável, para a
  // paleta não re-renderizar com o canvas.
  const controleDaPaleta = useRef<ControleDaPaleta>(null);
  const abrirPaleta = useCallback(() => controleDaPaleta.current?.abrir(), []);
  const lojaDasNotas = notas.valor.loja;
  const lerFonteDaPaleta = useCallback((): FonteDaPaleta => {
    const atuais = nosAtuais.current;
    return {
      podeOrganizar: atuais.filter((no) => !ehBixinho(no)).length > 1,
      orquestradores: orquestradoresAtuais.current ?? [],
      abertos: new Set(atuais.filter(ehTerminal).map((no) => no.data.orquestradorId)),
      notas: atuais.filter(ehNota).map((no) => {
        const nota = lojaDasNotas.ler(no.data.notaId);
        return { notaId: no.data.notaId, titulo: nota?.titulo ?? "", texto: nota?.texto ?? "" };
      }),
      // Só as conversas carregadas: as dos terminais abertos, sem as arquivadas (/clear).
      conversas: conversasAtuais.current,
    };
  }, [lojaDasNotas]);
  const executarItemDaPaleta = useCallback(
    (item: ItemDaPaleta) => {
      switch (item.tipo) {
        case "acao": {
          const acoesDaPaleta: Readonly<Record<AcaoDaPaleta, () => void>> = {
            "novo-orquestrador": novoOrquestrador,
            "nova-nota": novaNota,
            organizar,
            "zoom-100": zoomEmCemPorCento,
            "enquadrar-tudo": enquadrarTudo,
          };
          acoesDaPaleta[item.acao]();
          return;
        }
        case "orquestrador":
        case "pedido":
          // O ponto único de abertura: aberto, só centraliza; fechado, abre se houver vaga (ADR-18).
          abrirTerminal(item.orquestradorId);
          return;
        case "nota":
          focar(idDoNoDaNota(item.notaId));
          return;
      }
    },
    [novoOrquestrador, novaNota, organizar, zoomEmCemPorCento, enquadrarTudo, abrirTerminal, focar],
  );

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

  const trabalhando = idsTrabalhando.length;
  const bixinhosAtivos = useMemo(
    () =>
      [...conversas.values()].reduce(
        (total, conversa) =>
          total + subagentesVisiveis(conversa).filter((subagente) => subagente.situacao === "executando").length,
        0,
      ),
    [conversas],
  );
  const cotaDosTerminais = useMemo(
    () => [...conversas.values()].find((conversa) => conversa.cota !== null)?.cota ?? null,
    [conversas],
  );
  // Os medidores mostram a leitura mais recente, venha do chat ou dos terminais.
  const cota = useMaisRecente(cotaDosTerminais, chat.cota);
  const { aplicarPreferencias } = chatAoVivo;
  const atualizarOrquestradoresDoChat = useCallback(
    async (criado?: ResumoDoOrquestrador) => {
      // Como no formulário de criação: uma consulta que saiu antes não tira o terminal novo do canvas.
      if (criado !== undefined) {
        criadosAgora.current.add(criado.id);
      }
      await recarregar();
    },
    [recarregar],
  );
  const quantidadeDeJanelas = nos.filter((no) => !ehBixinho(no)).length;
  const podeOrganizar = quantidadeDeJanelas > 1;
  // O aviso do limite some sozinho quando uma vaga é liberada (fechar um terminal ou descartar o rascunho).
  const temVaga = cabeOutroTerminal(
    idsNoCanvas,
    nos.filter((no) => no.type === "rascunho").map((no) => no.id),
    null,
  );
  if (avisoDoLimite && temVaga) {
    // Ajuste durante o render (padrão do React para estado derivado).
    setAvisoDoLimite(false);
  }
  const fecharAvisoDoLimite = useCallback(() => setAvisoDoLimite(false), []);

  // Os painéis não dependem da posição dos nós: memorizados, não re-renderizam
  // a cada quadro do arraste. Os do topo ficam num só painel em linha
  // (esquerda · centro · direita), para se acomodarem juntos em qualquer
  // largura, sem um bloco absoluto cobrir o outro.
  const colunaDaEsquerda = useMemo(
    () => (
      <div className="coluna-do-topo coluna-do-topo-esquerda">
        <BarraDoCanvas
          aoCriar={novoOrquestrador}
          aoCriarNota={novaNota}
          aoOrganizar={organizar}
          podeOrganizar={podeOrganizar}
          aoBuscar={abrirPaleta}
        />
        {avisoDoLimite && (
          <ErroDoCanvas erro={AVISO_DO_LIMITE_DE_ORQUESTRADORES} aoFechar={fecharAvisoDoLimite} nivel="aviso" />
        )}
        {erroDasNotas !== null && <ErroDoCanvas erro={erroDasNotas} aoFechar={descartarErroDasNotas} />}
        <Doca orquestradores={orquestradores} noCanvas={noCanvas} erro={erro} aoAbrir={abrirTerminal} />
      </div>
    ),
    [
      novoOrquestrador,
      novaNota,
      organizar,
      podeOrganizar,
      abrirPaleta,
      avisoDoLimite,
      fecharAvisoDoLimite,
      erroDasNotas,
      descartarErroDasNotas,
      orquestradores,
      noCanvas,
      erro,
      abrirTerminal,
    ],
  );
  const colunaDoCentro = useMemo(
    () => (
      <div className="coluna-do-topo coluna-do-topo-centro">
        <AvisoDeConexao servidor={servidor} />
      </div>
    ),
    [servidor],
  );
  // No desktop o status está na barra de título; aqui fica só o alerta de memória.
  const colunaDaDireita = useMemo(
    () => (
      <div className="coluna-do-topo coluna-do-topo-direita">
        {desktop ? (
          <AvisoDeMemoria memoria={servidor.memoria} />
        ) : (
          <StatusDoCanvas
            trabalhando={trabalhando}
            bixinhosAtivos={bixinhosAtivos}
            cota={cota}
            memoria={servidor.memoria}
          />
        )}
      </div>
    ),
    [desktop, trabalhando, bixinhosAtivos, cota, servidor.memoria],
  );
  const barraDeTitulo = useMemo(
    () =>
      desktop ? (
        <BarraDeTituloDoApp
          trabalhando={trabalhando}
          bixinhosAtivos={bixinhosAtivos}
          cota={cota}
          memoria={servidor.memoria}
        />
      ) : null,
    [desktop, trabalhando, bixinhosAtivos, cota, servidor.memoria],
  );
  // Fora do viewport: o chat não se move com o canvas e só re-renderiza com novidades dele.
  const painelDoChat = useMemo(
    () => (
      <Panel position="bottom-center" className="painel-do-chat">
        <ChatRapido
          chat={chat}
          desconectado={!servidor.conectado}
          erroAoCarregar={chatAoVivo.erro}
          aoMudarPreferencias={aplicarPreferencias}
          aoAbrirTerminal={abrirTerminal}
          temVagaPara={temVagaPara}
          aoAtualizarOrquestradores={atualizarOrquestradoresDoChat}
        />
      </Panel>
    ),
    [
      chat,
      servidor.conectado,
      chatAoVivo.erro,
      aplicarPreferencias,
      abrirTerminal,
      temVagaPara,
      atualizarOrquestradoresDoChat,
    ],
  );

  return (
    <ProvedorDoCanvas valor={valor}>
      <ProvedorDasNotas valor={notas.valor}>
        <div
          className={`flex h-screen w-screen flex-col ${servidor.conectado ? "" : "canvas-desconectado"} ${movimento.movendo ? "canvas-movendo" : ""}`}
        >
          {barraDeTitulo}
          <div ref={areaDoCanvas} className="relative min-h-0 w-full flex-1">
            <ReactFlow<NoDoCanvas, ArestaDoCanvas>
              nodes={nos}
              edges={arestas}
              nodeTypes={TIPOS_DE_NO}
              edgeTypes={TIPOS_DE_ARESTA}
              onNodesChange={aoMudarNosEReacomodar}
              onNodeDragStart={movimento.aoComecarArraste}
              onNodeDragStop={aoSoltarNo}
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
              <MiniMap<NoDoCanvas> position="bottom-right" pannable zoomable nodeClassName={classeDoMinimapa} />
              <Panel position="top-left" className="paineis-do-topo">
                {colunaDaEsquerda}
                {colunaDoCentro}
                {colunaDaDireita}
              </Panel>
              {painelDoChat}
            </ReactFlow>
            {quantidadeDeJanelas === 0 && <CanvasVazio aoCriar={novoOrquestrador} />}
            {/* Fora do <ReactFlow>: não escala com o zoom e cobre só a área do canvas. */}
            <PaletaDeComandos
              controle={controleDaPaleta}
              lerFonte={lerFonteDaPaleta}
              aoExecutar={executarItemDaPaleta}
            />
          </div>
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
