import {
  Background,
  BackgroundVariant,
  BezierEdge,
  ControlButton,
  Controls,
  Handle,
  type IsValidConnection,
  MiniMap,
  type NodeProps,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  useNodesState,
  useReactFlow,
  type Connection,
  type EdgeChange,
  type EdgeTypes,
  type NodeChange,
  type NodeTypes,
} from "@xyflow/react";
import {
  type ComponentType,
  type Dispatch,
  type DragEvent,
  memo,
  type SetStateAction,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { IconeMinimapa, IconeOrquestrador } from "../componentes/Icones";
import { ChatRapido, TIPO_DA_RESPOSTA_DO_CHAT } from "../componentes/chat/ChatRapido";
import { ArestaDoBixinho } from "../componentes/canvas/ArestaDoBixinho";
import { BarraDoGrupo } from "../componentes/canvas/BarraDoGrupo";
import { CamadaDeDesenho } from "../componentes/canvas/CamadaDeDesenho";
import { NoArtefato } from "../componentes/canvas/NoArtefato";
import { NoBixinho } from "../componentes/canvas/NoBixinho";
import { NoNota } from "../componentes/canvas/NoNota";
import { NoPrevia } from "../componentes/canvas/NoPrevia";
import { NavegadorDePastas } from "../componentes/canvas/NavegadorDePastas";
import { NoRascunho } from "../componentes/canvas/NoRascunho";
import { NoShell } from "../componentes/canvas/NoShell";
import { NoTerminal } from "../componentes/canvas/NoTerminal";
import { type AbaDasConfiguracoes, ConfiguracoesDoApp } from "../componentes/canvas/ConfiguracoesDoApp";
import {
  FaixaDeArrasto,
  IlhaDaDireita,
  IlhaDeFerramentas,
  IlhaDoNome,
  NotificacoesDoCanvas,
} from "../componentes/canvas/IlhasDoCanvas";
import { type ControleDaPaleta, PaletaDeComandos } from "../componentes/canvas/PaletaDeComandos";
import { rodandoNoDesktop, rodandoNoMac } from "../shared/ponteDoDesktop";
import { AvisoDeConexao, ErroDoCanvas, StatusDoCanvas } from "../componentes/canvas/PaineisDoCanvas";
import { DialogoDeNovoModelo, PainelDeModelos } from "../componentes/canvas/PainelDeModelos";
import { PainelDeSubagentes } from "../componentes/canvas/PainelDeSubagentes";
import { api, ErroDaApi, mensagemDeErro } from "../shared/api/cliente";
import type { ResumoDoArtefato } from "../shared/api/artefatos";
import type { ConteudoDoModeloDeCanvas, DadosDoSubagentePronto, ResumoDoOrquestrador } from "../shared/api/tipos";
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
  type Alinhamento,
  alinharJanelas,
  distribuirJanelas,
  type EixoDaDistribuicao,
  ESCALA_DA_LETRA_PADRAO,
  type EscalaDaLetra,
  type JanelaNoCanvas,
  janelasLadoALado,
  type JanelaParaOrganizar,
  lerBixinhosLimpos,
  lerLayout,
  MARGEM_DO_LADO_A_LADO,
  organizarComNotas,
  type Ponto,
  posicaoLivrePerto,
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
  ALCA_DE_LIGACAO,
  ALCA_DO_TERMINAL,
  type Ancora,
  type ArestaDoCanvas,
  arestasDasLigacoes,
  arestasDasPrevias,
  arestasDosBixinhos,
  arestasDosShells,
  areasOcupadas,
  comEscalaDaLetra,
  comItensLigadosJunto,
  comPosicoes,
  desligarItem,
  ehArtefato,
  ehBixinho,
  ehFechavelEmGrupo,
  ehItemLigavel,
  ehLigacaoValida,
  ehNota,
  ehPrevia,
  ehRascunho,
  ehShell,
  ehTerminal,
  idDoNoDaNota,
  idDoNoDaPrevia,
  idDoNoDoArtefato,
  idDoNoDoShell,
  itensLigadosParaEnvio,
  janelaVisivel,
  lerIdDaLigacao,
  ligarItem,
  limparBixinhos,
  mesmasLigacoes,
  minimizarOuRestaurar,
  minimizarOuRestaurarTelas,
  type NoDoCanvas,
  type NoPrevia as TipoDaPrevia,
  type NoRascunho as TipoDoRascunho,
  nosDoLayout,
  novaPrevia,
  novoShell,
  novoTerminal,
  outrasTelas,
  posicaoDaPreviaDoTerminal,
  posicaoDoTerminalNovo,
  reacomodarBixinhos,
  reaproveitarArestas,
  type ResumoDoGrupo,
  resumirGrupo,
  selecionarTodasAsTelas,
  semBixinhosNaSelecao,
  semLigacoesOrfas,
  semTerminal,
  sincronizarBixinhos,
  subagentesVisiveis,
  telasSelecionadas,
} from "../shared/canvas/nos";
import { type ArranjoDaSelecao, arranjoDaSelecao, recriarItens, tamanhoDoArranjo } from "../shared/canvas/modelos";
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
import { useModoInvisivel } from "../shared/hooks/useModoInvisivel";
import { useChat } from "../shared/hooks/useChat";
import { useConversas } from "../shared/hooks/useConversas";
import { useMovimentoDoCanvas } from "../shared/hooks/useMovimentoDoCanvas";
import { useNotas } from "../shared/hooks/useNotas";
import { useOrquestradores } from "../shared/hooks/useOrquestradores";
import { usePreferenciasDaTela } from "../shared/hooks/usePreferenciasDaTela";
import { mesmoConteudo, useReaproveitado } from "../shared/hooks/useReaproveitado";
import { useRodaDoCanvas } from "../shared/hooks/useRodaDoCanvas";
import { useSaidaDosBixinhos } from "../shared/hooks/useSaidaDosBixinhos";
import { useServidor } from "../shared/hooks/useServidor";
import { markdownParaTexto } from "../shared/markdownParaTexto";
import { CONFIGURACAO_PADRAO_DO_ORQUESTRADOR } from "../shared/modelos";
import { nomeLivre } from "../shared/nomeLivre";
import type { AcaoDaPaleta, FonteDaPaleta, ItemDaPaleta } from "../shared/paletaDeComandos";
import { aoMudarSubagentesProntos } from "../shared/subagentesProntos";

/** Onde chega a linha do terminal a uma nota ou artefato ligados: o meio de cada lado (a prévia já tem as dela). */
const ANCORAS_DO_ITEM_LIGADO: readonly { id: Ancora; posicao: Position }[] = [
  { id: "cima", posicao: Position.Top },
  { id: "baixo", posicao: Position.Bottom },
  { id: "esquerda", posicao: Position.Left },
  { id: "direita", posicao: Position.Right },
];

