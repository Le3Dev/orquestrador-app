import { Panel, type ReactFlowState, useReactFlow, useStoreApi } from "@xyflow/react";
import {
  type KeyboardEvent as EventoDeTeclaDoReact,
  memo,
  type MouseEvent as EventoDeMouseDoReact,
  type PointerEvent as EventoDePonteiroDoReact,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  alturaDaLinhaDoTexto,
  caixaDoTexto,
  caixaDoTraco,
  caminhoDaMaoLivre,
  caminhoDaSeta,
  DISTANCIA_MINIMA_ENTRE_PONTOS_PX,
  DISTANCIA_MINIMA_PARA_MOVER_PX,
  type FerramentaDeDesenho,
  FOLGA_DO_CONTORNO_PX,
  LARGURA_DO_TOQUE_PX,
  LIMITE_DO_DESFAZER,
  moverTraco,
  RAIO_DA_BORRACHA_PX,
  TOLERANCIA_DA_SIMPLIFICACAO_PX,
  larguraDoTraco,
  pontosEntre,
  retanguloEntre,
  simplificarPontos,
  tamanhoDoTexto,
  tracoTocado,
} from "../../shared/canvas/desenho";
import {
  type CorDoDesenho,
  type EspessuraDoDesenho,
  MAXIMO_DE_CARACTERES_NO_TEXTO,
  MAXIMO_DE_PONTOS_NO_TRACO,
  type Ponto,
  type Retangulo,
  salvarDesenho,
  type TracoDoDesenho,
} from "../../shared/canvas/layout";
import { BarraDeDesenho } from "./BarraDeDesenho";

/** Foco num campo de texto (o texto solto, um terminal, uma nota): a tecla é do campo, não do desenho. */
function focoEmCampoDeTexto(alvo: EventTarget | null): boolean {
  return (
    alvo instanceof HTMLElement &&
    (alvo.isContentEditable || alvo.tagName === "INPUT" || alvo.tagName === "TEXTAREA" || alvo.tagName === "SELECT")
  );
}

function ehMaoLivre(ferramenta: FerramentaDeDesenho): ferramenta is "caneta" | "marca-texto" {
  return ferramenta === "caneta" || ferramenta === "marca-texto";
}

function distancia(a: Ponto, b: Ponto): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Um traço desenhado. Memorizado: o caminho só é refeito quando o traço muda, não a cada traço novo. */
export const TracoDesenhado = memo(function TracoDesenhado({ traco }: { traco: TracoDoDesenho }) {
  const classe = `traco traco-${traco.tipo} traco-cor-${traco.cor}`;
  const [de, ate] = traco.pontos;
  if (de === undefined) {
    return null;
  }
  switch (traco.tipo) {
    case "caneta":
    case "marca-texto":
    case "linha":
      return (
        <path
          data-traco={traco.tipo}
          className={classe}
          d={caminhoDaMaoLivre(traco.pontos)}
          strokeWidth={larguraDoTraco(traco)}
        />
      );
    case "seta":
      return (
        <path
          data-traco={traco.tipo}
          className={classe}
          d={caminhoDaSeta(de, ate ?? de, traco.espessura)}
          strokeWidth={traco.espessura}
        />
      );
    case "retangulo": {
      const { x, y, largura, altura } = retanguloEntre(de, ate ?? de);
      return (
        <rect
          data-traco={traco.tipo}
          className={classe}
          x={x}
          y={y}
          width={largura}
          height={altura}
          strokeWidth={traco.espessura}
        />
      );
    }
    case "texto": {
      // Uma linha por tspan, cada uma com o y próprio: a linha vazia não perde o lugar (um tspan sem letras ignoraria o dy).
      const alturaDaLinha = alturaDaLinhaDoTexto(traco.espessura);
      return (
        <text
          data-traco={traco.tipo}
          className={classe}
          x={de.x}
          y={de.y}
          fontSize={tamanhoDoTexto(traco.espessura)}
          dominantBaseline="hanging"
        >
          {(traco.texto ?? "").split("\n").map((linha, indice) => (
            <tspan key={indice} x={de.x} y={de.y + indice * alturaDaLinha}>
              {linha}
            </tspan>
          ))}
        </text>
      );
    }
  }
});

interface PropsDoToque {
  traco: TracoDoDesenho;
  aoApertar: (evento: EventoDePonteiroDoReact<SVGElement>) => void;
  aoDarDuploClique: (evento: EventoDeMouseDoReact<SVGElement>) => void;
}

