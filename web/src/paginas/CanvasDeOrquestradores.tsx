import {
  Background,
  BackgroundVariant,
  ControlButton,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
  type EdgeTypes,
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

import { IconeGrade, IconeOrquestrador } from "../componentes/Icones";
import { ChatRapido } from "../componentes/chat/ChatRapido";
import { ArestaDoBixinho } from "../componentes/canvas/ArestaDoBixinho";
import { NoArtefato } from "../componentes/canvas/NoArtefato";
import { NoBixinho } from "../componentes/canvas/NoBixinho";
import { NoNota } from "../componentes/canvas/NoNota";
import { NoPrevia } from "../componentes/canvas/NoPrevia";
import { NavegadorDePastas } from "../componentes/canvas/NavegadorDePastas";
import { NoRascunho } from "../componentes/canvas/NoRascunho";
import { NoShell } from "../componentes/canvas/NoShell";
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
  type PainelDaBarra,
  StatusDoCanvas,
} from "../componentes/canvas/PaineisDoCanvas";
import { PainelDeInstrucoesGerais } from "../componentes/canvas/PainelDeInstrucoesGerais";
import { PainelDeSubagentes } from "../componentes/canvas/PainelDeSubagentes";
import { api, ErroDaApi, mensagemDeErro } from "../shared/api/cliente";
import type { ResumoDoArtefato } from "../shared/api/artefatos";
import type { ResumoDoOrquestrador } from "../shared/api/tipos";
import {
  type AcoesDosArtefatos,
  artefatoAberto,
  comArtefatoAberto,
  criarLojaDosArtefatos,
  posicaoParaArtefato,
  ProvedorDosArtefatos,
  semArtefato,
  sincronizarArtefatos,
  terminalDaOrigem,
  type ValorDosArtefatos,
} from "../shared/canvas/artefatos";
import { type AcoesDoCanvas, ProvedorDoCanvas, servidorParaOsNos, type ValorDoCanvas } from "../shared/canvas/contexto";
import {
  escolherEnquadramento,
  ZOOM_MAXIMO_DO_ENQUADRAMENTO,
  ZOOM_MINIMO_DO_ENQUADRAMENTO,
} from "../shared/canvas/enquadramento";
import {
  ESCALA_DA_LETRA_PADRAO,
  type EscalaDaLetra,
  type JanelaParaOrganizar,
  lerBixinhosLimpos,
  lerLayout,
  organizarComNotas,
  type Ponto,
  posicaoParaNovoTerminal,
  salvarBixinhosLimpos,
  TAMANHO_DA_NOTA,
  TAMANHO_DA_PREVIA,
  TAMANHO_DO_ARTEFATO,
  TAMANHO_DO_RASCUNHO,
  TAMANHO_DO_SHELL,
  TAMANHO_DO_TERMINAL,
  type Viewport,
} from "../shared/canvas/layout";
import { AVISO_DO_LIMITE_DE_ORQUESTRADORES, cabeOutroTerminal } from "../shared/canvas/limiteDeTerminais";
import {
  ALCA_DO_TERMINAL,
  type ArestaDoCanvas,
  arestasDasPrevias,
  arestasDosBixinhos,
  arestasDosShells,
  comEscalaDaLetra,
  ehArtefato,
  ehBixinho,
  ehNota,
  ehPrevia,
  ehRascunho,
  ehShell,
  ehTerminal,
  idDoNoDaNota,
  idDoNoDaPrevia,
  idDoNoDoArtefato,
  idDoNoDoShell,
  limparBixinhos,
  mesmasLigacoes,
  minimizarOuRestaurar,
  type NoDoCanvas,
  type NoPrevia as TipoDaPrevia,
  type NoRascunho as TipoDoRascunho,
  nosDoLayout,
  novaPrevia,
  novoShell,
  novoTerminal,
  posicaoDaPreviaDoTerminal,
  reacomodarBixinhos,
  reaproveitarArestas,
  semTerminal,
  sincronizarBixinhos,
  subagentesVisiveis,
} from "../shared/canvas/nos";
import { ProvedorDasNotas } from "../shared/canvas/notas";
import {
  type AcoesDosShells,
  type OrigemDoShell,
  ProvedorDosShells,
  TAMANHO_INICIAL_DO_SHELL,
} from "../shared/canvas/shells";
import { useAjustesDoAplicativo } from "../shared/hooks/useAjustesDoAplicativo";
import { useArtefatos } from "../shared/hooks/useArtefatos";
import { useAtualizacao } from "../shared/hooks/useAtualizacao";
import { useChat } from "../shared/hooks/useChat";
import { useConversas } from "../shared/hooks/useConversas";
import { useMovimentoDoCanvas } from "../shared/hooks/useMovimentoDoCanvas";
import { useNotas } from "../shared/hooks/useNotas";
import { useOrquestradores } from "../shared/hooks/useOrquestradores";
import { usePreferenciasDaTela } from "../shared/hooks/usePreferenciasDaTela";
import { useReaproveitado } from "../shared/hooks/useReaproveitado";
import { useRodaDoCanvas } from "../shared/hooks/useRodaDoCanvas";
import { useServidor } from "../shared/hooks/useServidor";
import type { AcaoDaPaleta, FonteDaPaleta, ItemDaPaleta } from "../shared/paletaDeComandos";