/**
 * A bolinha à direita de uma nota, prévia ou artefato: puxar dela até um
 * terminal liga o item ao Orquestrador (só começa ligações, não recebe).
 * Com `comAncoras`, também as âncoras onde a linha chega. Memorizada: o
 * arraste não a re-renderiza a cada quadro.
 */
const AlcaDeLigacao = memo(function AlcaDeLigacao({ comAncoras }: { comAncoras: boolean }) {
  return (
    <>
      {comAncoras &&
        ANCORAS_DO_ITEM_LIGADO.map(({ id, posicao }) => (
          <Handle key={id} id={id} type="target" position={posicao} className="ancora" isConnectable={false} />
        ))}
      <Handle
        id={ALCA_DE_LIGACAO}
        type="source"
        position={Position.Right}
        className="alca-de-ligacao"
        isConnectableEnd={false}
        title="Arraste até um terminal para ligar a ele (vai como contexto no próximo pedido)"
      />
    </>
  );
});

/** O nó com a alça de ligação por cima: nota, prévia e artefato se ligam a um terminal. */
function comAlcaDeLigacao<Props extends NodeProps>(No: ComponentType<Props>, comAncoras: boolean) {
  return memo(function NoComAlcaDeLigacao(props: Props) {
    return (
      <>
        <AlcaDeLigacao comAncoras={comAncoras} />
        <No {...props} />
      </>
    );
  });
}

// Tudo o que vai ao <ReactFlow> é constante ou estável: uma prop nova a cada
// renderização (e o canvas renderiza a cada quadro do arraste) faz o React
// Flow atualizar o estado interno e re-renderizar por dentro.
const TIPOS_DE_NO = {
  terminal: NoTerminal,
  rascunho: NoRascunho,
  bixinho: NoBixinho,
  nota: comAlcaDeLigacao(NoNota, true),
  artefato: comAlcaDeLigacao(NoArtefato, true),
  previa: comAlcaDeLigacao(NoPrevia, false),
  shell: NoShell,
} satisfies NodeTypes;
// A linha de um item ligado é a curva padrão, com a pele em `.aresta-ligacao`; a do bixinho, a própria.
const TIPOS_DE_ARESTA = { bixinho: ArestaDoBixinho, ligacao: BezierEdge } satisfies EdgeTypes;
// Enquadrar nunca passa de 100% (o texto dos terminais só fica nítido em zoom
// inteiro) nem desce de 60% (ver `escolherEnquadramento`).
/** Folga do enquadramento ao abrir o canvas. */
const FOLGA_AO_ABRIR = 0.15;
/** Folga do "enquadrar tudo" (controles, paleta). */
const FOLGA_DO_ENQUADRAMENTO = 0.12;
/** Os limites de zoom do canvas: do <ReactFlow> e do zoom por cima das caixas. */
const LIMITES_DO_ZOOM = { minZoom: 0.1, maxZoom: 2 };
const VIEWPORT_PADRAO: Viewport = { x: 0, y: 0, zoom: 1 };
/** Os painéis que abrem logo abaixo da ilha do canto superior esquerdo; só um fica aberto por vez. */
type PainelDaBarra = "subagentes" | "modelos";
/** Nome e dica do botão do minimapa, no canto inferior direito. */
const DICA_DO_MINIMAPA = { mostrar: "Mostrar minimapa", esconder: "Esconder minimapa" } as const;
/**
 * Quanto do pé da área do canvas o chat rápido ocupa (compacto, com a
 * margem): a janela de um artefato aberta "no centro" fica acima dele.
 */
const ALTURA_RESERVADA_AO_CHAT = 110;
/** Altura, na área do canvas, da faixa ocupada pela barra do canvas (com folga). */
const TOPO_LIVRE_DA_TELA_PX = 84;
/**
 * Arrastar no vazio com o botão esquerdo (ou o do meio) move o canvas, como a
 * roda e o trackpad: só a seleção pelo trackpad deixava o mouse sem pan. O
 * retângulo de seleção sai com o Shift segurado (`selectionKeyCode`).
 */
const BOTOES_QUE_MOVEM_O_CANVAS = [0, 1];
/** Shift ou Cmd/Ctrl + clique somam e tiram telas da seleção. */
const TECLAS_DA_SELECAO_MULTIPLA = ["Shift", "Meta", "Control"];

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

/** Esc: limpa a seleção; sem nada selecionado, o mesmo array. */
function limparSelecao(nos: NoDoCanvas[]): NoDoCanvas[] {
  return nos.some((no) => no.selected === true) ? semSelecao(nos) : nos;
}