/**
 * A área que pega o clique num traço, com Selecionar: a mesma forma do traço,
 * invisível, num `<g data-toque>` que recebe os eventos. Só estes grupos pegam o
 * ponteiro (o `<svg>` não): o vazio entre eles segue para o canvas. A linha vale
 * pelo traço (o retângulo, pela borda) e o texto, pela caixa.
 *
 * A largura mínima do toque é em pixels da tela, sem saber o zoom: uma forma na
 * espessura do traço (cresce com o zoom, cobre o traço grosso) e outra de
 * `LARGURA_DO_TOQUE_PX` com `vector-effect: non-scaling-stroke` (a faixa fixa
 * que facilita acertar um traço fino). Assim a camada não renderiza por quadro.
 */
const ToqueDoTraco = memo(function ToqueDoTraco({ traco, aoApertar, aoDarDuploClique }: PropsDoToque) {
  const [de, ate] = traco.pontos;
  const caminho = useMemo(() => {
    if (de === undefined) {
      return "";
    }
    return traco.tipo === "seta" ? caminhoDaSeta(de, ate ?? de, traco.espessura) : caminhoDaMaoLivre(traco.pontos);
  }, [traco, de, ate]);
  if (de === undefined) {
    return null;
  }
  let formas;
  if (traco.tipo === "retangulo") {
    const { x, y, largura, altura } = retanguloEntre(de, ate ?? de);
    formas = (
      <>
        <rect className="toque-do-traco" x={x} y={y} width={largura} height={altura} strokeWidth={larguraDoTraco(traco)} />
        <rect
          className="toque-do-traco"
          x={x}
          y={y}
          width={largura}
          height={altura}
          strokeWidth={LARGURA_DO_TOQUE_PX}
          vectorEffect="non-scaling-stroke"
        />
      </>
    );
  } else if (traco.tipo === "texto") {
    const caixa = caixaDoTexto(de, traco.texto ?? "", traco.espessura);
    formas = (
      <rect
        className="toque-do-texto"
        x={caixa.x}
        y={caixa.y}
        width={caixa.largura}
        height={caixa.altura}
        strokeWidth={LARGURA_DO_TOQUE_PX}
        vectorEffect="non-scaling-stroke"
      />
    );
  } else {
    formas = (
      <>
        <path className="toque-do-traco" d={caminho} strokeWidth={larguraDoTraco(traco)} />
        <path
          className="toque-do-traco"
          d={caminho}
          strokeWidth={LARGURA_DO_TOQUE_PX}
          vectorEffect="non-scaling-stroke"
        />
      </>
    );
  }
  return (
    <g data-toque={traco.id} onPointerDown={aoApertar} onDoubleClick={aoDarDuploClique}>
      {formas}
    </g>
  );
});

/** O texto solto sendo digitado: onde começa e com que cor e espessura. Com `id`, é a edição de um texto que já existe. */
export interface TextoEmEdicao {
  id?: string;
  em: Ponto;
  valor: string;
  cor: CorDoDesenho;
  espessura: EspessuraDoDesenho;
}

/**
 * O gesto em curso: um traço sendo feito, a borracha passando ou um traço sendo
 * movido (todos com os traços de antes, para o desfazer).
 */
type Gesto =
  | { tipo: "traco"; traco: TracoDoDesenho; antes: TracoDoDesenho[] }
  | { tipo: "borracha"; ultimo: Ponto; antes: TracoDoDesenho[] }
  | {
      tipo: "mover";
      /** O traço como estava ao apertar: o deslocamento sai sempre dele, não do quadro anterior. */
      original: TracoDoDesenho;
      antes: TracoDoDesenho[];
      /** Onde o ponteiro apertou, na tela (para o limite do clique) e no canvas (para o deslocamento). */
      naTela: Ponto;
      noCanvas: Ponto;
      /** Já passou do limite do clique: daqui em diante é arraste. */
      moveu: boolean;
    };

interface Props {
  /** A barra de desenho está aberta (o botão "Desenhar" dos controles). Fechada, a camada só mostra o desenho. */
  aberta: boolean;
  aoFechar: () => void;
  /** Os traços salvos no layout, lidos ao abrir o canvas. */
  tracosIniciais?: readonly TracoDoDesenho[];
}

/** A câmera do canvas no React Flow: [x, y, zoom]. */
type Transformacao = ReactFlowState["transform"];

