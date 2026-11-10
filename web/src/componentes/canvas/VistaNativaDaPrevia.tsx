import { type MouseEvent, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { ApiDaPrevia, RetanguloDaPrevia } from "../../shared/ponteDoDesktop";
import {
  calcularRetangulo,
  type HistoricoDaVista,
  mesmoRetangulo,
  pontosDeAmostra,
  SEM_HISTORICO,
} from "../../shared/previaNativa";

/** Quanto o ponteiro pode andar entre apertar e soltar para ainda contar como clique (e não arraste). */
const DISTANCIA_MAXIMA_DO_CLIQUE_PX = 5;

/** O estado da página que o app desktop avisa. */
interface EstadoDaPagina {
  carregando: boolean;
  erro: string | null;
}

/**
 * Onde o corpo da prévia está agora e se algo está por cima dele: o retângulo
 * (cortado pela área do canvas) e se algum dos pontos de amostra cai em outro
 * elemento da tela (painel, menu, cabeçalho). Nulo: o corpo não está na tela.
 */
function medirCorpo(corpo: HTMLElement): { retangulo: RetanguloDaPrevia; coberta: boolean } | null {
  const area = corpo.closest(".react-flow")?.getBoundingClientRect() ?? {
    left: 0,
    top: 0,
    width: window.innerWidth,
    height: window.innerHeight,
  };
  const retangulo = calcularRetangulo(corpo.getBoundingClientRect(), area, corpo.offsetWidth);
  if (retangulo === null) {
    return null;
  }
  const coberta =
    typeof document.elementFromPoint === "function" &&
    pontosDeAmostra(retangulo).some(({ x, y }) => {
      const elemento = document.elementFromPoint(x, y);
      return elemento === null || !corpo.contains(elemento);
    });
  return { retangulo, coberta };
}

/**
 * O site externo da prévia no app desktop: um WebContentsView nativo, com
 * sessão própria (login salvo), que fica por cima do DOM. Por isso ele só
 * aparece enquanto a prévia está "ativa" (o usuário clicou nela); inativa, o
 * corpo mostra a última foto da página (tirada ao desativar; antes do primeiro
 * uso não há foto), e a roda e a pinça seguem movendo o
 * canvas, como nos mapas embutidos.
 *
 * Ativa, a vista acompanha o corpo da prévia a cada quadro (arrasto, zoom e
 * pan do canvas, redimensionar). Ela volta a ser foto quando: um clique cai
 * fora do bloco, o corpo sai da tela ou é coberto por um painel ou menu, a
 * prévia é minimizada (`suspensa`), a janela do app minimiza, o modo invisível
 * liga ou o usuário aperta Shift+Esc dentro da página (o Esc sozinho é da
 * página). A vista é destruída quando a prévia fecha ou o endereço muda (o
 * pai troca a `key`).
 *
 * Em tela cheia (`corpoAmpliado`, o corpo do modal em `document.body`), o corpo
 * da prévia (foto, camada de ativar) passa para lá, e a vista segue esse corpo,
 * recortado pela janela inteira (fora do canvas não há `.react-flow`). É a mesma
 * vista: nada é recriado, só muda o que ela acompanha; ao sair, volta ao canvas.
 */
export function VistaNativaDaPrevia({
  previaId,
  url,
  api,
  suspensa,
  corpoAmpliado,
  aoMudarOrigem,
  aoMudarHistorico,
}: {
  previaId: string;
  url: string;
  api: ApiDaPrevia;
  /** Algo da prévia (o menu) vai ficar por cima da vista, ou ela está minimizada. */
  suspensa: boolean;
  /** O corpo da tela cheia, quando a prévia está ampliada e o modal já existe; senão, `null`. */
  corpoAmpliado: HTMLElement | null;
  /**
   * A origem real (só protocolo e host) da página que está aberta agora, a cada navegação; `null` até a
   * primeira página e ao desmontar. A barra da prévia mostra o host e destaca a troca de domínio.
   */
  aoMudarOrigem: (origem: string | null) => void;
  /** Se dá para voltar e avançar, a cada navegação; sem histórico ao desmontar. */
  aoMudarHistorico: (historico: HistoricoDaVista) => void;
}) {
  const raiz = useRef<HTMLDivElement>(null);
  const inicioDoClique = useRef<{ x: number; y: number } | null>(null);
  const [ativa, setAtiva] = useState(false);
  const [foto, setFoto] = useState<string | null>(null);
  const [pagina, setPagina] = useState<EstadoDaPagina>({ carregando: true, erro: null });

  // Algo por cima (menu) ou minimizada: volta a ser foto. O efeito da ativação avisa o app.
  if (suspensa && ativa) {
    setAtiva(false);
  }

  // Abre a vista (escondida) com o tamanho aproximado do corpo e a destrói ao sair.
  useEffect(() => {
    const medida = raiz.current === null ? null : medirCorpo(raiz.current);
    void api.abrir(previaId, url, medida?.retangulo);
    return () => void api.fechar(previaId);
  }, [api, previaId, url]);

  // O pai guarda a origem; a referência evita reassinar o aviso do app quando o callback troca de identidade.
  const avisarOrigem = useRef(aoMudarOrigem);
  const avisarHistorico = useRef(aoMudarHistorico);
  useEffect(() => {
    avisarOrigem.current = aoMudarOrigem;
    avisarHistorico.current = aoMudarHistorico;
  });

  useEffect(
    () =>
      api.aoMudar((evento) => {
        // Sair das contas: as fotos guardadas mostram páginas que estavam logadas.
        if (evento.tipo === "sessao-limpa") {
          setFoto(null);
          return;
        }
        if (evento.id !== previaId) {
          return;
        }
        if (evento.tipo === "foto") {
          setFoto(evento.foto);
        } else if (evento.tipo === "estado") {
          setPagina({ carregando: evento.carregando, erro: evento.erro });
          avisarOrigem.current(evento.origem ?? null);
          avisarHistorico.current({ podeVoltar: evento.podeVoltar === true, podeAvancar: evento.podeAvancar === true });
        } else {
          setAtiva(false);
        }
      }),
    [api, previaId],
  );

  // Ao sair (fechar, trocar o endereço, recarregar), a barra deixa de mostrar o host desta vista.
  useEffect(
    () => () => {
      avisarOrigem.current(null);
      avisarHistorico.current(SEM_HISTORICO);
    },
    [],
  );

  // Ativa: mostra a vista e a faz seguir o corpo; ao desativar (por qualquer motivo), esconde.
  useEffect(() => {
    const corpo = raiz.current;
    if (!ativa || corpo === null) {
      return;
    }
    let quadro = 0;
    let ultimo: RetanguloDaPrevia | null = null;
    const passo = () => {
      const medida = medirCorpo(corpo);
      if (medida === null || medida.coberta) {
        setAtiva(false);
        return;
      }
      if (ultimo === null) {
        void api.ativar(previaId, true, medida.retangulo).then((aceita) => {
          if (!aceita) {
            setAtiva(false);
          }
        });
      } else if (!mesmoRetangulo(ultimo, medida.retangulo)) {
        api.retangulo(previaId, medida.retangulo);
      }
      ultimo = medida.retangulo;
      quadro = requestAnimationFrame(passo);
    };
    quadro = requestAnimationFrame(passo);

    // O bloco inteiro (barra incluída): clicar nele não desativa. Um clique fora dele
    // chega à tela mesmo com a vista ativa (a vista só cobre o corpo da prévia).
    const bloco = corpo.closest(".react-flow__node") ?? corpo.closest(".janela-previa, .janela-em-tela-cheia") ?? corpo;
    const aoPressionar = (evento: PointerEvent) => {
      if (evento.target instanceof Node && !bloco.contains(evento.target)) {
        setAtiva(false);
      }
    };
    document.addEventListener("pointerdown", aoPressionar, true);
    return () => {
      cancelAnimationFrame(quadro);
      document.removeEventListener("pointerdown", aoPressionar, true);
      void api.ativar(previaId, false);
    };
  // Trocar de corpo (ampliar, sair da tela cheia) refaz o acompanhamento no corpo novo.
  }, [api, previaId, ativa, corpoAmpliado]);

  function aoClicar(evento: MouseEvent<HTMLButtonElement>): void {
    const inicio = inicioDoClique.current;
    inicioDoClique.current = null;
    // Soltou depois de arrastar: foi um gesto no canvas, não um pedido para usar a página.
    if (
      inicio !== null &&
      Math.hypot(evento.clientX - inicio.x, evento.clientY - inicio.y) > DISTANCIA_MAXIMA_DO_CLIQUE_PX
    ) {
      return;
    }
    setAtiva(true);
  }

  const vista = (
    <div ref={raiz} className="vista-nativa-da-previa">
      {foto !== null ? (
        <img className="foto-da-previa" src={foto} alt={`Foto de ${url}`} draggable={false} />
      ) : (
        <p className="mensagem-da-previa">
          {pagina.erro !== null
            ? `Não foi possível abrir ${url}: ${pagina.erro}`
            : pagina.carregando
              ? "Carregando a página…"
              : "Clique para usar a página."}
        </p>
      )}
      {!ativa && (
        <button
          type="button"
          className="camada-de-ativar"
          aria-label="Usar a página"
          onMouseDown={(evento) => {
            inicioDoClique.current = { x: evento.clientX, y: evento.clientY };
          }}
          onClick={aoClicar}
        >
          <span className="dica-da-camada" aria-hidden="true">
            clique para usar a página (clique fora ou Shift+Esc para voltar ao canvas)
          </span>
        </button>
      )}
    </div>
  );
  return corpoAmpliado === null ? vista : createPortal(vista, corpoAmpliado);
}
