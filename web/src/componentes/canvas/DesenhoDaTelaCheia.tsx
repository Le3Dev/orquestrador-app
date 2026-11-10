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
  type FerramentaDeDesenho,
  pontosEntre,
  simplificarPontos,
  tamanhoDoTexto,
  tracoTocado,
} from "../../shared/canvas/desenho";
import {
  type CorDoDesenho,
  type EspessuraDoDesenho,
  lerDesenhoDaTelaCheia,
  MAXIMO_DE_CARACTERES_NO_TEXTO,
  MAXIMO_DE_PONTOS_NO_TRACO,
  type Ponto,
  salvarDesenhoDaTelaCheia,
  type TracoDoDesenho,
} from "../../shared/canvas/layout";
import { BarraDeDesenho } from "./BarraDeDesenho";
import {
  DISTANCIA_MINIMA_ENTRE_PONTOS_PX,
  LIMITE_DO_DESFAZER,
  RAIO_DA_BORRACHA_PX,
  type TextoEmEdicao,
  TOLERANCIA_DA_SIMPLIFICACAO_PX,
  TracoDesenhado,
} from "./CamadaDeDesenho";

/** As ferramentas da barra compacta da tela cheia. */
const FERRAMENTAS_DA_TELA_CHEIA: readonly FerramentaDeDesenho[] = ["caneta", "seta", "retangulo", "texto", "borracha"];
/** A espessura fica na média: a barra compacta não oferece a escolha. */
const ESPESSURA_DA_TELA_CHEIA: EspessuraDoDesenho = 3;
const FECHAR_DA_TELA_CHEIA = {
  nome: "Desligar o desenho",
  dica: "Desligar o desenho (Esc); os traços continuam na página",
};

type FerramentaDeTraco = Exclude<FerramentaDeDesenho, "selecionar">;

/** Foco num campo de texto: a tecla é do campo, não do desenho. */
function focoEmCampoDeTexto(alvo: EventTarget | null): boolean {
  return (
    alvo instanceof HTMLElement &&
    (alvo.isContentEditable || alvo.tagName === "INPUT" || alvo.tagName === "TEXTAREA" || alvo.tagName === "SELECT")
  );
}

function distancia(a: Ponto, b: Ponto): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** O gesto em curso: um traço sendo feito ou a borracha passando (com os traços de antes, para o desfazer). */
type Gesto =
  | { tipo: "traco"; traco: TracoDoDesenho; antes: TracoDoDesenho[] }
  | { tipo: "borracha"; ultimo: Ponto; antes: TracoDoDesenho[] };

interface Props {
  /** Id do artefato: o desenho é guardado por ele e volta na próxima vez que a tela cheia abrir. */
  artefatoId: string;
  /** O modo de desenho está ligado (o botão da caneta na barra da tela cheia). Desligado, a camada só mostra os traços. */
  ligado: boolean;
  /** O fechar da barrinha: desliga o modo (os traços ficam). */
  aoDesligar: () => void;
}

/**
 * O desenho sobre a página de um artefato em tela cheia. Preenche o corpo da
 * `JanelaEmTelaCheia` (que é `position: relative`) com uma camada SVG
 * transparente, em pixels do corpo (x e y a partir do canto superior esquerdo),
 * e usa a mesma barra, os mesmos traços e as mesmas contas do desenho do canvas.
 *
 * Ligado, a camada pega o ponteiro (a página, quem a monta deixa sem ele) e a
 * barrinha aparece no alto. Desligado, os traços seguem visíveis por cima da
 * página, mas sem pegar o mouse: a página rola e recebe cliques. Cada passo vai
 * para o armazenamento, por artefato (`salvarDesenhoDaTelaCheia`). O Esc quem
 * trata é a `JanelaEmTelaCheia` (primeiro desliga o modo, depois fecha); o
 * Ctrl/Cmd+Z desfaz aqui.
 */
