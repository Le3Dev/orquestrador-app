import { Panel, useReactFlow, useViewport } from "@xyflow/react";
import {
  type KeyboardEvent as EventoDeTeclaDoReact,
  memo,
  type PointerEvent as EventoDePonteiroDoReact,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  caminhoDaMaoLivre,
  caminhoDaSeta,
  type FerramentaDeDesenho,
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
  salvarDesenho,
  type TracoDoDesenho,
} from "../../shared/canvas/layout";
import { BarraDeDesenho } from "./BarraDeDesenho";

/** Distância mínima, em pixels da tela, entre dois pontos seguidos da mão livre. */
const DISTANCIA_MINIMA_ENTRE_PONTOS_PX = 2;
/** Quanto a mão livre pode se desviar (em pixels da tela) ao simplificar os pontos no fim do traço. */
const TOLERANCIA_DA_SIMPLIFICACAO_PX = 0.8;
/** O raio da borracha, em pixels da tela. */
const RAIO_DA_BORRACHA_PX = 8;
/** Quantos passos o desfazer guarda. */
const LIMITE_DO_DESFAZER = 100;

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

/** Um traço desenhado. Memorizado: mover o canvas só troca a transformação do grupo, não cada traço. */
const TracoDesenhado = memo(function TracoDesenhado({ traco }: { traco: TracoDoDesenho }) {
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
    case "texto":
      return (
        <text
          data-traco={traco.tipo}
          className={classe}
          x={de.x}
          y={de.y}
          fontSize={tamanhoDoTexto(traco.espessura)}
          dominantBaseline="hanging"
        >
          {traco.texto}
        </text>
      );
  }
});

/** O texto solto sendo digitado: onde começa e com que cor e espessura. */
interface TextoEmEdicao {
  em: Ponto;
  valor: string;
  cor: CorDoDesenho;
  espessura: EspessuraDoDesenho;
}

/** O gesto em curso: um traço sendo feito ou a borracha passando (com os traços de antes, para o desfazer). */
type Gesto =
  | { tipo: "traco"; traco: TracoDoDesenho; antes: TracoDoDesenho[] }
  | { tipo: "borracha"; ultimo: Ponto; antes: TracoDoDesenho[] };

interface Props {
  /** A barra de desenho está aberta (o botão "Desenhar" dos controles). Fechada, a camada só mostra o desenho. */
  aberta: boolean;
  aoFechar: () => void;
  /** Os traços salvos no layout, lidos ao abrir o canvas. */
  tracosIniciais?: readonly TracoDoDesenho[];
}

/**
 * O desenho sobre o canvas: traços em SVG, em coordenadas do canvas (a
 * transformação do grupo segue o viewport, então o desenho acompanha o zoom e
 * o arraste). Mora dentro do <ReactFlow>, na camada 4, logo depois das
 * janelas: o traço passa por cima de terminais e notas, e os painéis (barra
 * do topo, controles, chat) continuam por cima dele.
 *
 * Com a ferramenta Selecionar (ou a barra fechada), a camada não pega nenhum
 * clique: o canvas funciona como sempre. Com outra ferramenta, ela pega o
 * ponteiro do canvas inteiro (o arraste desenha em vez de mover a tela); a
 * roda e a pinça seguem para o canvas. Esc volta para Selecionar e, de novo, fecha a barra; Ctrl/Cmd+Z
 * desfaz o último passo (traço, texto ou apagada). Cada mudança vai para o
 * layout salvo (`salvarDesenho`).
 */