/**
 * O desenho sobre o canvas: traços em SVG, em coordenadas do canvas (a
 * transformação do grupo segue o viewport, então o desenho acompanha o zoom e
 * o arraste). A transformação vai direto no DOM, pela assinatura da loja do
 * React Flow (como o viewport dele faz): mover a câmera não renderiza a
 * camada. Com a barra fechada e sem traço nenhum, a camada nem é montada.
 * Mora dentro do <ReactFlow>, na camada 4, logo depois das
 * janelas: o traço passa por cima de terminais e notas, e os painéis (barra
 * do topo, controles, chat) continuam por cima dele.
 *
 * Com a barra fechada, a camada não pega nenhum clique: o canvas funciona
 * como sempre. Com outra ferramenta, ela pega o ponteiro do canvas inteiro (o
 * arraste desenha em vez de mover a tela); a roda e a pinça seguem para o
 * canvas. Com a barra aberta em Selecionar, só os próprios traços pegam o
 * ponteiro (uma área de toque invisível por traço): o vazio segue para o
 * canvas, e clicar num traço o seleciona, arrastar o move (um passo do
 * desfazer e uma gravação por movimento), Delete o apaga e o duplo clique num
 * texto o reabre para editar. Esc limpa a seleção e, sem ela, volta para
 * Selecionar e, de novo, fecha a barra; Ctrl/Cmd+Z desfaz o último passo
 * (traço, texto, movida, apagada ou o limpar tudo). Cada mudança vai para o
 * layout salvo (`salvarDesenho`).
 *
 * Nada aqui depende do zoom no render: a área de toque tem uma faixa mínima em
 * pixels da tela (`vector-effect: non-scaling-stroke`) e o contorno da seleção
 * e o campo do texto são posicionados pela mesma assinatura da câmera; o zoom
 * de um gesto é lido na hora (`zoomAtual`).
 */