// Tudo o que vai ao <ReactFlow> é constante ou estável: uma prop nova a cada
// renderização (e o canvas renderiza a cada quadro do arraste) faz o React
// Flow atualizar o estado interno e re-renderizar por dentro.
const TIPOS_DE_NO = {
  terminal: NoTerminal,
  rascunho: NoRascunho,
  bixinho: NoBixinho,
  nota: NoNota,
  artefato: NoArtefato,
  previa: NoPrevia,
  shell: NoShell,
} satisfies NodeTypes;
const TIPOS_DE_ARESTA = { bixinho: ArestaDoBixinho } satisfies EdgeTypes;
// Enquadrar nunca passa de 100% (o texto dos terminais só fica nítido em zoom
// inteiro) nem desce de 60% (ver `escolherEnquadramento`).
/** Folga do enquadramento ao abrir o canvas. */
const FOLGA_AO_ABRIR = 0.15;
/** Folga do "enquadrar tudo" (controles, paleta). */
const FOLGA_DO_ENQUADRAMENTO = 0.12;
/** Os limites de zoom do canvas: do <ReactFlow> e do zoom por cima das caixas. */
const LIMITES_DO_ZOOM = { minZoom: 0.1, maxZoom: 2 };
/** O nome do botão de enquadrar dos controles: o mesmo do botão padrão do React Flow. */
const ROTULO_DO_ENQUADRAR = "Fit View";
const VIEWPORT_PADRAO: Viewport = { x: 0, y: 0, zoom: 1 };
/** Nome e dica do "Organizar", o 4º botão dos controles do canto inferior esquerdo. */
const DICA_DO_ORGANIZAR = "Organizar: terminais lado a lado; notas e artefatos à direita";
/**
 * Quanto do pé da área do canvas o chat rápido ocupa (compacto, com a
 * margem): a janela de um artefato aberta "no centro" fica acima dele.
 */
const ALTURA_RESERVADA_AO_CHAT = 110;
/** Altura, na área do canvas, da faixa ocupada pela barra do canvas (com folga). */
const TOPO_LIVRE_DA_TELA_PX = 84;

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
  if (ehArtefato(no)) {
    return "minimapa-artefato";
  }
  if (ehPrevia(no)) {
    return "minimapa-previa";
  }
  if (ehShell(no)) {
    return "minimapa-shell";
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

/** Os nós com os selecionados desmarcados; os outros continuam o mesmo objeto e não re-renderizam. */
function semSelecao(nos: readonly NoDoCanvas[]): NoDoCanvas[] {
  return nos.map((no) => (no.selected === true ? { ...no, selected: false } : no));
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

/** O ícone do enquadrar: o mesmo do botão padrão dos controles do React Flow. */
function IconeDoEnquadrar() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 30">
      <path d="M3.692 4.63c0-.53.4-.938.939-.938h5.215V0H4.708C2.13 0 0 2.054 0 4.63v5.216h3.692V4.631zM27.354 0h-5.2v3.692h5.17c.53 0 .984.4.984.939v5.215H32V4.631A4.624 4.624 0 0027.354 0zm.954 24.83c0 .532-.4.94-.939.94h-5.215v3.768h5.215c2.577 0 4.631-2.13 4.631-4.707v-5.139h-3.692v5.139zm-23.677.94c-.531 0-.939-.4-.939-.94v-5.138H0v5.139c0 2.577 2.13 4.707 4.708 4.707h5.138V25.77H4.631z" />
    </svg>
  );
}

/**
 * O quadro do canvas sem janelas. Mora dentro do <ReactFlow>, na camada 4 (a
 * dos nós): os painéis dele (barra do topo, controles, minimapa e o chat
 * rápido) ficam na 5, então a conversa do chat, que abre para cima, passa por
 * cima do quadro e continua clicável. Fora do <ReactFlow>, que é um contexto
 * de empilhamento próprio, o quadro cobria todos eles.
 */