export const CamadaDeDesenho = memo(function CamadaDeDesenho({ aberta, aoFechar, tracosIniciais = [] }: Props) {
  const fluxo = useReactFlow();
  const { x, y, zoom } = useViewport();
  const [ferramentaEscolhida, setFerramentaEscolhida] = useState<FerramentaDeDesenho>("caneta");
  const [cor, setCor] = useState<CorDoDesenho>("laranja");
  const [espessura, setEspessura] = useState<EspessuraDoDesenho>(3);
  const [tracos, setTracos] = useState<TracoDoDesenho[]>(() => [...tracosIniciais]);
  const [passados, setPassados] = useState<TracoDoDesenho[][]>([]);
  const [rascunho, setRascunho] = useState<TracoDoDesenho | null>(null);
  const [textoEmEdicao, setTextoEmEdicao] = useState<TextoEmEdicao | null>(null);
  // Os handlers do ponteiro leem por aqui: vários eventos podem chegar antes de um render.
  const tracosAtuais = useRef(tracos);
  const gesto = useRef<Gesto | null>(null);
  const edicaoAtual = useRef<TextoEmEdicao | null>(null);
  const svg = useRef<SVGSVGElement>(null);

  // Abrir a barra já deixa a caneta na mão; fechar descarta o que estava pela metade.
  const [abertaAntes, setAbertaAntes] = useState(aberta);
  if (abertaAntes !== aberta) {
    // Ajuste durante o render (padrão do React para estado derivado de props).
    setAbertaAntes(aberta);
    if (aberta) {
      setFerramentaEscolhida("caneta");
    } else {
      setRascunho(null);
      setTextoEmEdicao(null);
    }
  }
  const ferramenta: FerramentaDeDesenho = aberta ? ferramentaEscolhida : "selecionar";
  const ativa = ferramenta !== "selecionar";

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

  const mudarEdicao = useCallback((edicao: TextoEmEdicao | null) => {
    edicaoAtual.current = edicao;
    setTextoEmEdicao(edicao);
  }, []);

  /** Termina o texto solto: com algo escrito, vira um traço; vazio, some. Chamado duas vezes, vale uma. */
  const confirmarTexto = useCallback(() => {
    const edicao = edicaoAtual.current;
    if (edicao === null) {
      return;
    }
    mudarEdicao(null);
    const texto = edicao.valor.slice(0, MAXIMO_DE_CARACTERES_NO_TEXTO);
    if (texto.trim() === "") {
      return;
    }
    const antes = tracosAtuais.current;
    registrar(antes, [
      ...antes,
      { id: crypto.randomUUID(), tipo: "texto", cor: edicao.cor, espessura: edicao.espessura, pontos: [edicao.em], texto },
    ]);
  }, [mudarEdicao, registrar]);

  const escolherFerramenta = useCallback(
    (nova: FerramentaDeDesenho) => {
      confirmarTexto();
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
      const folga = RAIO_DA_BORRACHA_PX / zoom;
      const restantes = tracosAtuais.current.filter(
        (traco) => !pontos.some((ponto) => tracoTocado(traco, ponto, folga)),
      );
      if (restantes.length !== tracosAtuais.current.length) {
        trocarTracos(restantes);
      }
    },
    [trocarTracos, zoom],
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
    if (atual.tipo === "borracha") {
      apagarEm(pontosEntre(atual.ultimo, ponto, RAIO_DA_BORRACHA_PX / zoom));
      atual.ultimo = ponto;
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
    if (atual.tipo === "borracha") {
      if (tracosAtuais.current !== atual.antes) {
        registrar(atual.antes, tracosAtuais.current);
      }
      return;
    }
    setRascunho(null);
    const { traco } = atual;
    const [de, ate] = traco.pontos;
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

  // Esc volta para Selecionar (e larga o traço pela metade); Ctrl/Cmd+Z desfaz. Só com a barra aberta.
  useEffect(() => {
    if (!aberta) {
      return;
    }
    const aoApertarTecla = (evento: KeyboardEvent) => {
      if (evento.defaultPrevented || focoEmCampoDeTexto(evento.target)) {
        return;
      }
      if (evento.key === "Escape") {
        if (ferramentaEscolhida !== "selecionar") {
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
  }, [aberta, ferramentaEscolhida, desfazer, fechar]);

  // A roda e a pinça sobre a camada seguem para o canvas (zoom e pan), como fora dela; o
  // preventDefault segura o zoom da página no Ctrl+roda.
  useEffect(() => {
    const elemento = svg.current;
    if (!ativa || elemento === null) {
      return;
    }
    const aoRolar = (evento: WheelEvent) => {
      evento.preventDefault();
      elemento.closest(".react-flow")?.querySelector(".react-flow__pane")?.dispatchEvent(new WheelEvent("wheel", evento));
    };
    elemento.addEventListener("wheel", aoRolar, { passive: false });
    return () => elemento.removeEventListener("wheel", aoRolar);
  }, [ativa]);

  const aoTeclarNoTexto = (evento: EventoDeTeclaDoReact<HTMLInputElement>) => {
    if (evento.key === "Enter") {
      evento.preventDefault();
      confirmarTexto();
    } else if (evento.key === "Escape") {
      // Esc no campo desiste do texto; a ferramenta continua a mesma.
      evento.preventDefault();
      evento.stopPropagation();
      mudarEdicao(null);
    }
  };

  return (
    <>
      <div
        className={`camada-de-desenho ${ativa ? "camada-de-desenho-ativa" : ""}`}
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
          onPointerCancel={aoSoltar}
        >
          <g transform={`translate(${x} ${y}) scale(${zoom})`}>
            {tracos.map((traco) => (
              <TracoDesenhado key={traco.id} traco={traco} />
            ))}
            {rascunho !== null && <TracoDesenhado traco={rascunho} />}
          </g>
        </svg>
        {textoEmEdicao !== null && (
          <input
            // Abre já com o foco: o clique que o criou não o tira (preventDefault no ponteiro).
            autoFocus
            className={`campo-do-texto-solto traco-cor-${textoEmEdicao.cor}`}
            aria-label="Texto solto"
            placeholder="Digite e tecle Enter"
            maxLength={MAXIMO_DE_CARACTERES_NO_TEXTO}
            value={textoEmEdicao.valor}
            style={{
              left: textoEmEdicao.em.x * zoom + x,
              top: textoEmEdicao.em.y * zoom + y,
              fontSize: tamanhoDoTexto(textoEmEdicao.espessura) * zoom,
            }}
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
            aoEscolherFerramenta={escolherFerramenta}
            aoEscolherCor={setCor}
            aoEscolherEspessura={setEspessura}
            aoDesfazer={desfazer}
            aoFechar={fechar}
          />
        </Panel>
      )}
    </>
  );
});