export const DesenhoDaTelaCheia = memo(function DesenhoDaTelaCheia({ artefatoId, ligado, aoDesligar }: Props) {
  const [ferramentaEscolhida, setFerramentaEscolhida] = useState<FerramentaDeTraco>("caneta");
  const [cor, setCor] = useState<CorDoDesenho>("laranja");
  const [tracos, setTracos] = useState<TracoDoDesenho[]>(() => lerDesenhoDaTelaCheia(artefatoId));
  const [passados, setPassados] = useState<TracoDoDesenho[][]>([]);
  const [rascunho, setRascunho] = useState<TracoDoDesenho | null>(null);
  const [textoEmEdicao, setTextoEmEdicao] = useState<TextoEmEdicao | null>(null);
  // Os handlers do ponteiro leem por aqui: vários eventos podem chegar antes de um render.
  const tracosAtuais = useRef(tracos);
  const gesto = useRef<Gesto | null>(null);
  const edicaoAtual = useRef<TextoEmEdicao | null>(null);
  const camada = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);

  // Ligar deixa a caneta na mão; desligar descarta o que estava pela metade (o Esc também desiste do texto).
  const [ligadoAntes, setLigadoAntes] = useState(ligado);
  if (ligadoAntes !== ligado) {
    // Ajuste durante o render (padrão do React para estado derivado de props).
    setLigadoAntes(ligado);
    if (ligado) {
      setFerramentaEscolhida("caneta");
    } else {
      gesto.current = null;
      edicaoAtual.current = null;
      setRascunho(null);
      setTextoEmEdicao(null);
    }
  }

  // Ligado, o foco vem para a camada: as teclas não ficam presas na página (outro documento).
  useEffect(() => {
    if (ligado) {
      camada.current?.focus({ preventScroll: true });
    }
  }, [ligado]);

  const trocarTracos = useCallback((novos: TracoDoDesenho[]) => {
    tracosAtuais.current = novos;
    setTracos(novos);
  }, []);

  /** Um passo do desenho: guarda o antes para o desfazer, mostra o depois e grava. */
  const registrar = useCallback(
    (antes: TracoDoDesenho[], depois: TracoDoDesenho[]) => {
      setPassados((atuais) => [...atuais, antes].slice(-LIMITE_DO_DESFAZER));
      trocarTracos(depois);
      salvarDesenhoDaTelaCheia(artefatoId, depois);
    },
    [artefatoId, trocarTracos],
  );

  const desfazer = useCallback(() => {
    const anterior = passados.at(-1);
    if (anterior === undefined) {
      return;
    }
    setPassados(passados.slice(0, -1));
    trocarTracos(anterior);
    salvarDesenhoDaTelaCheia(artefatoId, anterior);
  }, [artefatoId, passados, trocarTracos]);

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
      if (nova !== "selecionar") {
        setFerramentaEscolhida(nova);
      }
    },
    [confirmarTexto],
  );

  const desligar = useCallback(() => {
    confirmarTexto();
    aoDesligar();
  }, [aoDesligar, confirmarTexto]);

  /** O ponto em pixels do corpo da tela cheia (a camada o preenche), com uma casa. */
  const noCorpo = useCallback((evento: { clientX: number; clientY: number }): Ponto => {
    const caixa = svg.current?.getBoundingClientRect();
    return {
      x: Math.round((evento.clientX - (caixa?.left ?? 0)) * 10) / 10,
      y: Math.round((evento.clientY - (caixa?.top ?? 0)) * 10) / 10,
    };
  }, []);

  /** A borracha nos pontos dados: os traços tocados saem (o desfazer guarda o antes no fim do gesto). */
  const apagarEm = useCallback(
    (pontos: readonly Ponto[]) => {
      const restantes = tracosAtuais.current.filter(
        (traco) => !pontos.some((ponto) => tracoTocado(traco, ponto, RAIO_DA_BORRACHA_PX)),
      );
      if (restantes.length !== tracosAtuais.current.length) {
        trocarTracos(restantes);
      }
    },
    [trocarTracos],
  );

  const aoApertar = (evento: EventoDePonteiroDoReact<SVGSVGElement>) => {
    if (!ligado || evento.button !== 0) {
      return;
    }
    // Sem o mousedown que viria depois: o foco fica onde está (o campo do texto solto, ao abrir).
    evento.preventDefault();
    confirmarTexto();
    const ponto = noCorpo(evento);
    if (ferramentaEscolhida === "texto") {
      mudarEdicao({ em: ponto, valor: "", cor, espessura: ESPESSURA_DA_TELA_CHEIA });
      return;
    }
    evento.currentTarget.setPointerCapture?.(evento.pointerId);
    if (ferramentaEscolhida === "borracha") {
      gesto.current = { tipo: "borracha", ultimo: ponto, antes: tracosAtuais.current };
      apagarEm([ponto]);
      return;
    }
    const traco: TracoDoDesenho = {
      id: crypto.randomUUID(),
      tipo: ferramentaEscolhida,
      cor,
      espessura: ESPESSURA_DA_TELA_CHEIA,
      pontos: ferramentaEscolhida === "caneta" ? [ponto] : [ponto, ponto],
    };
    gesto.current = { tipo: "traco", traco, antes: tracosAtuais.current };
    setRascunho(traco);
  };

  const aoMover = (evento: EventoDePonteiroDoReact<SVGSVGElement>) => {
    const atual = gesto.current;
    if (atual === null) {
      return;
    }
    const ponto = noCorpo(evento);
    if (atual.tipo === "borracha") {
      apagarEm(pontosEntre(atual.ultimo, ponto, RAIO_DA_BORRACHA_PX));
      atual.ultimo = ponto;
      return;
    }
    const { traco } = atual;
    let pontos: Ponto[];
    if (traco.tipo === "caneta") {
      const ultimo = traco.pontos[traco.pontos.length - 1];
      if (
        traco.pontos.length >= MAXIMO_DE_PONTOS_NO_TRACO ||
        (ultimo !== undefined && distancia(ultimo, ponto) < DISTANCIA_MINIMA_ENTRE_PONTOS_PX)
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
    if (traco.tipo === "caneta") {
      registrar(atual.antes, [
        ...atual.antes,
        { ...traco, pontos: simplificarPontos(traco.pontos, TOLERANCIA_DA_SIMPLIFICACAO_PX) },
      ]);
      return;
    }
    // Um clique sem arrastar não vira uma forma de tamanho zero.
    if (de === undefined || ate === undefined || distancia(de, ate) < DISTANCIA_MINIMA_ENTRE_PONTOS_PX) {
      return;
    }
    registrar(atual.antes, [...atual.antes, { ...traco, pontos: simplificarPontos(traco.pontos, 0) }]);
  };

  // Ctrl/Cmd+Z desfaz, só com o modo ligado.
  useEffect(() => {
    if (!ligado) {
      return;
    }
    const aoApertarTecla = (evento: KeyboardEvent) => {
      if (evento.defaultPrevented || focoEmCampoDeTexto(evento.target)) {
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
  }, [ligado, desfazer]);

  const aoTeclarNoTexto = (evento: EventoDeTeclaDoReact<HTMLInputElement>) => {
    if (evento.key === "Enter") {
      evento.preventDefault();
      confirmarTexto();
    }
  };

  return (
    <>
      <div
        ref={camada}
        tabIndex={-1}
        className={`camada-de-desenho desenho-da-tela-cheia ${ligado ? "camada-de-desenho-ativa" : ""}`}
        data-ferramenta={ligado ? ferramentaEscolhida : "selecionar"}
        data-ligado={ligado}
        data-testid="desenho-da-tela-cheia"
      >
        <svg
          ref={svg}
          className="camada-de-desenho-svg"
          role={ligado ? "application" : undefined}
          aria-label={ligado ? "Área de desenho sobre a página" : undefined}
          aria-hidden={ligado ? undefined : true}
          onPointerDown={aoApertar}
          onPointerMove={aoMover}
          onPointerUp={aoSoltar}
          onPointerCancel={aoSoltar}
        >
          {tracos.map((traco) => (
            <TracoDesenhado key={traco.id} traco={traco} />
          ))}
          {rascunho !== null && <TracoDesenhado traco={rascunho} />}
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
              left: textoEmEdicao.em.x,
              top: textoEmEdicao.em.y,
              fontSize: tamanhoDoTexto(textoEmEdicao.espessura),
            }}
            onChange={(evento) => mudarEdicao({ ...textoEmEdicao, valor: evento.target.value })}
            onKeyDown={aoTeclarNoTexto}
            onBlur={confirmarTexto}
          />
        )}
      </div>
      {ligado && (
        <div className="barra-do-desenho-da-tela-cheia">
          <BarraDeDesenho
            ferramenta={ferramentaEscolhida}
            cor={cor}
            espessura={ESPESSURA_DA_TELA_CHEIA}
            podeDesfazer={passados.length > 0}
            aoEscolherFerramenta={escolherFerramenta}
            aoEscolherCor={setCor}
            aoEscolherEspessura={() => undefined}
            aoDesfazer={desfazer}
            aoFechar={desligar}
            ferramentas={FERRAMENTAS_DA_TELA_CHEIA}
            comEspessura={false}
            fechar={FECHAR_DA_TELA_CHEIA}
          />
        </div>
      )}
    </>
  );
});