/** O resumo anterior enquanto a seleção não muda: arrastar o grupo não re-renderiza a barra. */
function mesmoResumo(anterior: ResumoDoGrupo, novo: ResumoDoGrupo): ResumoDoGrupo {
  return mesmoConteudo(anterior, novo) ? anterior : novo;
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

/**
 * O quadro do canvas sem janelas. Mora dentro do <ReactFlow>, na camada 4 (a
 * dos nós): os painéis dele (barra do topo, controles, minimapa e o chat
 * rápido) ficam na 5, então a conversa do chat, que abre para cima, passa por
 * cima do quadro e continua clicável. Fora do <ReactFlow>, que é um contexto
 * de empilhamento próprio, o quadro cobria todos eles.
 */
function CanvasVazio({ aoCriar }: { aoCriar: () => void }) {
  return (
    <div className="camada-do-canvas-vazio canvas-vazio pointer-events-none absolute inset-0 z-[4] grid place-items-center">
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
        <p className="mono text-muted">
          arrastar o fundo move o canvas · shift + arrastar seleciona · ctrl + roda dá zoom
        </p>
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
  // No app desktop não há faixa de título: o fundo das ilhas do topo arrasta a janela. No Mac as
  // bolinhas nativas flutuam à esquerda da ilha do nome; no Windows e no Linux ─ ☐ ✕ vão para a ilha da direita.
  const [desktop] = useState(rodandoNoDesktop);
  const [mac] = useState(rodandoNoMac);
  const areaDoCanvas = useRef<HTMLDivElement>(null);
  // Modo invisível: só o header e o chat rápido ficam; o resto é escondido por CSS (nada é desmontado).
  const { ativo: modoInvisivel } = useModoInvisivel();
  useEffect(() => {
    document.documentElement.classList.toggle("modo-invisivel", modoInvisivel);
    return () => document.documentElement.classList.remove("modo-invisivel");
  }, [modoInvisivel]);
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
      // Arrastar o terminal leva junto os itens ligados só a ele.
      aoMudarNos(comItensLigadosJunto(mudancas, fluxo.getNodes()));
      if (mudancas.some((mudanca) => mudanca.type === "dimensions" && mudanca.resizing === true)) {
        setRedimensionando(true);
      }
      // Fim de um redimensionamento (o React Flow manda `resizing: false` só ao soltar a alça).
      if (mudancas.some((mudanca) => mudanca.type === "dimensions" && mudanca.resizing === false)) {
        setRedimensionando(false);
        reacomodar();
      }
    },
    [aoMudarNos, reacomodar, fluxo],
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
  // Chat fixo à esquerda ou à direita (painel Configurações do ⚙ ou o botão do próprio chat).
  // No modo invisível ele volta a ser o painel flutuante do pé (a coluna da altura
  // toda cobriria os apps de trás); a preferência salva não muda.
  const { preferencias: preferenciasDaTela, mudarPreferencias: mudarPreferenciasDaTela } = usePreferenciasDaTela();
  const chatFixo = preferenciasDaTela.chatFixoNaEsquerda && !modoInvisivel;
  const ladoDoChatFixo = preferenciasDaTela.ladoDoChatFixo;
  const larguraDoChatFixo = preferenciasDaTela.larguraDoChatFixo;
  // O minimapa vem recolhido; o botão do canto inferior direito o mostra e esconde.
  const minimapaVisivel = preferenciasDaTela.minimapaVisivel;
  // Limpar lê as conversas por aqui, para as ações do canvas não mudarem a cada evento.
  const conversasAtuais = useRef(conversas);

  useEffect(() => {
    conversasAtuais.current = conversas;
  }, [conversas]);

  // Os bixinhos de quem conclui ou é cancelado saem sozinhos (a menos que a
  // preferência peça para manter), pelo mesmo caminho do "limpar": os limpos
  // ficam guardados e não voltam ao recarregar. Depois do efeito acima: a
  // limpeza feita na hora já lê as conversas deste render.
  const limparBixinhosQueSairam = useCallback(
    (orquestradorId: string, subagenteIds: readonly string[]) =>
      setBixinhosLimpos((atuais) => {
        const limpos = limparBixinhos(
          conversasAtuais.current.get(orquestradorId),
          atuais.get(orquestradorId),
          new Set(subagenteIds),
        );
        return limpos === null ? atuais : new Map(atuais).set(orquestradorId, limpos);
      }),
    [],
  );
  const bixinhosSaindo = useSaidaDosBixinhos({
    conversas,
    bixinhosLimpos,
    manter: preferenciasDaTela.manterBixinhosAteLimpar,
    limpar: limparBixinhosQueSairam,
  });

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
    () => [
      ...arestasDosBixinhos(ligados, conversas, bixinhosSaindo),
      ...arestasDasPrevias(ligados),
      ...arestasDosShells(ligados),
    ],
    [ligados, conversas, bixinhosSaindo],
  );
  // As linhas dos itens ligados acompanham o lado de cada item a cada quadro (são poucas); a
  // reaproveitada só muda quando alguma delas troca de lado, nasce, some ou é selecionada.
  const [ligacaoSelecionada, setLigacaoSelecionada] = useState<string | null>(null);
  const arestas = useReaproveitado(
    [...arestasCalculadas, ...arestasDasLigacoes(nos, ligacaoSelecionada)],
    reaproveitarArestas,
  );

  // Puxar a linha de uma nota, prévia ou artefato até um terminal os liga; repetida, nada muda.
  const aoLigar = useCallback((conexao: Connection) => setNos((atuais) => ligarItem(atuais, conexao)), [setNos]);
  const ligacaoValida = useCallback<IsValidConnection<ArestaDoCanvas>>(
    (conexao) => ehLigacaoValida(conexao, fluxo.getNodes()),
    [fluxo],
  );
  // Só as linhas dos itens ligados se selecionam; a seleção fica aqui, porque as linhas são calculadas.
  const aoMudarArestas = useCallback((mudancas: EdgeChange<ArestaDoCanvas>[]) => {
    for (const mudanca of mudancas) {
      if (mudanca.type === "select") {
        setLigacaoSelecionada((atual) => (mudanca.selected ? mudanca.id : atual === mudanca.id ? null : atual));
      }
    }
  }, []);
  // Uma nota apagada, ou uma prévia ou um artefato fechados, saem dos terminais a que estavam ligados.
  const idsLigaveis = nos
    .filter(ehItemLigavel)
    .map((no) => no.id)
    .join("\n");
  useEffect(() => {
    setNos(semLigacoesOrfas);
  }, [idsLigaveis, setNos]);
  // Delete ou Backspace desligam a linha selecionada (com o foco num campo, a tecla é dele); Esc a desmarca.
  useEffect(() => {
    if (ligacaoSelecionada === null) {
      return;
    }
    const aoApertarTecla = (evento: KeyboardEvent) => {
      if (evento.defaultPrevented || focoEmCampoDeTexto(evento.target)) {
        return;
      }
      if (evento.key === "Escape") {
        setLigacaoSelecionada(null);
        return;
      }
      if (evento.key !== "Delete" && evento.key !== "Backspace") {
        return;
      }
      evento.preventDefault();
      const ligacao = lerIdDaLigacao(ligacaoSelecionada, fluxo.getNodes());
      if (ligacao !== null) {
        setNos((atuais) => desligarItem(atuais, ligacao.terminalId, ligacao.itemId));
      }
      setLigacaoSelecionada(null);
    };
    window.addEventListener("keydown", aoApertarTecla);
    return () => window.removeEventListener("keydown", aoApertarTecla);
  }, [ligacaoSelecionada, fluxo, setNos]);

  // O centro da área do canvas.
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
  // Uma resposta do chat arrastada para o canvas vira uma nota com o texto dela
  // (sem a marcação do Markdown), onde foi solta.
  const aoArrastarSobreOCanvas = useCallback((evento: DragEvent) => {
    if (evento.dataTransfer.types.includes(TIPO_DA_RESPOSTA_DO_CHAT)) {
      evento.preventDefault();
      evento.dataTransfer.dropEffect = "copy";
    }
  }, []);
  const aoSoltarNoCanvas = useCallback(
    (evento: DragEvent) => {
      const texto = evento.dataTransfer.getData(TIPO_DA_RESPOSTA_DO_CHAT);
      if (texto === "") {
        return;
      }
      evento.preventDefault();
      void criarNota(
        // A nota guarda até 100.000 caracteres.
        { titulo: "Resposta do chat", texto: markdownParaTexto(texto).slice(0, 100_000) },
        fluxo.screenToFlowPosition({ x: evento.clientX, y: evento.clientY }),
      );
    },
    [criarNota, fluxo],
  );

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
   * Com o chat fixo ao lado, fora da área, é o próprio centro.
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

  /**
   * O ponto único de abrir o terminal de um Orquestrador (cartão do chat, Doca
   * e paleta). Já aberto, só fica selecionado e a câmera vai até ele; fechado,
   * abre selecionado na primeira área livre perto do centro da vista, sem
   * cobrir terminais, notas, prévias, artefatos nem bixinhos.
   */
  const abrirTerminal = useCallback(
    (orquestradorId: string) => {
      // Já aberto sempre cabe: só ganha o foco.
      if (!reservarVaga(orquestradorId)) {
        return;
      }
      setNos((atuais) => {
        // O lugar de partida: centralizado na vista, com a barra de título abaixo da barra do canvas.
        const inicio = posicaoNoCentroVisivel([], TAMANHO_DO_TERMINAL);
        const posicao = posicaoDoTerminalNovo(atuais, orquestradorId, inicio, TAMANHO_DO_TERMINAL);
        if (posicao === null) {
          const jaSelecionado = atuais.every((no) => (no.selected === true) === (no.id === orquestradorId));
          return jaSelecionado
            ? atuais
            : atuais.map((no) =>
                no.id === orquestradorId ? { ...no, selected: true } : no.selected === true ? { ...no, selected: false } : no,
              );
        }
        const terminal = novoTerminal(orquestradorId, posicao, TAMANHO_DO_TERMINAL.largura, TAMANHO_DO_TERMINAL.altura);
        return reacomodarBixinhos([...semSelecao(atuais), { ...terminal, selected: true }]);
      });
      focar(orquestradorId);
    },
    [focar, posicaoNoCentroVisivel, reservarVaga, setNos],
  );

  const fecharTerminal = useCallback(
    (orquestradorId: string) => setNos((atuais) => semTerminal(atuais, orquestradorId)),
    [setNos],
  );

  // Como a nota: o nó fica só com a altura da barra, e as linhas dos bixinhos seguem a âncora.
  const minimizarOuRestaurarTerminal = useCallback(
    (orquestradorId: string) =>
      setNos((atuais) =>
        reacomodarBixinhos(
          atuais.map((no) => (ehTerminal(no) && no.id === orquestradorId ? minimizarOuRestaurar(no) : no)),
        ),
      ),
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

  // Fim do retângulo de seleção: os bixinhos pegos junto saem dela (seguem o terminal).
  const aoTerminarSelecao = useCallback(() => setNos(semBixinhosNaSelecao), [setNos]);

  /**
   * Move as telas selecionadas para onde `posicionar` mandar, sem cobrir as
   * telas de fora da seleção (`outras`), e tira os bixinhos de baixo delas.
   */
  const moverGrupo = useCallback(
    (posicionar: (janelas: readonly JanelaNoCanvas[], outras: readonly JanelaNoCanvas[]) => Record<string, Ponto>) =>
      setNos((atuais) => {
        const janelas = telasSelecionadas(atuais).map(janelaVisivel);
        if (janelas.length < 2) {
          return atuais;
        }
        const novos = comPosicoes(atuais, posicionar(janelas, outrasTelas(atuais)));
        return novos === atuais ? atuais : reacomodarBixinhos(novos);
      }),
    [setNos],
  );
  const alinharGrupo = useCallback(
    (como: Alinhamento) => moverGrupo((janelas, outras) => alinharJanelas(janelas, como, outras)),
    [moverGrupo],
  );
  const distribuirGrupo = useCallback(
    (eixo: EixoDaDistribuicao) => moverGrupo((janelas, outras) => distribuirJanelas(janelas, eixo, outras)),
    [moverGrupo],
  );
  const porGrupoLadoALado = useCallback(
    () => moverGrupo((janelas, outras) => janelasLadoALado(janelas, MARGEM_DO_LADO_A_LADO, outras)),
    [moverGrupo],
  );
  const minimizarGrupo = useCallback(
    () =>
      setNos((atuais) => {
        const novos = minimizarOuRestaurarTelas(atuais, new Set(telasSelecionadas(atuais).map((no) => no.id)));
        return novos === atuais ? atuais : reacomodarBixinhos(novos);
      }),
    [setNos],
  );
  /**
   * "Fechar" da barra do grupo (a barra já confirmou): cada tela sai pelo
   * caminho do ✕ dela. Terminais, artefatos e prévias só saem do canvas; o
   * shell é encerrado. Notas e rascunhos ficam (`ehFechavelEmGrupo`).
   */
  const fecharGrupo = useCallback(() => {
    for (const no of telasSelecionadas(nosAtuais.current).filter(ehFechavelEmGrupo)) {
      if (ehTerminal(no)) {
        fecharTerminal(no.id);
      } else if (ehArtefato(no)) {
        acoesDosArtefatos.fechar(no.data.artefatoId);
      } else if (ehPrevia(no)) {
        fecharPrevia(no.data.previaId);
      } else if (ehShell(no)) {
        fecharShell(no.data.shellId);
      }
    }
  }, [acoesDosArtefatos, fecharPrevia, fecharShell, fecharTerminal]);

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

  // Os Ajustes do app desktop, pela paleta e pelas Configurações; a falha aparece abaixo da ilha do canto superior esquerdo.
  const ajustes = useAjustesDoAplicativo();
  const {
    disponivel: ajustesDisponiveis,
    abrir: abrirAjustes,
    erro: erroDosAjustes,
    descartarErro: descartarErroDosAjustes,
  } = ajustes;

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

  // O × do chip no terminal e o que vai no próximo pedido (lido na hora, das lojas e dos nós).
  const desligarItemDoTerminal = useCallback(
    (orquestradorId: string, itemId: string) => setNos((atuais) => desligarItem(atuais, orquestradorId, itemId)),
    [setNos],
  );
  const lerItensLigados = useCallback(
    (orquestradorId: string) =>
      itensLigadosParaEnvio(fluxo.getNodes(), orquestradorId, {
        lerNota: lojaDasNotas.ler,
        lerArtefato: lojaDosArtefatos.ler,
      }),
    [fluxo, lojaDasNotas, lojaDosArtefatos],
  );

  const acoes = useMemo<AcoesDoCanvas>(
    () => ({
      abrirTerminal,
      fecharTerminal,
      minimizarOuRestaurarTerminal,
      limparBixinhos: limparBixinhosDoTerminal,
      orquestradorCriado,
      descartarRascunho,
      mudarEscalaDaLetra,
      recarregar,
      abrirPrevia,
      navegarPrevia,
      minimizarOuRestaurarPrevia,
      fecharPrevia,
      desligarItem: desligarItemDoTerminal,
      lerItensLigados,
    }),
    [
      abrirTerminal,
      fecharTerminal,
      minimizarOuRestaurarTerminal,
      limparBixinhosDoTerminal,
      orquestradorCriado,
      descartarRascunho,
      mudarEscalaDaLetra,
      recarregar,
      abrirPrevia,
      navegarPrevia,
      minimizarOuRestaurarPrevia,
      fecharPrevia,
      desligarItemDoTerminal,
      lerItensLigados,
    ],
  );
  // Os nós só leem do servidor a conexão e a memória por Orquestrador: a
  // memória livre do computador, que muda a cada leitura, não os re-renderiza.
  const servidorDosNos = useReaproveitado(servidor, servidorParaOsNos);
  // Não depende de `nos`: arrastar e mover o canvas não trocam o valor.
  const valor = useMemo<ValorDoCanvas>(
    () => ({
      orquestradores: porId,
      conversas,
      conexoes,
      sinais,
      bixinhosLimpos,
      bixinhosSaindo,
      servidor: servidorDosNos,
      acoes,
    }),
    [porId, conversas, conexoes, sinais, bixinhosLimpos, bixinhosSaindo, servidorDosNos, acoes],
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
  const abrirPainel = useCallback((painel: PainelDaBarra) => setPainelAberto(painel), []);
  const fecharPainel = useCallback(() => setPainelAberto(null), []);
  // As Configurações (painel de 540 px à direita): a aba pedida e um número por pedido, que remonta o painel na aba certa.
  // O topo das Configurações: abaixo das notificações empilhadas (null: sem pilha, o padrão do painel).
  const [topoDasConfiguracoes, setTopoDasConfiguracoes] = useState<number | null>(null);
  const [configuracoes, setConfiguracoes] = useState<{ aba: AbaDasConfiguracoes | undefined; pedido: number } | null>(
    null,
  );
  const abrirConfiguracoes = useCallback((aba?: AbaDasConfiguracoes) => {
    setConfiguracoes((atual) => ({ aba, pedido: (atual?.pedido ?? 0) + 1 }));
  }, []);
  /** A engrenagem e o anel de memória: abrem as Configurações; um segundo clique na mesma aba as fecha. */
  const alternarConfiguracoes = useCallback((aba?: AbaDasConfiguracoes) => {
    setConfiguracoes((atual) =>
      atual !== null && atual.aba === aba ? null : { aba, pedido: (atual?.pedido ?? 0) + 1 },
    );
  }, []);
  const fecharConfiguracoes = useCallback(() => setConfiguracoes(null), []);
  const verSistema = useCallback(() => abrirConfiguracoes("sistema"), [abrirConfiguracoes]);
  // A barra de desenho (o "Desenhar" dos controles); o desenho em si é da `CamadaDeDesenho`.
  const [desenhoAberto, setDesenhoAberto] = useState(false);
  const alternarDesenho = useCallback(() => setDesenhoAberto((aberto) => !aberto), []);
  const fecharDesenho = useCallback(() => setDesenhoAberto(false), []);

  // Cmd/Ctrl + A seleciona todas as telas (sem os bixinhos) e Esc limpa a
  // seleção; com o foco num campo de texto, os dois são do campo.
  useEffect(() => {
    const aoApertarTecla = (evento: KeyboardEvent) => {
      if (evento.defaultPrevented || focoEmCampoDeTexto(evento.target) || evento.altKey || evento.shiftKey) {
        return;
      }
      const comComando = evento.metaKey || evento.ctrlKey;
      if (comComando && (evento.code === "KeyA" || evento.key === "a" || evento.key === "A")) {
        evento.preventDefault();
        setNos(selecionarTodasAsTelas);
        return;
      }
      // Com um painel da barra ou o navegador de pastas aberto, o Esc é deles.
      if (evento.key !== "Escape" || comComando || painelAberto !== null || escolhendoPastaDoShell) {
        return;
      }
      // Decide depois de todos os ouvintes: o Esc que um menu, um painel ou a
      // tela cheia do terminal já usou (preventDefault) não limpa a seleção.
      setTimeout(() => {
        if (!evento.defaultPrevented) {
          setNos(limparSelecao);
        }
      }, 0);
    };
    window.addEventListener("keydown", aoApertarTecla);
    return () => window.removeEventListener("keydown", aoApertarTecla);
  }, [setNos, painelAberto, escolhendoPastaDoShell]);

  // Modelos de canvas (item 35): "Salvar como modelo" na barra do grupo lê a
  // seleção na hora; o painel Modelos recria um modelo perto do centro da tela.
  const [arranjoDoModelo, setArranjoDoModelo] = useState<ArranjoDaSelecao | null>(null);
  // Muda a cada modelo salvo: o painel Modelos remonta e relê a lista.
  const [versaoDosModelos, setVersaoDosModelos] = useState(0);
  const salvarComoModelo = useCallback(() => {
    setArranjoDoModelo(
      arranjoDaSelecao(nosAtuais.current, {
        orquestrador: (id) => orquestradoresAtuais.current?.find((orquestrador) => orquestrador.id === id),
        nota: (notaId) => lojaDasNotas.ler(notaId) ?? null,
      }),
    );
  }, [lojaDasNotas]);
  const fecharDialogoDoModelo = useCallback(() => setArranjoDoModelo(null), []);
  const salvarModelo = useCallback(async (conteudo: ConteudoDoModeloDeCanvas) => {
    await api.criarModeloDeCanvas(conteudo);
    setArranjoDoModelo(null);
    setVersaoDosModelos((versao) => versao + 1);
    setPainelAberto("modelos");
  }, []);

  const { mostrarNota } = notas;
  /**
   * Recria o modelo item a item, com o canto do arranjo no lugar livre mais
   * perto do centro da tela. Os orquestradores nascem parados (nenhum turno,
   * nenhuma mensagem) e os terminais abrem o shell na pasta, sem rodar nem
   * digitar o comando guardado. O erro de um item não para os outros.
   */
  const recriarModelo = useCallback(
    async (modelo: ConteudoDoModeloDeCanvas, pasta: string | null) => {
      const tamanho = tamanhoDoArranjo(modelo.itens);
      const centro = centroDaTela();
      const origem = posicaoLivrePerto(
        { x: Math.round(centro.x - tamanho.largura / 2), y: Math.round(centro.y - tamanho.altura / 2) },
        tamanho,
        areasOcupadas(nosAtuais.current).map((area) => area.retangulo),
      );
      // Os terminais abertos agora: a vaga confere com eles antes do próximo render.
      const terminaisNovos: string[] = [];
      // Recriar ao lado do original não repete o nome: "API" vira "API 2", como no cartão do chat.
      const nomesUsados = (orquestradoresAtuais.current ?? []).map((orquestrador) => orquestrador.nome);
      const resultados = await recriarItens(modelo.itens, origem, pasta, {
        orquestrador: async (item, lugar, pastaDoItem) => {
          const atuais = nosAtuais.current;
          const vaga = cabeOutroTerminal(
            [...new Set([...atuais.filter(ehTerminal).map((no) => no.data.orquestradorId), ...terminaisNovos])],
            atuais.filter((no) => no.type === "rascunho").map((no) => no.id),
            null,
          );
          if (!vaga) {
            throw new Error(AVISO_DO_LIMITE_DE_ORQUESTRADORES);
          }
          const nome = nomeLivre(item.nome, nomesUsados);
          const criado = await api.criarOrquestrador({
            ...CONFIGURACAO_PADRAO_DO_ORQUESTRADOR,
            ...item.configuracao,
            nome,
            pastaDeTrabalho: pastaDoItem,
          });
          nomesUsados.push(nome);
          criadosAgora.current.add(criado.id);
          terminaisNovos.push(criado.id);
          const terminal = novoTerminal(criado.id, lugar, lugar.largura, lugar.altura);
          setNos((atuais) => [...atuais, terminal]);
          return terminal.id;
        },
        nota: async (item, lugar) => {
          const nota = await api.criarNota({ titulo: item.titulo, texto: item.texto });
          return mostrarNota(nota, lugar, lugar);
        },
        previa: (item, lugar) => {
          const previa = novaPrevia(crypto.randomUUID(), lugar, { url: item.url, orquestradorId: null }, lugar.largura, lugar.altura);
          setNos((atuais) => [...atuais, previa]);
          return Promise.resolve(previa.id);
        },
        terminal: async (_item, lugar, pastaDoItem) => {
          const criado = await api.criarShell({ pasta: pastaDoItem, ...TAMANHO_INICIAL_DO_SHELL });
          const shell = novoShell(
            crypto.randomUUID(),
            lugar,
            { terminalId: criado.id, pasta: criado.pasta, orquestradorId: null },
            lugar.largura,
            lugar.altura,
          );
          setNos((atuais) => [...atuais, shell]);
          return shell.id;
        },
      });
      const novos = new Set(resultados.flatMap((resultado) => (resultado.noId === null ? [] : [resultado.noId])));
      if (novos.size > 0) {
        // Os itens recriados ficam selecionados, prontos para arrastar juntos.
        setNos((atuais) =>
          reacomodarBixinhos(
            atuais.map((no) => (no.selected === true || novos.has(no.id) ? { ...no, selected: novos.has(no.id) } : no)),
          ),
        );
        enquadrarSemAproximar([...novos]);
      }
      if (terminaisNovos.length > 0) {
        void recarregar();
      }
      return resultados;
    },
    [centroDaTela, enquadrarSemAproximar, mostrarNota, recarregar, setNos],
  );

  // A barra do grupo, com duas ou mais telas selecionadas: o resumo só muda
  // com a seleção (ou o minimizar), então arrastar o grupo não a re-renderiza.
  const resumoDoGrupo = useReaproveitado(resumirGrupo(nos), mesmoResumo);
  const barraDoGrupo = useMemo(
    () =>
      resumoDoGrupo.ids.length < 2 ? null : (
        <Panel
          position="top-center"
          className="painel-da-barra-do-grupo"
        >
          <BarraDoGrupo
            resumo={resumoDoGrupo}
            aoAlinhar={alinharGrupo}
            aoDistribuir={distribuirGrupo}
            aoPorLadoALado={porGrupoLadoALado}
            aoMinimizar={minimizarGrupo}
            aoFechar={fecharGrupo}
            aoSalvarComoModelo={salvarComoModelo}
          />
        </Panel>
      ),
    [
      resumoDoGrupo,
      alinharGrupo,
      distribuirGrupo,
      porGrupoLadoALado,
      minimizarGrupo,
      fecharGrupo,
      salvarComoModelo,
    ],
  );

  // Os subagentes prontos do submenu "Subagentes ›". Com o servidor fora, a lista
  // fica vazia de dados até ele voltar (o efeito roda de novo na reconexão).
  const [subagentesProntos, setSubagentesProntos] = useState<DadosDoSubagentePronto[] | null>(null);
  const lerSubagentesProntos = useCallback(() => {
    api
      .lerPreferencias()
      .then((preferencias) => setSubagentesProntos(preferencias.subagentesProntos))
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    if (servidor.conectado) {
      lerSubagentesProntos();
    } else {
      setSubagentesProntos(null);
    }
  }, [servidor.conectado, lerSubagentesProntos]);
  // A biblioteca também muda pelo cartão do chat, fora dos painéis.
  useEffect(() => aoMudarSubagentesProntos(lerSubagentesProntos), [lerSubagentesProntos]);
  // Salvar qualquer um dos painéis: os indicadores dos terminais e a lista podem ter mudado.
  const aoSalvarPainel = useCallback(() => {
    void recarregar();
    lerSubagentesProntos();
  }, [recarregar, lerSubagentesProntos]);

  /** Escolher no submenu Orquestradores: abre se preciso, leva a câmera, seleciona, traz para frente e foca o pedido. */
  const focarOrquestrador = useCallback(
    (orquestradorId: string) => {
      abrirTerminal(orquestradorId);
      // O nó pode acabar de nascer: espera o React Flow medi-lo, como o `focar`.
      setTimeout(() => {
        const campo = document.querySelector<HTMLTextAreaElement>(
          `.react-flow__node[data-id="${CSS.escape(orquestradorId)}"] .prompt-do-terminal textarea`,
        );
        campo?.focus({ preventScroll: true });
      }, ESPERA_PARA_MEDIR_MS + 60);
    },
    [abrirTerminal],
  );
  const abrirPainelDeSubagentes = useCallback(() => abrirPainel("subagentes"), [abrirPainel]);
  const abrirPainelDeModelos = useCallback(() => abrirPainel("modelos"), [abrirPainel]);
  const abrirConfiguracoesPadrao = useCallback(() => abrirConfiguracoes(), [abrirConfiguracoes]);

  // Os painéis não dependem da posição dos nós: memorizados, não re-renderizam
  // a cada quadro do arraste. A coluna da esquerda é a ilha do nome com o `+ Novo`
  // e, logo abaixo, os painéis que abriam da barra antiga (subagentes e modelos) e os avisos.
  const colunaDaEsquerda = useMemo(
    () => (
      <div className={`coluna-da-ilha-esquerda ${mac ? "coluna-da-ilha-esquerda-mac" : ""}`}>
        <IlhaDoNome
          aoCriar={novoOrquestrador}
          aoCriarNota={novaNota}
          aoCriarPrevia={novaPreviaVazia}
          aoCriarShell={pedirPastaDoShell}
          aoAbrirModelos={abrirPainelDeModelos}
          aoBuscar={abrirPaleta}
          aoAbrirConfiguracoes={abrirConfiguracoesPadrao}
          orquestradores={orquestradores}
          erroDosOrquestradores={erro}
          noCanvas={noCanvas}
          aoEscolherOrquestrador={focarOrquestrador}
          subagentes={subagentesProntos}
          aoAbrirSubagentes={abrirPainelDeSubagentes}
        />
        {painelAberto === "subagentes" && <PainelDeSubagentes aoFechar={fecharPainel} aoSalvar={aoSalvarPainel} />}
        {painelAberto === "modelos" && (
          <PainelDeModelos key={versaoDosModelos} aoFechar={fecharPainel} aoRecriar={recriarModelo} />
        )}
        {avisoDoLimite && (
          <ErroDoCanvas erro={AVISO_DO_LIMITE_DE_ORQUESTRADORES} aoFechar={fecharAvisoDoLimite} nivel="aviso" />
        )}
        {erroDasNotas !== null && <ErroDoCanvas erro={erroDasNotas} aoFechar={descartarErroDasNotas} />}
        {erroDosAjustes !== null && <ErroDoCanvas erro={erroDosAjustes} aoFechar={descartarErroDosAjustes} />}
        {erroDosShells !== null && (
          <ErroDoCanvas erro={erroDosShells.mensagem} aoFechar={descartarErroDosShells} nivel={erroDosShells.nivel} />
        )}
      </div>
    ),
    [
      mac,
      novoOrquestrador,
      novaNota,
      novaPreviaVazia,
      pedirPastaDoShell,
      abrirPainelDeModelos,
      abrirPaleta,
      abrirConfiguracoesPadrao,
      orquestradores,
      erro,
      noCanvas,
      focarOrquestrador,
      subagentesProntos,
      abrirPainelDeSubagentes,
      painelAberto,
      fecharPainel,
      aoSalvarPainel,
      versaoDosModelos,
      recriarModelo,
      avisoDoLimite,
      fecharAvisoDoLimite,
      erroDasNotas,
      descartarErroDasNotas,
      erroDosAjustes,
      descartarErroDosAjustes,
      erroDosShells,
      descartarErroDosShells,
    ],
  );
  // A ilha vertical do canto inferior esquerdo (zoom, ajustar, organizar e desenhar): as
  // mesmas funções dos antigos controles do React Flow. Memorizada: com uma prop nova a
  // cada render, ela re-renderizaria a cada quadro do arraste.
  const ilhaDeFerramentas = useMemo(
    () => (
      <IlhaDeFerramentas
        aoEnquadrar={enquadrarTudo}
        aoOrganizar={organizar}
        podeOrganizar={podeOrganizar}
        aoAlternarDesenho={alternarDesenho}
        desenhoAberto={desenhoAberto}
      />
    ),
    [enquadrarTudo, organizar, podeOrganizar, alternarDesenho, desenhoAberto],
  );
  // O minimapa (recolhido por padrão) e, no canto, o botão que o mostra e
  // esconde, com a pele dos controles. O minimapa aberto fica acima do botão.
  const alternarMinimapa = useCallback(
    () => mudarPreferenciasDaTela({ minimapaVisivel: !minimapaVisivel }),
    [mudarPreferenciasDaTela, minimapaVisivel],
  );
  const minimapa = useMemo(() => {
    const dica = minimapaVisivel ? DICA_DO_MINIMAPA.esconder : DICA_DO_MINIMAPA.mostrar;
    return (
      <>
        {minimapaVisivel && (
          <MiniMap<NoDoCanvas>
            position="bottom-right"
            className="minimapa-do-canvas"
            pannable
            zoomable
            nodeClassName={classeDoMinimapa}
          />
        )}
        <Controls
          position="bottom-right"
          className="controles-do-minimapa"
          aria-label="Minimapa"
          showZoom={false}
          showFitView={false}
          showInteractive={false}
        >
          <ControlButton onClick={alternarMinimapa} aria-pressed={minimapaVisivel} title={dica} aria-label={dica}>
            <IconeMinimapa />
          </ControlButton>
        </Controls>
      </>
    );
  }, [minimapaVisivel, classeDoMinimapa, alternarMinimapa]);
  // A ilha do canto superior direito e as notificações abaixo dela.
  const ilhaDaDireita = useMemo(
    () => (
      <>
        <div className="aviso-de-conexao-das-ilhas">
          <AvisoDeConexao servidor={servidor} />
        </div>
        <IlhaDaDireita
          aoBuscar={abrirPaleta}
          trabalhando={trabalhando}
          memoria={servidor.memoria}
          aoAlternarConfiguracoes={alternarConfiguracoes}
          configuracoesAbertas={configuracoes !== null}
          abaAberta={configuracoes?.aba ?? null}
          controlesDaJanela={desktop && !mac}
        />
        <NotificacoesDoCanvas
          memoria={servidor.memoria}
          cota={cota}
          aoVerSistema={verSistema}
          pedidosEmAndamento={pedidosEmAndamento}
          aoMedirTopoLivre={setTopoDasConfiguracoes}
        />
      </>
    ),
    [
      servidor,
      abrirPaleta,
      trabalhando,
      alternarConfiguracoes,
      configuracoes,
      cota,
      verSistema,
      pedidosEmAndamento,
      desktop,
      mac,
    ],
  );
  // Todas as ilhas moram na área do canvas, dentro do <ReactFlow> mas fora do viewport.
  const ilhas = useMemo(
    () => (
      <div className="ilhas-do-canvas">
        {colunaDaEsquerda}
        {ilhaDaDireita}
        {ilhaDeFerramentas}
      </div>
    ),
    [colunaDaEsquerda, ilhaDaDireita, ilhaDeFerramentas],
  );
  // O conteúdo da aba Sistema das Configurações: situação, cotas e RAM.
  const sistemaDasConfiguracoes = useMemo(
    () => (
      <StatusDoCanvas trabalhando={trabalhando} bixinhosAtivos={bixinhosAtivos} cota={cota} memoria={servidor.memoria} />
    ),
    [trabalhando, bixinhosAtivos, cota, servidor.memoria],
  );
  // Os orquestradores como a aba Sistema das Configurações os lista (a tabela de memória por orquestrador).
  const orquestradoresDasConfiguracoes = useMemo(
    () => (orquestradores ?? []).map(({ id, nome, situacao }) => ({ id, nome, situacao })),
    [orquestradores],
  );
  // Fora do viewport: o chat não se move com o canvas e só re-renderiza com novidades dele.
  // Fixo (preferência da tela), vira uma coluna ao lado da área do canvas, do lado escolhido;
  // senão, fica no painel do centro de baixo, dentro do React Flow.
  // O "ocultar" da coluna solta o chat embaixo já oculto; o chat é remontado ao trocar de modo, então o pedido vai por prop.
  const [chatSoltoOculto, setChatSoltoOculto] = useState(false);
  // Fixado de novo (por qualquer caminho), o pedido de ocultar acaba: um soltar posterior volta com a conversa à vista.
  useEffect(() => {
    if (chatFixo) {
      setChatSoltoOculto(false);
    }
  }, [chatFixo]);
  const alternarChatFixo = useCallback(
    (fixo: boolean, ocultar = false) => {
      setChatSoltoOculto(!fixo && ocultar);
      mudarPreferenciasDaTela({ chatFixoNaEsquerda: fixo });
    },
    [mudarPreferenciasDaTela],
  );
  // Os cartões de ação do chat mostram o estado de quem vai receber o pedido.
  const orquestradoresDoChat = useMemo(() => orquestradores ?? [], [orquestradores]);
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
        orquestradores={orquestradoresDoChat}
        fixo={chatFixo}
        lado={ladoDoChatFixo}
        // No modo invisível não dá para fixar: o chat fica flutuante até sair dele.
        aoAlternarFixo={modoInvisivel ? undefined : alternarChatFixo}
        comecaOculto={chatSoltoOculto}
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
      orquestradoresDoChat,
      chatFixo,
      modoInvisivel,
      ladoDoChatFixo,
      alternarChatFixo,
      chatSoltoOculto,
      larguraDoChatFixo,
      mudarLarguraDoChat,
    ],
  );
  const painelDoChat = useMemo(
    () =>
      chatFixo ? null : (
        // Com o desenho ativo, a barra de chat sai da frente da ilha de desenho (CSS).
        <Panel
          position="bottom-center"
          className={`painel-do-chat ${desenhoAberto ? "painel-do-chat-com-desenho" : ""}`}
        >
          {chatRapido}
        </Panel>
      ),
    [chatFixo, chatRapido, desenhoAberto],
  );

  return (
    <ProvedorDoCanvas valor={valor}>
      <ProvedorDasNotas valor={notas.valor}>
        <ProvedorDosArtefatos valor={valorDosArtefatos}>
          <ProvedorDosShells valor={valorDosShells}>
            {/* App desktop: faixa invisível que arrasta a janela; antes de tudo no DOM para o no-drag dos demais recortá-la. */}
            {desktop && <FaixaDeArrasto />}
            <div
              className={`flex h-screen w-screen flex-col ${servidor.conectado ? "" : "canvas-desconectado"} ${movimento.movendo ? "canvas-movendo" : ""} ${redimensionando ? "canvas-redimensionando" : ""} ${modoInvisivel ? "canvas-modo-invisivel" : ""}`}
            >
              {/* Linha: o chat fixo (quando a preferência pede) empurra a área do canvas para o outro lado. */}
              <div className="flex min-h-0 w-full flex-1">
                {chatFixo && ladoDoChatFixo === "esquerda" && chatRapido}
                <div ref={areaDoCanvas} className="area-do-canvas relative min-h-0 min-w-0 flex-1">
                  <ReactFlow<NoDoCanvas, ArestaDoCanvas>
                    nodes={nos}
                    edges={arestas}
                    nodeTypes={TIPOS_DE_NO}
                    edgeTypes={TIPOS_DE_ARESTA}
                    onNodesChange={aoMudarNosEReacomodar}
                    onEdgesChange={aoMudarArestas}
                    onConnect={aoLigar}
                    isValidConnection={ligacaoValida}
                    onNodeDragStart={movimento.aoComecarArraste}
                    onNodeDragStop={aoSoltarNo}
                    onSelectionDragStart={movimento.aoComecarArraste}
                    onSelectionDragStop={aoSoltarNo}
                    onSelectionEnd={aoTerminarSelecao}
                    onMoveStart={movimento.aoComecarMovimento}
                    onMoveEnd={movimento.aoTerminarMovimento}
                    colorMode="dark"
                    defaultViewport={layoutInicial.viewport ?? VIEWPORT_PADRAO}
                    minZoom={LIMITES_DO_ZOOM.minZoom}
                    maxZoom={LIMITES_DO_ZOOM.maxZoom}
                    // Como no Excalidraw: a roda do mouse rola o canvas; com Ctrl, dá zoom.
                    panOnScroll
                    zoomActivationKeyCode="Control"
                    // Arrastar no vazio move o canvas; com o Shift segurado, desenha o
                    // retângulo de seleção (a tela que ele toca já entra).
                    selectionKeyCode="Shift"
                    selectionMode={SelectionMode.Partial}
                    panOnDrag={BOTOES_QUE_MOVEM_O_CANVAS}
                    panActivationKeyCode="Space"
                    multiSelectionKeyCode={TECLAS_DA_SELECAO_MULTIPLA}
                    deleteKeyCode={null}
                    onDragOver={aoArrastarSobreOCanvas}
                    onDrop={aoSoltarNoCanvas}
                  >
                    <Background variant={BackgroundVariant.Dots} gap={24} size={1.4} />
                    {/* Por cima das janelas e abaixo dos painéis; a barra de desenho vem com ela. */}
                    <CamadaDeDesenho
                      aberta={desenhoAberto}
                      aoFechar={fecharDesenho}
                      tracosIniciais={layoutInicial.desenho}
                    />
                    {/* Abaixo dos painéis (inclusive o chat); some enquanto um painel da barra está aberto. */}
                    {quantidadeDeJanelas === 0 && painelAberto === null && <CanvasVazio aoCriar={novoOrquestrador} />}
                    {minimapa}
                    {ilhas}
                    {barraDoGrupo}
                    {painelDoChat}
                  </ReactFlow>
                  {/* As Configurações se posicionam sozinhas à direita da área do canvas, abaixo das notificações. */}
                  <div className="camada-das-configuracoes">
                    <ConfiguracoesDoApp
                      key={configuracoes?.pedido ?? 0}
                      ajustes={ajustes}
                      aberto={configuracoes !== null}
                      aoFechar={fecharConfiguracoes}
                      abaInicial={configuracoes?.aba}
                      sistema={sistemaDasConfiguracoes}
                      memoria={servidor.memoria}
                      cota={cota}
                      orquestradores={orquestradoresDasConfiguracoes}
                      pedidosEmAndamento={pedidosEmAndamento}
                      aoSalvarInstrucoes={aoSalvarPainel}
                      topo={topoDasConfiguracoes ?? undefined}
                    />
                  </div>
                  {/* Fora do <ReactFlow>: não escala com o zoom e cobre só a área do canvas. */}
                  <PaletaDeComandos
                    controle={controleDaPaleta}
                    lerFonte={lerFonteDaPaleta}
                    aoExecutar={executarItemDaPaleta}
                  />
                </div>
                {chatFixo && ladoDoChatFixo === "direita" && chatRapido}
              </div>
            </div>
            {/* "Terminal" do "+ Novo ▾": a pasta é escolhida no mesmo navegador de pastas da criação do orquestrador. */}
            {escolhendoPastaDoShell && (
              <NavegadorDePastas aoEscolher={abrirShellNaPasta} aoFechar={fecharEscolhaDaPastaDoShell} />
            )}
            {arranjoDoModelo !== null && (
              <DialogoDeNovoModelo arranjo={arranjoDoModelo} aoSalvar={salvarModelo} aoFechar={fecharDialogoDoModelo} />
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