export const CamadaDeDesenho = memo(function CamadaDeDesenho({ aberta, aoFechar, tracosIniciais = [] }: Props) {
  const fluxo = useReactFlow();
  const loja = useStoreApi();
  const [ferramentaEscolhida, setFerramentaEscolhida] = useState<FerramentaDeDesenho>("caneta");
  const [cor, setCor] = useState<CorDoDesenho>("laranja");
  const [espessura, setEspessura] = useState<EspessuraDoDesenho>(3);
  const [tracos, setTracos] = useState<TracoDoDesenho[]>(() => [...tracosIniciais]);
  const [passados, setPassados] = useState<TracoDoDesenho[][]>([]);
  const [rascunho, setRascunho] = useState<TracoDoDesenho | null>(null);
  const [textoEmEdicao, setTextoEmEdicao] = useState<TextoEmEdicao | null>(null);
  /** O id do traço selecionado (só com a barra aberta em Selecionar). */
  const [selecionado, setSelecionado] = useState<string | null>(null);
  // Os handlers do ponteiro leem por aqui: vários eventos podem chegar antes de um render.
  const tracosAtuais = useRef(tracos);
  const gesto = useRef<Gesto | null>(null);
  const edicaoAtual = useRef<TextoEmEdicao | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const grupo = useRef<SVGGElement>(null);
  const campoDoTexto = useRef<HTMLTextAreaElement>(null);
  const contorno = useRef<SVGRectElement>(null);
  /** A caixa do traço selecionado (em coordenadas do canvas): o contorno se posiciona a partir dela a cada quadro da câmera. */
  const caixaDoContorno = useRef<Retangulo | null>(null);

  // Abrir a barra já deixa a caneta na mão; fechar descarta o que estava pela metade.
  const [abertaAntes, setAbertaAntes] = useState(aberta);
  if (abertaAntes !== aberta) {
    // Ajuste durante o render (padrão do React para estado derivado de props).
    setAbertaAntes(aberta);
    setSelecionado(null);
    if (aberta) {
      setFerramentaEscolhida("caneta");
    } else {
      setRascunho(null);
      setTextoEmEdicao(null);
    }
  }
  const ferramenta: FerramentaDeDesenho = aberta ? ferramentaEscolhida : "selecionar";
  const ativa = ferramenta !== "selecionar";
  /** Barra aberta em Selecionar: os traços pegam o clique (selecionar e mover). */
  const selecionando = aberta && !ativa;
  // Barra fechada e nada desenhado: sem SVG e sem acompanhar a câmera.
  const montada = aberta || tracos.length > 0;

  // O texto reaberto para edição some do desenho: o campo ocupa o lugar dele.
  const idEmEdicao = textoEmEdicao?.id;
  const tracosNaTela = useMemo(() => tracos.filter((traco) => traco.id !== idEmEdicao), [tracos, idEmEdicao]);
  const tracoSelecionado = selecionando ? tracosNaTela.find((traco) => traco.id === selecionado) : undefined;
  const caixaSelecionada = useMemo(
    () => (tracoSelecionado === undefined ? null : caixaDoTraco(tracoSelecionado)),
    [tracoSelecionado],
  );

  /** O zoom de agora, lido na hora do evento (a camada não renderiza a cada quadro). */
  const zoomAtual = useCallback(() => loja.getState().transform[2], [loja]);

  /** O campo do texto solto fica sobre o ponto do canvas, no tamanho do zoom. */
  const posicionarCampoDoTexto = useCallback(([x, y, zoom]: Transformacao) => {
    const edicao = edicaoAtual.current;
    const campo = campoDoTexto.current;
    if (edicao === null || campo === null) {
      return;
    }
    campo.style.left = `${edicao.em.x * zoom + x}px`;
    campo.style.top = `${edicao.em.y * zoom + y}px`;
    campo.style.fontSize = `${tamanhoDoTexto(edicao.espessura) * zoom}px`;
  }, []);

  /** O contorno da seleção, em pixels da tela (a folga e o tracejado não crescem com o zoom). */
  const posicionarContorno = useCallback(([x, y, zoom]: Transformacao) => {
    const caixa = caixaDoContorno.current;
    const contornoNaTela = contorno.current;
    if (caixa === null || contornoNaTela === null) {
      return;
    }
    contornoNaTela.setAttribute("x", String(caixa.x * zoom + x - FOLGA_DO_CONTORNO_PX));
    contornoNaTela.setAttribute("y", String(caixa.y * zoom + y - FOLGA_DO_CONTORNO_PX));
    contornoNaTela.setAttribute("width", String(caixa.largura * zoom + 2 * FOLGA_DO_CONTORNO_PX));
    contornoNaTela.setAttribute("height", String(caixa.altura * zoom + 2 * FOLGA_DO_CONTORNO_PX));
  }, []);

  // A câmera vai direto no grupo do SVG e no campo do texto, sem render do React por quadro.
  useLayoutEffect(() => {
    if (!montada) {
      return;
    }
    let anterior: Transformacao | null = null;
    const acompanhar = () => {
      const transformacao = loja.getState().transform;
      // A loja avisa qualquer mudança: só mexe no DOM quando x, y ou zoom mudaram.
      if (
        anterior !== null &&
        transformacao[0] === anterior[0] &&
        transformacao[1] === anterior[1] &&
        transformacao[2] === anterior[2]
      ) {
        return;
      }
      anterior = transformacao;
      const [x, y, zoom] = transformacao;
      grupo.current?.setAttribute("transform", `translate(${x} ${y}) scale(${zoom})`);
      posicionarCampoDoTexto(transformacao);
      posicionarContorno(transformacao);
    };
    acompanhar();
    return loja.subscribe(acompanhar);
  }, [loja, montada, posicionarCampoDoTexto, posicionarContorno]);

  // O campo do texto solto recém aberto já nasce no lugar.
  useLayoutEffect(() => {
    if (textoEmEdicao !== null) {
      posicionarCampoDoTexto(loja.getState().transform);
    }
  }, [loja, textoEmEdicao, posicionarCampoDoTexto]);

  // O contorno da seleção nasce (ou muda de traço, ou acompanha o traço movido) já no lugar.
  useLayoutEffect(() => {
    caixaDoContorno.current = caixaSelecionada;
    posicionarContorno(loja.getState().transform);
  }, [loja, caixaSelecionada, posicionarContorno]);

  const trocarTracos = useCallback((novos: TracoDoDesenho[]) => {
    tracosAtuais.current = novos;
    setTracos(novos);
  }, []);

  /** Um passo do desenho: guarda o antes para o desfazer, mostra o depois e grava. */
  const registrar = useCallback(
    (antes: TracoDoDesenho[], depois: TracoDoDesenho[]) => {
      setPassados((atuais) => [...atuais, antes].slice(-LIMITE_DO_DESFAZER));
      trocarTracos(depois);
      salvarDesenho(depois);
    },
    [trocarTracos],
  );

  const desfazer = useCallback(() => {
    const anterior = passados.at(-1);
    if (anterior === undefined) {
      return;
    }
    setPassados(passados.slice(0, -1));
    trocarTracos(anterior);
    salvarDesenho(anterior);
  }, [passados, trocarTracos]);

  /** Apaga todos os traços num passo só: o desfazer traz todos de volta. */
  const limpar = useCallback(() => {
    const antes = tracosAtuais.current;
    if (antes.length > 0) {
      setSelecionado(null);
      registrar(antes, []);
    }
  }, [registrar]);

  const mudarEdicao = useCallback((edicao: TextoEmEdicao | null) => {
    edicaoAtual.current = edicao;
    setTextoEmEdicao(edicao);
  }, []);

  /**
   * Termina o texto solto: com algo escrito, vira um traço; vazio, some. Chamado duas vezes, vale uma.
   * Ao reeditar um texto que já existe (`id`), o traço é trocado (ou sai, se esvaziou) em um passo só.
   */
  const confirmarTexto = useCallback(() => {
    const edicao = edicaoAtual.current;
    if (edicao === null) {
      return;
    }
    mudarEdicao(null);
    const texto = edicao.valor.slice(0, MAXIMO_DE_CARACTERES_NO_TEXTO);
    const antes = tracosAtuais.current;
    if (edicao.id !== undefined) {
      const original = antes.find((traco) => traco.id === edicao.id);
      if (original === undefined) {
        return;
      }
      if (texto.trim() === "") {
        registrar(
          antes,
          antes.filter((traco) => traco.id !== edicao.id),
        );
      } else if (texto !== original.texto) {
        registrar(
          antes,
          antes.map((traco) => (traco.id === edicao.id ? { ...traco, texto } : traco)),
        );
      }
      return;
    }
    if (texto.trim() === "") {
      return;
    }
    registrar(antes, [
      ...antes,
      { id: crypto.randomUUID(), tipo: "texto", cor: edicao.cor, espessura: edicao.espessura, pontos: [edicao.em], texto },
    ]);
  }, [mudarEdicao, registrar]);

  const escolherFerramenta = useCallback(
    (nova: FerramentaDeDesenho) => {
      confirmarTexto();
      setSelecionado(null);
      setFerramentaEscolhida(nova);
    },
    [confirmarTexto],
  );

  const fechar = useCallback(() => {
    confirmarTexto();
    aoFechar();
  }, [aoFechar, confirmarTexto]);

  const noCanvas = useCallback(
    (evento: { clientX: number; clientY: number }): Ponto =>
      fluxo.screenToFlowPosition({ x: evento.clientX, y: evento.clientY }),
    [fluxo],
  );

  /** A borracha nos pontos dados: os traços tocados saem (o desfazer guarda o antes no fim do gesto). */
  const apagarEm = useCallback(
    (pontos: readonly Ponto[]) => {
      const folga = RAIO_DA_BORRACHA_PX / zoomAtual();
      const restantes = tracosAtuais.current.filter(
        (traco) => !pontos.some((ponto) => tracoTocado(traco, ponto, folga)),
      );
      if (restantes.length !== tracosAtuais.current.length) {
        trocarTracos(restantes);
      }
    },
    [trocarTracos, zoomAtual],
  );

  /** Apertar num traço (Selecionar): seleciona e já prepara o arraste; só vira movimento passando do limite do clique. */
  const aoApertarNoTraco = useCallback(
    (evento: EventoDePonteiroDoReact<SVGElement>) => {
      if (evento.button !== 0) {
        return;
      }
      // Termina antes um texto aberto (o que pode mudar os traços); só então procura o traço apertado.
      confirmarTexto();
      const traco = tracosAtuais.current.find((candidato) => candidato.id === evento.currentTarget.dataset.toque);
      if (traco === undefined) {
        return;
      }
      // O clique é do traço: nem o canvas (arraste da tela, seleção das janelas) nem o foco do navegador o recebem.
      // Um campo em foco (terminal, nota) perde o foco, para o Delete valer para o traço.
      evento.preventDefault();
      evento.stopPropagation();
      if (document.activeElement instanceof HTMLElement && focoEmCampoDeTexto(document.activeElement)) {
        document.activeElement.blur();
      }
      setSelecionado(traco.id);
      evento.currentTarget.setPointerCapture?.(evento.pointerId);
      gesto.current = {
        tipo: "mover",
        original: traco,
        antes: tracosAtuais.current,
        naTela: { x: evento.clientX, y: evento.clientY },
        noCanvas: noCanvas(evento),
        moveu: false,
      };
    },
    [confirmarTexto, noCanvas],
  );

  /** Duplo clique num texto: reabre a edição dele, com o valor atual (confirmar troca o traço em um passo só). */
  const aoDarDuploClique = useCallback(
    (evento: EventoDeMouseDoReact<SVGElement>) => {
      const traco = tracosAtuais.current.find((candidato) => candidato.id === evento.currentTarget.dataset.toque);
      const em = traco?.pontos[0];
      if (traco === undefined || traco.tipo !== "texto" || em === undefined) {
        return;
      }
      evento.preventDefault();
      evento.stopPropagation();
      gesto.current = null;
      setSelecionado(traco.id);
      mudarEdicao({ id: traco.id, em, valor: traco.texto ?? "", cor: traco.cor, espessura: traco.espessura });
    },
    [mudarEdicao],
  );

  const aoApertar = (evento: EventoDePonteiroDoReact<SVGSVGElement>) => {
    if (!ativa || evento.button !== 0) {
      return;
    }
    // Sem o mousedown que viria depois: o foco fica onde está (o campo do texto solto, ao abrir).
    evento.preventDefault();
    confirmarTexto();
    const ponto = noCanvas(evento);
    if (ferramenta === "texto") {
      mudarEdicao({ em: ponto, valor: "", cor, espessura });
      return;
    }
    evento.currentTarget.setPointerCapture?.(evento.pointerId);
    if (ferramenta === "borracha") {
      gesto.current = { tipo: "borracha", ultimo: ponto, antes: tracosAtuais.current };
      apagarEm([ponto]);
      return;
    }
    const traco: TracoDoDesenho = {
      id: crypto.randomUUID(),
      tipo: ferramenta,
      cor,
      espessura,
      pontos: ehMaoLivre(ferramenta) ? [ponto] : [ponto, ponto],
    };
    gesto.current = { tipo: "traco", traco, antes: tracosAtuais.current };
    setRascunho(traco);
  };

  const aoMover = (evento: EventoDePonteiroDoReact<SVGSVGElement>) => {
    const atual = gesto.current;
    if (atual === null) {
      return;
    }
    const ponto = noCanvas(evento);
    const zoom = zoomAtual();
    if (atual.tipo === "borracha") {
      apagarEm(pontosEntre(atual.ultimo, ponto, RAIO_DA_BORRACHA_PX / zoom));
      atual.ultimo = ponto;
      return;
    }
    if (atual.tipo === "mover") {
      if (
        !atual.moveu &&
        distancia({ x: evento.clientX, y: evento.clientY }, atual.naTela) < DISTANCIA_MINIMA_PARA_MOVER_PX
      ) {
        return;
      }
      atual.moveu = true;
      // Só mostra: o passo do desfazer e a gravação vêm ao soltar (a borracha também faz assim).
      const movido = moverTraco(atual.original, { x: ponto.x - atual.noCanvas.x, y: ponto.y - atual.noCanvas.y });
      trocarTracos(atual.antes.map((traco) => (traco.id === movido.id ? movido : traco)));
      return;
    }
    const { traco } = atual;
    let pontos: Ponto[];
    if (ehMaoLivre(traco.tipo)) {
      const ultimo = traco.pontos[traco.pontos.length - 1];
      if (
        traco.pontos.length >= MAXIMO_DE_PONTOS_NO_TRACO ||
        (ultimo !== undefined && distancia(ultimo, ponto) < DISTANCIA_MINIMA_ENTRE_PONTOS_PX / zoom)
      ) {
        return;
      }
      pontos = [...traco.pontos, ponto];
    } else {
      pontos = [traco.pontos[0] ?? ponto, ponto];
    }
    const novo = { ...traco, pontos };
    gesto.current = { ...atual, traco: novo };
    setRascunho(novo);
  };

  const aoSoltar = () => {
    const atual = gesto.current;
    gesto.current = null;
    if (atual === null) {
      return;
    }
    if (atual.tipo === "borracha" || atual.tipo === "mover") {
      if (tracosAtuais.current !== atual.antes) {
        registrar(atual.antes, tracosAtuais.current);
      }
      return;
    }
    setRascunho(null);
    const { traco } = atual;
    const [de, ate] = traco.pontos;
    const zoom = zoomAtual();
    if (ehMaoLivre(traco.tipo)) {
      registrar(atual.antes, [
        ...atual.antes,
        { ...traco, pontos: simplificarPontos(traco.pontos, TOLERANCIA_DA_SIMPLIFICACAO_PX / zoom) },
      ]);
      return;
    }
    // Um clique sem arrastar não vira uma forma de tamanho zero.
    if (de === undefined || ate === undefined || distancia(de, ate) * zoom < DISTANCIA_MINIMA_ENTRE_PONTOS_PX) {
      return;
    }
    registrar(atual.antes, [...atual.antes, { ...traco, pontos: simplificarPontos(traco.pontos, 0) }]);
  };

  /** O sistema tomou o ponteiro: o traço que estava sendo movido volta para onde estava; os outros gestos terminam como ao soltar. */
  const aoCancelar = () => {
    const atual = gesto.current;
    if (atual?.tipo === "mover") {
      gesto.current = null;
      trocarTracos(atual.antes);
      return;
    }
    aoSoltar();
  };

  // Esc limpa a seleção ou volta para Selecionar (e larga o traço pela metade); Delete apaga o traço
  // selecionado; Ctrl/Cmd+Z desfaz. Só com a barra aberta.
  useEffect(() => {
    if (!aberta) {
      return;
    }
    const aoApertarTecla = (evento: KeyboardEvent) => {
      if (evento.defaultPrevented || focoEmCampoDeTexto(evento.target)) {
        return;
      }
      if ((evento.key === "Delete" || evento.key === "Backspace") && selecionado !== null) {
        evento.preventDefault();
        const antes = tracosAtuais.current;
        setSelecionado(null);
        if (antes.some((traco) => traco.id === selecionado)) {
          registrar(
            antes,
            antes.filter((traco) => traco.id !== selecionado),
          );
        }
        return;
      }
      if (evento.key === "Escape") {
        if (selecionado !== null) {
          // Com um traço selecionado, o Esc só tira a seleção; o próximo segue o caminho de antes.
          evento.preventDefault();
          setSelecionado(null);
        } else if (ferramentaEscolhida !== "selecionar") {
          // O Esc usado aqui não limpa a seleção das janelas (o canvas confere o preventDefault).
          evento.preventDefault();
          gesto.current = null;
          setRascunho(null);
          setFerramentaEscolhida("selecionar");
        } else {
          // Já em Selecionar, o Esc fecha a barra (o desenho continua no canvas).
          evento.preventDefault();
          fechar();
        }
        return;
      }
      const comComando = evento.metaKey || evento.ctrlKey;
      if (comComando && !evento.shiftKey && !evento.altKey && (evento.code === "KeyZ" || evento.key === "z")) {
        evento.preventDefault();
        desfazer();
      }
    };
    window.addEventListener("keydown", aoApertarTecla);
    return () => window.removeEventListener("keydown", aoApertarTecla);
  }, [aberta, ferramentaEscolhida, selecionado, desfazer, fechar, registrar]);

  // Clicar fora dos traços (no canvas, numa janela, em qualquer lugar) tira a seleção. O clique no vazio
  // nem passa pela camada, então a escuta é da janela, na captura: vê o clique antes de quem o trata.
  useEffect(() => {
    if (!selecionando) {
      return;
    }
    const aoApertarFora = (evento: PointerEvent) => {
      const dentro =
        evento.target instanceof Element &&
        evento.target.closest("[data-toque], .barra-de-desenho, .campo-do-texto-solto") !== null;
      if (!dentro) {
        setSelecionado(null);
      }
    };
    window.addEventListener("pointerdown", aoApertarFora, true);
    return () => window.removeEventListener("pointerdown", aoApertarFora, true);
  }, [selecionando]);

  // A roda e a pinça sobre a camada seguem para o canvas (zoom e pan), como fora dela; o
  // preventDefault segura o zoom da página no Ctrl+roda. Em Selecionar, vale sobre os traços.
  useEffect(() => {
    const elemento = svg.current;
    if (!aberta || elemento === null) {
      return;
    }
    const aoRolar = (evento: WheelEvent) => {
      evento.preventDefault();
      elemento.closest(".react-flow")?.querySelector(".react-flow__pane")?.dispatchEvent(new WheelEvent("wheel", evento));
    };
    elemento.addEventListener("wheel", aoRolar, { passive: false });
    return () => elemento.removeEventListener("wheel", aoRolar);
  }, [aberta]);

  // Só a lista muda quando um traço entra ou sai: o rascunho em curso, o zoom e o pan não refazem os elementos.
  const desenhados = useMemo(
    () => tracosNaTela.map((traco) => <TracoDesenhado key={traco.id} traco={traco} />),
    [tracosNaTela],
  );
  // O mesmo para as áreas de toque (Selecionar): só trocam quando os traços ou a seleção de modo mudam.
  const toques = useMemo(
    () =>
      selecionando
        ? tracosNaTela.map((traco) => (
            <ToqueDoTraco key={traco.id} traco={traco} aoApertar={aoApertarNoTraco} aoDarDuploClique={aoDarDuploClique} />
          ))
        : null,
    [selecionando, tracosNaTela, aoApertarNoTraco, aoDarDuploClique],
  );

  // Como no Excalidraw: Enter e Shift+Enter quebram a linha (o padrão do campo); Esc e Ctrl/Cmd+Enter
  // terminam o texto. O Esc não sobe: o atalho da camada trocaria a ferramenta ou fecharia a barra.
  const aoTeclarNoTexto = (evento: EventoDeTeclaDoReact<HTMLTextAreaElement>) => {
    if (evento.nativeEvent.isComposing) {
      return;
    }
    if (evento.key === "Escape" || (evento.key === "Enter" && (evento.ctrlKey || evento.metaKey))) {
      evento.preventDefault();
      evento.stopPropagation();
      confirmarTexto();
    }
  };

  const linhasDoCampo = (textoEmEdicao?.valor ?? "").split("\n");

  if (!montada) {
    return null;
  }

  return (
    <>
      <div
        className={`camada-de-desenho ${ativa ? "camada-de-desenho-ativa" : ""} ${selecionando ? "camada-de-desenho-selecionando" : ""}`}
        data-ferramenta={ferramenta}
        data-testid="camada-de-desenho"
      >
        <svg
          ref={svg}
          className="camada-de-desenho-svg"
          role={ativa ? "application" : undefined}
          aria-label={ativa ? "Área de desenho" : undefined}
          aria-hidden={ativa ? undefined : true}
          onPointerDown={aoApertar}
          onPointerMove={aoMover}
          onPointerUp={aoSoltar}
          onPointerCancel={aoCancelar}
        >
          {/* A transformação (a câmera) é posta pela assinatura da loja, fora do render. */}
          <g ref={grupo}>
            {desenhados}
            {rascunho !== null && <TracoDesenhado traco={rascunho} />}
            {toques}
          </g>
          {caixaSelecionada !== null && (
            // Em pixels da tela (fora do grupo do zoom): x, y, width e height vêm de posicionarContorno, que segue a câmera.
            <rect ref={contorno} className="contorno-da-selecao" rx={4} />
          )}
        </svg>
        {textoEmEdicao !== null && (
          <textarea
            // Abre já com o foco: o clique que o criou não o tira (preventDefault no ponteiro).
            autoFocus
            ref={campoDoTexto}
            className={`campo-do-texto-solto traco-cor-${textoEmEdicao.cor}`}
            aria-label="Texto solto"
            placeholder="Digite; Enter quebra a linha, Esc termina"
            maxLength={MAXIMO_DE_CARACTERES_NO_TEXTO}
            // Cresce com o conteúdo (o CSS usa field-sizing; rows e cols valem onde ele não existe) e não quebra linha sozinho.
            wrap="off"
            rows={linhasDoCampo.length}
            cols={Math.max(1, ...linhasDoCampo.map((linha) => linha.length))}
            value={textoEmEdicao.valor}
            // left, top e fontSize vêm de posicionarCampoDoTexto, que segue a câmera.
            onChange={(evento) => mudarEdicao({ ...textoEmEdicao, valor: evento.target.value })}
            onKeyDown={aoTeclarNoTexto}
            onBlur={confirmarTexto}
          />
        )}
      </div>
      {aberta && (
        <Panel position="bottom-left" className="painel-da-barra-de-desenho">
          <BarraDeDesenho
            ferramenta={ferramenta}
            cor={cor}
            espessura={espessura}
            podeDesfazer={passados.length > 0}
            podeLimpar={tracos.length > 0}
            aoEscolherFerramenta={escolherFerramenta}
            aoEscolherCor={setCor}
            aoEscolherEspessura={setEspessura}
            aoDesfazer={desfazer}
            aoLimpar={limpar}
            aoFechar={fechar}
          />
        </Panel>
      )}
    </>
  );
});