function CanvasVazio({ aoCriar }: { aoCriar: () => void }) {
  return (
    <div className="camada-do-canvas-vazio pointer-events-none absolute inset-0 z-[4] grid place-items-center">
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
  // Enquadra só ao abrir com terminais (notas, artefatos ou prévias) salvos e sem posição de
  // câmera salva. Com o canvas vazio, o React Flow enquadraria o primeiro
  // terminal criado depois, com zoom exagerado.
  // Dentro do app desktop, a barra de título é da tela (com o status).
  const [desktop] = useState(rodandoNoDesktop);
  const areaDoCanvas = useRef<HTMLDivElement>(null);
  const [enquadrarAoAbrir] = useState(
    () =>
      layoutInicial.viewport === null &&
      Object.keys(layoutInicial.terminais).length +
        Object.keys(layoutInicial.notas).length +
        Object.keys(layoutInicial.artefatos).length +
        Object.keys(layoutInicial.previas).length +
        Object.keys(layoutInicial.shells).length >
        0,
  );
  const [nosIniciais] = useState(() => nosDoLayout(layoutInicial));
  const [nos, setNos, aoMudarNos] = useNodesState<NoDoCanvas>(nosIniciais);
  const [bixinhosLimpos, setBixinhosLimpos] = useState(lerBixinhosLimpos);
  const fluxo = useReactFlow<NoDoCanvas>();
  // Grava o layout (só depois de soltar um arraste) e marca quando algo se move.
  const movimento = useMovimentoDoCanvas(nos, layoutInicial.viewport);
  const { aoTerminarArraste } = movimento;
  // Pinça/Ctrl+roda e o deslize que a caixa não rola também por cima das caixas (áreas `nowheel`).
  useRodaDoCanvas(areaDoCanvas, LIMITES_DO_ZOOM);

  // Bixinhos que ficaram por cima de outra janela se reacomodam ao soltar um
  // arraste, ao terminar de redimensionar, ao abrir uma janela e ao organizar
  // — nunca a cada quadro do arraste. Sem conflito, o array não muda.
  const reacomodar = useCallback(() => setNos(reacomodarBixinhos), [setNos]);

  // O React Flow aplica a posição final do arraste antes de avisar o fim dele.
  const aoSoltarNo = useCallback(() => {
    aoTerminarArraste();
    reacomodar();
  }, [aoTerminarArraste, reacomodar]);

  // Enquanto uma janela é redimensionada, os sites das prévias não podem
  // capturar o mouse (classe `canvas-redimensionando`, como `canvas-movendo`).
  const [redimensionando, setRedimensionando] = useState(false);

  const aoMudarNosEReacomodar = useCallback(
    (mudancas: NodeChange<NoDoCanvas>[]) => {
      aoMudarNos(mudancas);
      if (mudancas.some((mudanca) => mudanca.type === "dimensions" && mudanca.resizing === true)) {
        setRedimensionando(true);
      }
      // Fim de um redimensionamento (o React Flow manda `resizing: false` só ao soltar a alça).
      if (mudancas.some((mudanca) => mudanca.type === "dimensions" && mudanca.resizing === false)) {
        setRedimensionando(false);
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
  // Chat fixo à esquerda (painel Configurações do ⚙ ou o botão do próprio chat).
  const { preferencias: preferenciasDaTela, mudarPreferencias: mudarPreferenciasDaTela } = usePreferenciasDaTela();
  const chatFixo = preferenciasDaTela.chatFixoNaEsquerda;
  const larguraDoChatFixo = preferenciasDaTela.larguraDoChatFixo;
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
  // As prévias e os shells entram também: a linha tracejada do terminal até a janela que saiu dele.
  const ligados = useReaproveitado(
    nos.filter((no) => ehTerminal(no) || ehBixinho(no) || ehPrevia(no) || ehShell(no)),
    mesmasLigacoes,
  );
  const arestasCalculadas = useMemo(
    () => [...arestasDosBixinhos(ligados, conversas), ...arestasDasPrevias(ligados), ...arestasDosShells(ligados)],
    [ligados, conversas],
  );
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

  /**
   * Mostra a prévia junto do terminal que a abriu, sem aproximar além do zoom
   * atual: no máximo afasta, quando os dois não cabem na tela.
   */
  const enquadrarSemAproximar = useCallback(
    (ids: readonly string[]) => {
      setTimeout(() => {
        const nos = ids.filter((id) => fluxo.getNode(id) !== undefined).map((id) => ({ id }));
        void fluxo.fitView({ nodes: nos, duration: 500, padding: 0.15, maxZoom: Math.min(1, fluxo.getZoom()) });
      }, ESPERA_PARA_MEDIR_MS);
    },
    [fluxo],
  );

  /** Onde abrir uma janela nova no centro da área visível, sem cobrir as que já estão ali. */
  const posicaoNoCentroVisivel = useCallback(
    (atuais: readonly NoDoCanvas[], tamanho: { largura: number; altura: number }): Ponto => {
      const centralizada = posicaoParaNovoTerminal(
        centroDaTela(),
        tamanho,
        atuais.filter((no) => !ehBixinho(no)).map((no) => no.position),
      );
      // Em telas baixas, centralizar esconderia a barra de título da janela atrás
      // da barra do canvas: o topo da janela começa sempre abaixo dela.
      const topoDaArea = areaDoCanvas.current?.getBoundingClientRect().top ?? 0;
      const topoLivre = fluxo.screenToFlowPosition({ x: 0, y: topoDaArea + TOPO_LIVRE_DA_TELA_PX }).y;
      return { ...centralizada, y: Math.max(centralizada.y, Math.round(topoLivre)) };
    },
    [centroDaTela, fluxo],
  );

  // Artefatos: a lista e os eventos ao vivo vêm do hook; os resumos vão para
  // uma loja própria, lida por cada janela — um evento de um artefato não
  // re-renderiza as outras janelas (ADR-11).
  const {
    lista: listaDeArtefatos,
    carregada: artefatosCarregados,
    erro: erroDosArtefatos,
    eventosRecentes: eventosDosArtefatos,
    renomear: renomearArtefato,
    apagar: apagarArtefato,
  } = useArtefatos(servidor.conectado);
  const [lojaDosArtefatos] = useState(criarLojaDosArtefatos);
  // Antes dos efeitos: a janela aberta por um evento já encontra o resumo na loja.
  useLayoutEffect(() => {
    lojaDosArtefatos.publicar({ lista: listaDeArtefatos, carregada: artefatosCarregados, erro: erroDosArtefatos });
  }, [lojaDosArtefatos, listaDeArtefatos, artefatosCarregados, erroDosArtefatos]);
  // A paleta lê a lista por aqui, só ao abrir.
  const artefatosAtuais = useRef(listaDeArtefatos);
  useEffect(() => {
    artefatosAtuais.current = listaDeArtefatos;
  }, [listaDeArtefatos]);

  // Os artefatos apagados no servidor saem do canvas e, com isso, do layout.
  useEffect(() => {
    if (!artefatosCarregados) {
      return;
    }
    const existentes = new Set(listaDeArtefatos.map((artefato) => artefato.id));
    setNos((atuais) => sincronizarArtefatos(atuais, existentes));
  }, [artefatosCarregados, listaDeArtefatos, setNos]);

  /**
   * O centro da área do canvas acima do chat rápido (que fica no pé da tela).
   * Com o chat fixo à esquerda, fora da área, é o próprio centro.
   */
  const centroAcimaDoChat = useCallback((): Ponto => {
    const area = areaDoCanvas.current?.getBoundingClientRect();
    if (chatFixo || area === undefined || area.width <= 0 || area.height <= 0) {
      return centroDaTela();
    }
    const alturaLivre = Math.max(area.height - ALTURA_RESERVADA_AO_CHAT, area.height / 2);
    return fluxo.screenToFlowPosition({ x: area.left + area.width / 2, y: area.top + alturaLivre / 2 });
  }, [centroDaTela, chatFixo, fluxo]);

  /**
   * Abre a janela do artefato, se ainda não estiver aberta: ao lado do terminal
   * do Orquestrador que o criou, se ele estiver aberto; senão, no centro da
   * vista. Sempre num lugar livre. Artefatos não contam no limite de terminais.
   */
  const abrirArtefato = useCallback(
    (artefato: Pick<ResumoDoArtefato, "id" | "origem">) => {
      setNos((atuais) => {
        if (artefatoAberto(atuais, artefato.id)) {
          return atuais;
        }
        const posicao = posicaoParaArtefato(
          atuais,
          TAMANHO_DO_ARTEFATO,
          terminalDaOrigem(atuais, artefato),
          centroAcimaDoChat(),
        );
        return reacomodarBixinhos(comArtefatoAberto(atuais, artefato.id, posicao));
      });
    },
    [centroAcimaDoChat, setNos],
  );

  // Um artefato criado agora abre sozinho. Versão nova não abre a janela
  // fechada (a aberta passa sozinha para ela); título novo e remoção só mudam
  // a lista.
  const ultimoEventoVisto = useRef(0);
  useEffect(() => {
    for (const { numero, evento } of eventosDosArtefatos) {
      if (numero <= ultimoEventoVisto.current) {
        continue;
      }
      ultimoEventoVisto.current = numero;
      if (evento.tipo === "artefato_criado") {
        abrirArtefato(evento.artefato);
      }
    }
  }, [eventosDosArtefatos, abrirArtefato]);

  /** Pela paleta: abre a janela (se fechada) e leva até ela. */
  const abrirOuFocarArtefato = useCallback(
    (artefatoId: string) => {
      const artefato = artefatosAtuais.current.find((candidato) => candidato.id === artefatoId);
      abrirArtefato(artefato ?? { id: artefatoId, origem: { tipo: "chat", id: null } });
      focar(idDoNoDoArtefato(artefatoId));
    },
    [abrirArtefato, focar],
  );

  const acoesDosArtefatos = useMemo<AcoesDosArtefatos>(
    () => ({
      renomear: async (artefatoId, titulo) => {
        await renomearArtefato(artefatoId, titulo);
      },
      apagar: apagarArtefato,
      fechar: (artefatoId) => setNos((atuais) => semArtefato(atuais, artefatoId)),
    }),
    [renomearArtefato, apagarArtefato, setNos],
  );
  const valorDosArtefatos = useMemo<ValorDosArtefatos>(
    () => ({ loja: lojaDosArtefatos, acoes: acoesDosArtefatos }),
    [lojaDosArtefatos, acoesDosArtefatos],
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
      const posicao = posicaoNoCentroVisivel(atuais, TAMANHO_DO_RASCUNHO);
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
  }, [posicaoNoCentroVisivel, reservarVaga, setNos]);

  /** O botão Prévia da barra: uma prévia vazia no centro da tela, com o campo de endereço focado. */
  const novaPreviaVazia = useCallback(() => {
    const previaId = crypto.randomUUID();
    setNos((atuais) => {
      const previa = novaPrevia(previaId, posicaoNoCentroVisivel(atuais, TAMANHO_DA_PREVIA), {
        url: "",
        orquestradorId: null,
      });
      return reacomodarBixinhos([...semSelecao(atuais), { ...previa, selected: true }]);
    });
  }, [posicaoNoCentroVisivel, setNos]);

  const abrirPrevia = useCallback(
    (orquestradorId: string, url: string) => {
      const mesma = (no: NoDoCanvas): no is TipoDaPrevia =>
        ehPrevia(no) && no.data.orquestradorId === orquestradorId && no.data.url === url;
      const previaId = crypto.randomUUID();
      const existente = fluxo.getNodes().find(mesma);
      setNos((atuais) => {
        const aberta = atuais.find(mesma);
        if (aberta !== undefined) {
          return aberta.data.minimizada
            ? reacomodarBixinhos(atuais.map((no) => (no === aberta ? minimizarOuRestaurar(aberta) : no)))
            : atuais;
        }
        // Ao lado do terminal, longe das outras janelas; sem o terminal no canvas, no centro da tela.
        const posicao =
          posicaoDaPreviaDoTerminal(atuais, orquestradorId, TAMANHO_DA_PREVIA) ??
          posicaoNoCentroVisivel(atuais, TAMANHO_DA_PREVIA);
        const previa = novaPrevia(previaId, posicao, { url, orquestradorId });
        return reacomodarBixinhos([...semSelecao(atuais), { ...previa, selected: true }]);
      });
      enquadrarSemAproximar([orquestradorId, existente?.id ?? idDoNoDaPrevia(previaId)]);
    },
    [fluxo, enquadrarSemAproximar, posicaoNoCentroVisivel, setNos],
  );

  const navegarPrevia = useCallback(
    (previaId: string, url: string) =>
      setNos((atuais) =>
        atuais.map((no) => (ehPrevia(no) && no.data.previaId === previaId ? { ...no, data: { ...no.data, url } } : no)),
      ),
    [setNos],
  );

  const minimizarOuRestaurarPrevia = useCallback(
    (previaId: string) =>
      setNos((atuais) =>
        reacomodarBixinhos(
          atuais.map((no) => (ehPrevia(no) && no.data.previaId === previaId ? minimizarOuRestaurar(no) : no)),
        ),
      ),
    [setNos],
  );

  const fecharPrevia = useCallback(
    (previaId: string) => setNos((atuais) => atuais.filter((no) => !ehPrevia(no) || no.data.previaId !== previaId)),
    [setNos],
  );

  // Terminais de shell (o bloco "Terminal"): a recusa do servidor (409, o
  // limite) aparece abaixo da barra do canvas, como aviso; as outras falhas, como erro.
  const [erroDosShells, setErroDosShells] = useState<{ mensagem: string; nivel: "erro" | "aviso" } | null>(null);
  const descartarErroDosShells = useCallback(() => setErroDosShells(null), []);
  const [escolhendoPastaDoShell, setEscolhendoPastaDoShell] = useState(false);

  const mostrarFalhaDoShell = useCallback((falha: unknown) => {
    setErroDosShells({
      mensagem: mensagemDeErro(falha),
      nivel: falha instanceof ErroDaApi && falha.status === 409 ? "aviso" : "erro",
    });
  }, []);

  /** Cria o shell no servidor e abre o bloco: ao lado do terminal do Orquestrador, ou no centro da tela. */
  const abrirShell = useCallback(
    (origem: OrigemDoShell) => {
      setErroDosShells(null);
      api
        .criarShell({ ...origem, ...TAMANHO_INICIAL_DO_SHELL })
        .then((criado) => {
          const shellId = crypto.randomUUID();
          const ligadoA = criado.orquestradorId;
          setNos((atuais) => {
            const posicao =
              (ligadoA === null ? null : posicaoDaPreviaDoTerminal(atuais, ligadoA, TAMANHO_DO_SHELL)) ??
              posicaoNoCentroVisivel(atuais, TAMANHO_DO_SHELL);
            const shell = novoShell(shellId, posicao, {
              terminalId: criado.id,
              pasta: criado.pasta,
              orquestradorId: ligadoA,
            });
            return reacomodarBixinhos([...semSelecao(atuais), { ...shell, selected: true }]);
          });
          if (ligadoA !== null) {
            enquadrarSemAproximar([ligadoA, idDoNoDoShell(shellId)]);
          }
        })
        .catch(mostrarFalhaDoShell);
    },
    [enquadrarSemAproximar, mostrarFalhaDoShell, posicaoNoCentroVisivel, setNos],
  );

  /** Tira o bloco do canvas e encerra o shell no servidor (já encerrado, o 404 não é falha). */
  const fecharShell = useCallback(
    (shellId: string) => {
      const bloco = nosAtuais.current.filter(ehShell).find((no) => no.data.shellId === shellId);
      setNos((atuais) => atuais.filter((no) => !ehShell(no) || no.data.shellId !== shellId));
      if (bloco !== undefined) {
        api.encerrarShell(bloco.data.terminalId).catch((falha: unknown) => {
          if (!(falha instanceof ErroDaApi && falha.status === 404)) {
            mostrarFalhaDoShell(falha);
          }
        });
      }
    },
    [mostrarFalhaDoShell, setNos],
  );

  /** O shell encerrou: abre outro na mesma pasta e troca o id do terminal no mesmo bloco (que religa). */
  const reabrirShell = useCallback(
    (shellId: string) => {
      const bloco = nosAtuais.current.filter(ehShell).find((no) => no.data.shellId === shellId);
      if (bloco === undefined) {
        return;
      }
      setErroDosShells(null);
      api
        .criarShell({ pasta: bloco.data.pasta, ...TAMANHO_INICIAL_DO_SHELL })
        .then((criado) =>
          setNos((atuais) =>
            atuais.map((no) =>
              ehShell(no) && no.data.shellId === shellId ? { ...no, data: { ...no.data, terminalId: criado.id } } : no,
            ),
          ),
        )
        .catch(mostrarFalhaDoShell);
    },
    [mostrarFalhaDoShell, setNos],
  );

  const valorDosShells = useMemo<AcoesDosShells>(
    () => ({ abrirShell, fecharShell, reabrirShell }),
    [abrirShell, fecharShell, reabrirShell],
  );

  const pedirPastaDoShell = useCallback(() => setEscolhendoPastaDoShell(true), []);
  const fecharEscolhaDaPastaDoShell = useCallback(() => setEscolhendoPastaDoShell(false), []);
  const abrirShellNaPasta = useCallback(
    (pasta: string) => {
      setEscolhendoPastaDoShell(false);
      abrirShell({ pasta });
    },
    [abrirShell],
  );

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
        // O tamanho da letra escolhido no rascunho passa para o terminal, com a altura na mesma proporção.
        const escalaDaLetra =
          rascunho !== undefined && ehRascunho(rascunho) ? rascunho.data.escalaDaLetra : undefined;
        const terminal = novoTerminal(
          orquestrador.id,
          rascunho?.position ?? centroDaTela(),
          rascunho?.width ?? TAMANHO_DO_TERMINAL.largura,
          Math.round(TAMANHO_DO_TERMINAL.altura * (escalaDaLetra ?? ESCALA_DA_LETRA_PADRAO)),
          escalaDaLetra,
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

  // O cartão muda de tamanho junto com a letra: os bixinhos saem de baixo dele, como ao redimensionar.
  const mudarEscalaDaLetra = useCallback(
    (noId: string, escalaDaLetra: EscalaDaLetra) =>
      setNos((atuais) => {
        const novos = atuais.map((no) => (no.id === noId ? comEscalaDaLetra(no, escalaDaLetra) : no));
        return novos.every((no, indice) => no === atuais[indice]) ? atuais : reacomodarBixinhos(novos);
      }),
    [setNos],
  );

  const organizar = useCallback(() => {
    setNos((atuais) => {
      const janelas = atuais
        .filter((no) => !ehBixinho(no) && !ehNota(no) && !ehArtefato(no) && !ehPrevia(no) && !ehShell(no))
        .map((no) => tamanhoParaOrganizar(no, TAMANHO_DO_TERMINAL));
      // As prévias e os shells vão para as colunas das notas: também não têm bixinhos.
      const notasNoCanvas = atuais
        .filter((no) => ehNota(no) || ehPrevia(no) || ehShell(no))
        .map((no) =>
          tamanhoParaOrganizar(no, ehNota(no) ? TAMANHO_DA_NOTA : ehShell(no) ? TAMANHO_DO_SHELL : TAMANHO_DA_PREVIA),
        );
      const artefatosNoCanvas = atuais.filter(ehArtefato).map((no) => tamanhoParaOrganizar(no, TAMANHO_DO_ARTEFATO));
      const posicoes = organizarComNotas(janelas, notasNoCanvas, artefatosNoCanvas);
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

  /**
   * Mostra tudo o que está no canvas, entre 60% e 100% (ver ADR-20): se tudo
   * não cabe legível, enquadra uma caixa só (a selecionada ou a mais perto do
   * centro da tela; ver `escolherEnquadramento`).
   */
  const enquadrarLegivel = useCallback(
    (folga: number, duracao: number) => {
      const visiveis = fluxo.getNodes().filter((no) => no.hidden !== true);
      const area = areaDoCanvas.current?.getBoundingClientRect();
      const escolha = escolherEnquadramento({
        caixas: visiveis.map((no) => ({
          id: no.id,
          retangulo: fluxo.getNodesBounds([no]),
          selecionada: no.selected === true,
          acessoria: ehBixinho(no),
        })),
        tela: { largura: area?.width ?? 0, altura: area?.height ?? 0 },
        centro: centroDaTela(),
        folga,
      });
      void fluxo.fitView(
        escolha.tipo === "tudo"
          ? { duration: duracao, padding: folga, maxZoom: ZOOM_MAXIMO_DO_ENQUADRAMENTO }
          : {
              nodes: [{ id: escolha.id }],
              duration: duracao,
              padding: folga,
              minZoom: ZOOM_MINIMO_DO_ENQUADRAMENTO,
              maxZoom: ZOOM_MAXIMO_DO_ENQUADRAMENTO,
            },
      );
    },
    [centroDaTela, fluxo],
  );
  const enquadrarTudo = useCallback(() => enquadrarLegivel(FOLGA_DO_ENQUADRAMENTO, 500), [enquadrarLegivel]);

  // Ao abrir com janelas salvas e sem câmera salva, enquadra com a mesma regra
  // (o React Flow espera os nós serem medidos antes de aplicar o fitView).
  const enquadrouAoAbrir = useRef(false);
  useEffect(() => {
    if (!enquadrarAoAbrir || enquadrouAoAbrir.current) {
      return;
    }
    enquadrouAoAbrir.current = true;
    enquadrarLegivel(FOLGA_AO_ABRIR, 0);
  }, [enquadrarAoAbrir, enquadrarLegivel]);

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

  // Ctrl+N: novo orquestrador (o mesmo do "+ Novo ▾", com o limite do
  // ADR-18); Ctrl+Shift+N: nova nota. Fora de campos de texto, como o Ctrl+0;
  // o preventDefault impede o Chromium/Electron de abrir outra janela.
  useEffect(() => {
    const aoApertarTecla = (evento: KeyboardEvent) => {
      if (!evento.ctrlKey || evento.altKey || evento.metaKey || evento.repeat) {
        return;
      }
      if (evento.code !== "KeyN" && evento.key !== "n" && evento.key !== "N") {
        return;
      }
      if (focoEmCampoDeTexto(evento.target)) {
        return;
      }
      evento.preventDefault();
      if (evento.shiftKey) {
        novaNota();
      } else {
        novoOrquestrador();
      }
    };
    window.addEventListener("keydown", aoApertarTecla);
    return () => window.removeEventListener("keydown", aoApertarTecla);
  }, [novoOrquestrador, novaNota]);

  // Os Ajustes do app desktop, pela paleta; a falha aparece abaixo da barra do canvas.
  const {
    disponivel: ajustesDisponiveis,
    abrir: abrirAjustes,
    erro: erroDosAjustes,
    descartarErro: descartarErroDosAjustes,
  } = useAjustesDoAplicativo();

  // Paleta de comandos (Ctrl+K): o estado é dela; o canvas só entrega o que
  // listar (lido na hora de abrir) e executa o escolhido. Tudo estável, para a
  // paleta não re-renderizar com o canvas.
  const controleDaPaleta = useRef<ControleDaPaleta>(null);
  const abrirPaleta = useCallback(() => controleDaPaleta.current?.abrir(), []);

  // A atualização do app desktop, pela paleta ("Procurar atualizações"). Lida
  // por aqui só ao abrir; com a paleta aberta, o detalhe acompanha a verificação.
  const { estado: estadoDaAtualizacao, verificar: verificarAtualizacao } = useAtualizacao();
  const atualizacaoAtual = useRef(estadoDaAtualizacao);
  useEffect(() => {
    atualizacaoAtual.current = estadoDaAtualizacao;
    controleDaPaleta.current?.atualizar();
  }, [estadoDaAtualizacao]);

  const lojaDasNotas = notas.valor.loja;
  const lerFonteDaPaleta = useCallback((): FonteDaPaleta => {
    const atuais = nosAtuais.current;
    const artefatosNoCanvas = new Set(atuais.filter(ehArtefato).map((no) => no.data.artefatoId));
    return {
      podeOrganizar: atuais.filter((no) => !ehBixinho(no)).length > 1,
      podeAbrirAjustes: desktop && ajustesDisponiveis,
      atualizacao: atualizacaoAtual.current,
      orquestradores: orquestradoresAtuais.current ?? [],
      abertos: new Set(atuais.filter(ehTerminal).map((no) => no.data.orquestradorId)),
      notas: atuais.filter(ehNota).map((no) => {
        const nota = lojaDasNotas.ler(no.data.notaId);
        return { notaId: no.data.notaId, titulo: nota?.titulo ?? "", texto: nota?.texto ?? "" };
      }),
      artefatos: artefatosAtuais.current.map((artefato) => ({
        artefatoId: artefato.id,
        titulo: artefato.titulo,
        formato: artefato.formato,
        origem: artefato.origem,
        aberto: artefatosNoCanvas.has(artefato.id),
      })),
      // Só as conversas carregadas: as dos terminais abertos, sem as arquivadas (/clear).
      conversas: conversasAtuais.current,
    };
  }, [lojaDasNotas, desktop, ajustesDisponiveis]);
  const executarItemDaPaleta = useCallback(
    (item: ItemDaPaleta) => {
      switch (item.tipo) {
        case "acao": {
          const acoesDaPaleta: Readonly<Record<AcaoDaPaleta, () => void>> = {
            "novo-orquestrador": novoOrquestrador,
            "nova-nota": novaNota,
            "nova-previa": novaPreviaVazia,
            organizar,
            "zoom-100": zoomEmCemPorCento,
            "enquadrar-tudo": enquadrarTudo,
            "ajustes-do-aplicativo": () => void abrirAjustes(),
            // A paleta fica aberta: o detalhe da ação mostra "verificando…" e o resultado.
            "procurar-atualizacoes": () => void verificarAtualizacao(),
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
        case "artefato":
          abrirOuFocarArtefato(item.artefatoId);
          return;
      }
    },
    [
      novoOrquestrador,
      novaNota,
      novaPreviaVazia,
      organizar,
      zoomEmCemPorCento,
      enquadrarTudo,
      abrirAjustes,
      verificarAtualizacao,
      abrirTerminal,
      focar,
      abrirOuFocarArtefato,
    ],
  );

  const acoes = useMemo<AcoesDoCanvas>(
    () => ({
      abrirTerminal,
      fecharTerminal,
      limparBixinhos: limparBixinhosDoTerminal,
      orquestradorCriado,
      descartarRascunho,
      mudarEscalaDaLetra,
      recarregar,
      abrirPrevia,
      navegarPrevia,
      minimizarOuRestaurarPrevia,
      fecharPrevia,
    }),
    [
      abrirTerminal,
      fecharTerminal,
      limparBixinhosDoTerminal,
      orquestradorCriado,
      descartarRascunho,
      mudarEscalaDaLetra,
      recarregar,
      abrirPrevia,
      navegarPrevia,
      minimizarOuRestaurarPrevia,
      fecharPrevia,
    ],
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
  // O que reiniciar o app (para instalar uma atualização) cancelaria: os
  // Orquestradores trabalhando num turno e a resposta do chat rápido.
  const pedidosEmAndamento = trabalhando + (chat.situacao === "respondendo" ? 1 : 0);
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

  const [painelAberto, setPainelAberto] = useState<PainelDaBarra | null>(null);
  const alternarPainel = useCallback(
    (painel: PainelDaBarra) => setPainelAberto((aberto) => (aberto === painel ? null : painel)),
    [],
  );
  const fecharPainel = useCallback(() => setPainelAberto(null), []);

  // A contagem do botão Subagentes. Com o servidor fora, fica sem número até
  // ele voltar (o efeito roda de novo na reconexão).
  const [quantidadeDeSubagentes, setQuantidadeDeSubagentes] = useState<number | null>(null);
  const lerQuantidadeDeSubagentes = useCallback(() => {
    api
      .lerPreferencias()
      .then((preferencias) => setQuantidadeDeSubagentes(preferencias.subagentesProntos.length))
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    if (servidor.conectado) {
      lerQuantidadeDeSubagentes();
    } else {
      setQuantidadeDeSubagentes(null);
    }
  }, [servidor.conectado, lerQuantidadeDeSubagentes]);
  // Salvar qualquer um dos painéis: os indicadores dos terminais e a contagem podem ter mudado.
  const aoSalvarPainel = useCallback(() => {
    void recarregar();
    lerQuantidadeDeSubagentes();
  }, [recarregar, lerQuantidadeDeSubagentes]);

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
          aoBuscar={abrirPaleta}
          aoCriarPrevia={novaPreviaVazia}
          aoCriarShell={pedirPastaDoShell}
          aoAlternarPainel={alternarPainel}
          painelAberto={painelAberto}
          quantidadeDeSubagentes={quantidadeDeSubagentes}
        />
        {painelAberto === "subagentes" && <PainelDeSubagentes aoFechar={fecharPainel} aoSalvar={aoSalvarPainel} />}
        {painelAberto === "instrucoes" && (
          <PainelDeInstrucoesGerais aoFechar={fecharPainel} aoSalvar={aoSalvarPainel} />
        )}
        {avisoDoLimite && (
          <ErroDoCanvas erro={AVISO_DO_LIMITE_DE_ORQUESTRADORES} aoFechar={fecharAvisoDoLimite} nivel="aviso" />
        )}
        {erroDasNotas !== null && <ErroDoCanvas erro={erroDasNotas} aoFechar={descartarErroDasNotas} />}
        {erroDosAjustes !== null && <ErroDoCanvas erro={erroDosAjustes} aoFechar={descartarErroDosAjustes} />}
        {erroDosShells !== null && (
          <ErroDoCanvas erro={erroDosShells.mensagem} aoFechar={descartarErroDosShells} nivel={erroDosShells.nivel} />
        )}
        <Doca orquestradores={orquestradores} noCanvas={noCanvas} erro={erro} aoAbrir={abrirTerminal} />
      </div>
    ),
    [
      novoOrquestrador,
      novaNota,
      abrirPaleta,
      novaPreviaVazia,
      pedirPastaDoShell,
      painelAberto,
      alternarPainel,
      fecharPainel,
      quantidadeDeSubagentes,
      aoSalvarPainel,
      avisoDoLimite,
      fecharAvisoDoLimite,
      erroDasNotas,
      descartarErroDasNotas,
      erroDosAjustes,
      descartarErroDosAjustes,
      erroDosShells,
      descartarErroDosShells,
      orquestradores,
      noCanvas,
      erro,
      abrirTerminal,
    ],
  );
  // Os controles do canto inferior esquerdo: zoom, enquadrar e, em 4º, o
  // "Organizar". Memorizados: com um filho novo a cada render, o <Controls>
  // re-renderizaria a cada quadro do arraste.
  const controles = useMemo(
    () => (
      // O enquadrar padrão do React Flow encolheria tudo até ficar ilegível:
      // o botão (mesmo ícone e nome) usa o `enquadrarTudo` com piso de 60%.
      <Controls position="bottom-left" showInteractive={false} showFitView={false}>
        <ControlButton
          className="react-flow__controls-fitview"
          onClick={enquadrarTudo}
          title={ROTULO_DO_ENQUADRAR}
          aria-label={ROTULO_DO_ENQUADRAR}
        >
          <IconeDoEnquadrar />
        </ControlButton>
        <ControlButton
          onClick={organizar}
          disabled={!podeOrganizar}
          title={DICA_DO_ORGANIZAR}
          aria-label={DICA_DO_ORGANIZAR}
        >
          <IconeGrade />
        </ControlButton>
      </Controls>
    ),
    [enquadrarTudo, organizar, podeOrganizar],
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
          aoBuscar={abrirPaleta}
          pedidosEmAndamento={pedidosEmAndamento}
        />
      ) : null,
    [desktop, trabalhando, bixinhosAtivos, cota, servidor.memoria, abrirPaleta, pedidosEmAndamento],
  );
  // Fora do viewport: o chat não se move com o canvas e só re-renderiza com novidades dele.
  // Fixo à esquerda (preferência da tela), vira uma coluna ao lado da área do canvas;
  // senão, fica no painel do centro de baixo, dentro do React Flow.
  const alternarChatFixo = useCallback(
    (fixo: boolean) => mudarPreferenciasDaTela({ chatFixoNaEsquerda: fixo }),
    [mudarPreferenciasDaTela],
  );
  // A alça da borda do chat fixo grava a largura ao soltar; a área do canvas
  // (flex-1) acompanha e o React Flow se remede pelo observador de tamanho dele.
  const mudarLarguraDoChat = useCallback(
    (largura: number) => mudarPreferenciasDaTela({ larguraDoChatFixo: largura }),
    [mudarPreferenciasDaTela],
  );
  const chatRapido = useMemo(
    () => (
      <ChatRapido
        chat={chat}
        desconectado={!servidor.conectado}
        erroAoCarregar={chatAoVivo.erro}
        aoMudarPreferencias={aplicarPreferencias}
        aoAbrirTerminal={abrirTerminal}
        temVagaPara={temVagaPara}
        aoAtualizarOrquestradores={atualizarOrquestradoresDoChat}
        fixo={chatFixo}
        aoAlternarFixo={alternarChatFixo}
        largura={larguraDoChatFixo}
        aoMudarLargura={mudarLarguraDoChat}
      />
    ),
    [
      chat,
      servidor.conectado,
      chatAoVivo.erro,
      aplicarPreferencias,
      abrirTerminal,
      temVagaPara,
      atualizarOrquestradoresDoChat,
      chatFixo,
      alternarChatFixo,
      larguraDoChatFixo,
      mudarLarguraDoChat,
    ],
  );
  const painelDoChat = useMemo(
    () =>
      chatFixo ? null : (
        <Panel position="bottom-center" className="painel-do-chat">
          {chatRapido}
        </Panel>
      ),
    [chatFixo, chatRapido],
  );

  return (
    <ProvedorDoCanvas valor={valor}>
      <ProvedorDasNotas valor={notas.valor}>
        <ProvedorDosArtefatos valor={valorDosArtefatos}>
          <ProvedorDosShells valor={valorDosShells}>
            <div
              className={`flex h-screen w-screen flex-col ${servidor.conectado ? "" : "canvas-desconectado"} ${movimento.movendo ? "canvas-movendo" : ""} ${redimensionando ? "canvas-redimensionando" : ""}`}
            >
              {barraDeTitulo}
              {/* Linha: o chat fixo à esquerda (quando a preferência pede) empurra a área do canvas. */}
              <div className="flex min-h-0 w-full flex-1">
                {chatFixo && chatRapido}
                <div ref={areaDoCanvas} className="relative min-h-0 min-w-0 flex-1">
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
                    minZoom={LIMITES_DO_ZOOM.minZoom}
                    maxZoom={LIMITES_DO_ZOOM.maxZoom}
                    // Como no Excalidraw: a roda do mouse rola o canvas; com Ctrl, dá zoom.
                    panOnScroll
                    zoomActivationKeyCode="Control"
                    deleteKeyCode={null}
                  >
                    <Background variant={BackgroundVariant.Dots} gap={24} size={1.4} />
                    {/* Abaixo dos painéis (inclusive o chat); some enquanto um painel da barra está aberto. */}
                    {quantidadeDeJanelas === 0 && painelAberto === null && <CanvasVazio aoCriar={novoOrquestrador} />}
                    {controles}
                    <MiniMap<NoDoCanvas> position="bottom-right" pannable zoomable nodeClassName={classeDoMinimapa} />
                    <Panel position="top-left" className="paineis-do-topo">
                      {colunaDaEsquerda}
                      {colunaDoCentro}
                      {colunaDaDireita}
                    </Panel>
                    {painelDoChat}
                  </ReactFlow>
                  {/* Fora do <ReactFlow>: não escala com o zoom e cobre só a área do canvas. */}
                  <PaletaDeComandos
                    controle={controleDaPaleta}
                    lerFonte={lerFonteDaPaleta}
                    aoExecutar={executarItemDaPaleta}
                  />
                </div>
              </div>
            </div>
            {/* "Terminal" do "+ Novo ▾": a pasta é escolhida no mesmo navegador de pastas da criação do orquestrador. */}
            {escolhendoPastaDoShell && (
              <NavegadorDePastas aoEscolher={abrirShellNaPasta} aoFechar={fecharEscolhaDaPastaDoShell} />
            )}
          </ProvedorDosShells>
        </ProvedorDosArtefatos>
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
