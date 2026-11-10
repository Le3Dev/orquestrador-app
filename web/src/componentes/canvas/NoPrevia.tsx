import { Handle, type NodeProps, NodeResizer, Position } from "@xyflow/react";
import {
  type CSSProperties,
  type KeyboardEvent,
  memo,
  type MouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { useAcoesDoCanvas } from "../../shared/canvas/contexto";
import { TAMANHO_MINIMO_DA_PREVIA } from "../../shared/canvas/layout";
import { ALCA_DA_PREVIA, type Ancora, type NoPrevia as TipoDoNo } from "../../shared/canvas/nos";
import { enderecoDigitado } from "../../shared/enderecosLocais";
import { apiDaPrevia } from "../../shared/ponteDoDesktop";
import { hostDaOrigem, modoDaPrevia, mudouDeDominio } from "../../shared/previaNativa";
import { Dica } from "../Dica";
import { IconeAbrirFora, IconeNavegador, IconeRecarregar } from "../Icones";
import { ControlesDoNo } from "./ControlesDoNo";
import { MenuDaPrevia } from "./MenuDaPrevia";
import { VistaNativaDaPrevia } from "./VistaNativaDaPrevia";

export const ENDERECO_INVALIDO = "Endereço inválido: use http ou https (ex.: localhost:5173).";

/** As alças de redimensionar. Memorizadas: o arraste não as re-renderiza a cada quadro. */
const RedimensionadorDaPrevia = memo(function RedimensionadorDaPrevia({ visivel }: { visivel: boolean }) {
  return (
    <NodeResizer
      isVisible={visivel}
      minWidth={TAMANHO_MINIMO_DA_PREVIA.largura}
      minHeight={TAMANHO_MINIMO_DA_PREVIA.altura}
      lineClassName="redimensionador-linha"
      handleClassName="redimensionador-alca"
    />
  );
});

/** Onde chega a linha do terminal de que a prévia saiu: o meio de cada lado (`ladoDaPrevia`). */
const ANCORAS_DA_PREVIA: readonly { id: Ancora; posicao: Position }[] = [
  { id: "cima", posicao: Position.Top },
  { id: "baixo", posicao: Position.Bottom },
  { id: "esquerda", posicao: Position.Left },
  { id: "direita", posicao: Position.Right },
];

const AncorasDaPrevia = memo(function AncorasDaPrevia() {
  return (
    <>
      {ANCORAS_DA_PREVIA.map(({ id, posicao }) => (
        <Handle key={id} id={id} type="target" position={posicao} className="ancora" isConnectable={false} />
      ))}
    </>
  );
});

/**
 * Uma prévia ao vivo no canvas: um navegador pequeno com o site que um agente
 * subiu (o recarregamento automático do Vite ou do Next a mantém em dia).
 * Arrasta pela barra de título, redimensiona pelas bordas quando selecionada e
 * se minimiza à barra, como a nota.
 *
 * Aqui fica só a moldura (o React Flow re-renderiza o nó a cada quadro do
 * arraste); a janela é memorizada e o site não recarrega ao mover.
 */
export const NoPrevia = memo(function NoPrevia({ data, selected }: NodeProps<TipoDoNo>) {
  return (
    <>
      <RedimensionadorDaPrevia visivel={selected && !data.minimizada} />
      <AncorasDaPrevia />
      <JanelaDaPrevia
        previaId={data.previaId}
        url={data.url}
        minimizada={data.minimizada}
        focarAoAbrir={selected && data.url === ""}
      />
    </>
  );
});

interface PropsDoCampo {
  url: string;
  /** Recém-criada sem endereço: o campo já nasce com o foco. Só vale na montagem. */
  focarAoAbrir: boolean;
  aoNavegar: (url: string) => void;
}

/** A barra de endereço: Enter navega (só http e https), Esc volta ao endereço aberto. */
function CampoDoEndereco({ url, focarAoAbrir, aoNavegar }: PropsDoCampo) {
  const [texto, setTexto] = useState(url);
  const [invalido, setInvalido] = useState(false);
  const [focarNaMontagem] = useState(focarAoAbrir);
  const [urlAnterior, setUrlAnterior] = useState(url);
  const campo = useRef<HTMLInputElement>(null);

  // O endereço mudou por fora (navegou, ou o canvas reabriu a prévia): o campo acompanha.
  if (url !== urlAnterior) {
    setUrlAnterior(url);
    setTexto(url);
    setInvalido(false);
  }

  useEffect(() => {
    if (focarNaMontagem) {
      // Sem rolar: o foco num elemento do canvas faria o navegador deslocá-lo.
      campo.current?.focus({ preventScroll: true });
    }
  }, [focarNaMontagem]);

  function aoTeclar(evento: KeyboardEvent<HTMLInputElement>): void {
    if (evento.key === "Enter") {
      evento.preventDefault();
      const destino = enderecoDigitado(texto);
      if (destino === null) {
        setInvalido(true);
        return;
      }
      setTexto(destino);
      aoNavegar(destino);
    } else if (evento.key === "Escape") {
      setTexto(url);
      setInvalido(false);
      evento.currentTarget.blur();
    }
  }

  return (
    <input
      ref={campo}
      className={`campo-do-endereco nodrag ${invalido ? "campo-do-endereco-invalido" : ""}`}
      aria-label="Endereço da prévia"
      aria-invalid={invalido}
      title={invalido ? ENDERECO_INVALIDO : "Digite o endereço e pressione Enter"}
      placeholder="localhost:5173"
      spellCheck={false}
      autoComplete="off"
      value={texto}
      onChange={(evento) => {
        setTexto(evento.target.value);
        setInvalido(false);
      }}
      onKeyDown={aoTeclar}
    />
  );
}

/** O estilo do iframe enquanto a camada de ativar o cobre. */
const SEM_PONTEIRO: CSSProperties = { pointerEvents: "none" };

/** Quanto o ponteiro pode andar entre apertar e soltar para ainda contar como clique (e não arraste). */
const DISTANCIA_MAXIMA_DO_CLIQUE_PX = 5;

/**
 * Um iframe no canvas que só recebe o mouse depois de "ativado", como os mapas
 * embutidos em sites. Os eventos dentro de um iframe nunca chegam ao app: sem
 * isso, com o mouse em cima dele, a roda e a pinça não dariam zoom nem moveriam
 * o canvas.
 *
 * Inativo, uma camada transparente cobre o iframe. Ela não tem `nowheel` nem
 * `nodrag` (e nenhum ancestral tem): a roda e a pinça vão ao React Flow, e
 * arrastar faz o mesmo que no resto do corpo do bloco. Um clique (ou Enter e
 * Espaço, pelo teclado) ativa: a camada some e o iframe recebe o foco. Um
 * `pointerdown` fora do bloco ou Esc desativa de novo.
 *
 * `children` recebe o estilo do iframe: sem `pointer-events` enquanto inativo.
 */
export function QuadroAtivavel({ children }: { children: (estilo: CSSProperties | undefined) => ReactNode }) {
  const [ativo, setAtivo] = useState(false);
  const raiz = useRef<HTMLDivElement>(null);
  const inicioDoClique = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!ativo) {
      return;
    }
    const quadro = raiz.current;
    quadro?.querySelector("iframe")?.focus({ preventScroll: true });
    // O bloco inteiro (barra incluída): clicar nele não desativa.
    const bloco = quadro?.closest(".react-flow__node") ?? quadro?.closest(".janela-previa, .janela-artefato") ?? quadro;
    const aoPressionar = (evento: PointerEvent) => {
      if (bloco !== null && evento.target instanceof Node && !bloco.contains(evento.target)) {
        setAtivo(false);
      }
    };
    const aoTeclar = (evento: globalThis.KeyboardEvent) => {
      if (evento.key === "Escape") {
        setAtivo(false);
      }
    };
    document.addEventListener("pointerdown", aoPressionar, true);
    document.addEventListener("keydown", aoTeclar, true);
    return () => {
      document.removeEventListener("pointerdown", aoPressionar, true);
      document.removeEventListener("keydown", aoTeclar, true);
    };
  }, [ativo]);

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
    setAtivo(true);
  }

  return (
    <div ref={raiz} className="quadro-ativavel">
      {children(ativo ? undefined : SEM_PONTEIRO)}
      {!ativo && (
        <button
          type="button"
          className="camada-de-ativar"
          aria-label="Usar a página"
          onMouseDown={(evento) => {
            inicioDoClique.current = { x: evento.clientX, y: evento.clientY };
          }}
          onClick={aoClicar}
          onKeyDown={(evento) => {
            if (evento.key === "Enter" || evento.key === " ") {
              evento.preventDefault();
              setAtivo(true);
            }
          }}
        >
          <span className="dica-da-camada" aria-hidden="true">
            clique para usar a página
          </span>
        </button>
      )}
    </div>
  );
}

/** O que o site da prévia pode fazer. Fica de fora a navegação da janela de cima (`allow-top-navigation`). */
const PERMISSOES_DA_PREVIA =
  "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads";

/**
 * O site. O iframe nasce sem `src`: a tela é servida com
 * `Cross-Origin-Embedder-Policy: credentialless` (isolarOrigem, em
 * src/root.ts), e um site de outra origem só carrega num iframe que já tem o
 * atributo `credentialless` quando o endereço chega. Por isso os dois são
 * definidos aqui, nessa ordem, quando o iframe entra na página.
 *
 * O `sandbox` (também antes do endereço) deixa o site rodar como num
 * navegador, mas sem navegar a janela de cima: um link `target="_top"` ou um
 * `top.location = ...` trocaria a tela inteira pelo site, e no app desktop não
 * há como voltar.
 *
 * Memorizado: só recarrega quando o endereço muda ou a `versao` (o botão
 * recarregar, que recria o iframe) muda; nunca ao mover ou redimensionar.
 */
const QuadroDoSite = memo(function QuadroDoSite({
  url,
  versao,
  estilo,
}: {
  url: string;
  versao: number;
  estilo: CSSProperties | undefined;
}) {
  const ligar = useCallback(
    (iframe: HTMLIFrameElement | null) => {
      if (iframe !== null) {
        iframe.setAttribute("credentialless", "");
        iframe.setAttribute("sandbox", PERMISSOES_DA_PREVIA);
        iframe.src = url;
      }
    },
    [url],
  );
  return (
    <iframe
      key={versao}
      ref={ligar}
      title={`Prévia de ${url}`}
      className="quadro-da-previa nodrag nowheel"
      style={estilo}
    />
  );
});

/** De quanto em quanto tempo a prévia confere se algo responde no endereço. */
export const INTERVALO_DA_VERIFICACAO_MS = 3000;

/**
 * Quanto tempo seguido sem resposta até a prévia fechar sozinha. Dá tempo para
 * um servidor de desenvolvimento subir quando a prévia abre antes dele.
 */
export const TEMPO_ATE_FECHAR_SEM_SERVIDOR_MS = 30_000;

/**
 * Confere, na abertura e a cada `INTERVALO_DA_VERIFICACAO_MS`, se algo
 * responde no endereço. Sem servidor o iframe vai para uma página de erro
 * interna do navegador, em branco, e não volta sozinho quando o servidor sobe.
 *
 * O pedido é `no-cors`: a resposta de outra origem chega opaca, mas chegar já
 * basta (só erro de rede conta como fora do ar). Um pedido por vez: o próximo
 * só sai depois que o anterior termina.
 *
 * `aoVoltar` roda quando algo responde depois de uma falha (recarrega o site);
 * `aoDesistir`, quando fica fora do ar por `TEMPO_ATE_FECHAR_SEM_SERVIDOR_MS`
 * seguidos (fecha a prévia). Qualquer resposta zera a contagem.
 *
 * `manterAberta` cancela o fechamento até o servidor voltar: se ele voltar e
 * cair de novo, a contagem recomeça do zero. Sem endereço, não confere nada.
 */
function useServidorForaDoAr(url: string, aoVoltar: () => void, aoDesistir: () => void): ServidorDaPrevia {
  // Guarda o endereço junto: trocar de endereço volta a mostrar o site até a nova conferência.
  const [estado, setEstado] = useState<EstadoDoServidor>({ url, fora: false, fechaEm: null });
  // O relógio da contagem: anda na conferência e, enquanto há prazo, a cada segundo.
  const [agora, setAgora] = useState(0);
  // Pediram para manter aberta: vale até o servidor responder (ou o endereço mudar).
  const mantida = useRef(false);
  // Os retornos mais recentes, sem reiniciar a contagem quando trocam de identidade.
  const retornos = useRef({ aoVoltar, aoDesistir });
  useEffect(() => {
    retornos.current = { aoVoltar, aoDesistir };
  });

  useEffect(() => {
    if (url === "") {
      return;
    }
    let ativo = true;
    let espera: ReturnType<typeof setTimeout> | undefined;
    let foraDesde: number | null = null;
    mantida.current = false;

    async function verificar(): Promise<void> {
      let respondeu = true;
      try {
        await fetch(url, { mode: "no-cors", cache: "no-store" });
      } catch {
        respondeu = false;
      }
      if (!ativo) {
        return;
      }
      let fechaEm: number | null = null;
      if (respondeu) {
        if (foraDesde !== null) {
          retornos.current.aoVoltar();
        }
        foraDesde = null;
        mantida.current = false;
      } else {
        const instante = Date.now();
        foraDesde ??= instante;
        if (!mantida.current) {
          if (instante - foraDesde >= TEMPO_ATE_FECHAR_SEM_SERVIDOR_MS) {
            ativo = false;
            retornos.current.aoDesistir();
            return;
          }
          fechaEm = foraDesde + TEMPO_ATE_FECHAR_SEM_SERVIDOR_MS;
          setAgora(instante);
        }
      }
      const fora = !respondeu;
      setEstado((atual) =>
        atual.url === url && atual.fora === fora && atual.fechaEm === fechaEm ? atual : { url, fora, fechaEm },
      );
      espera = setTimeout(() => void verificar(), INTERVALO_DA_VERIFICACAO_MS);
    }

    void verificar();
    return () => {
      ativo = false;
      clearTimeout(espera);
    };
  }, [url]);

  const doEndereco = estado.url === url;
  const fechaEm = doEndereco ? estado.fechaEm : null;

  // Um passo por segundo enquanto a prévia vai fechar. O prazo não muda ao
  // longo de uma queda: o relógio só reinicia numa queda nova.
  useEffect(() => {
    if (fechaEm === null) {
      return;
    }
    const relogio = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(relogio);
  }, [fechaEm]);

  const manterAberta = useCallback(() => {
    mantida.current = true;
    setEstado((atual) => (atual.fechaEm === null ? atual : { ...atual, fechaEm: null }));
  }, []);

  return { fora: doEndereco && estado.fora, fechaEm, agora, manterAberta };
}

interface EstadoDoServidor {
  url: string;
  fora: boolean;
  fechaEm: number | null;
}

interface ServidorDaPrevia {
  /** O endereço não respondeu à última conferência. */
  fora: boolean;
  /** Quando (em `Date.now()`) a prévia fecha sozinha; `null` no ar ou mantida aberta. */
  fechaEm: number | null;
  /** O instante da contagem, atualizado a cada segundo enquanto há prazo. */
  agora: number;
  /** Cancela o fechamento automático até o servidor voltar. */
  manterAberta: () => void;
}

/** Segundos inteiros até a prévia fechar (de `TEMPO_ATE_FECHAR_SEM_SERVIDOR_MS / 1000` a 0), ou `null` sem prazo. */
function segundosAteFechar(fechaEm: number | null, agora: number): number | null {
  if (fechaEm === null) {
    return null;
  }
  const total = TEMPO_ATE_FECHAR_SEM_SERVIDOR_MS / 1000;
  return Math.min(total, Math.max(0, Math.ceil((fechaEm - agora) / 1000)));
}

/** O raio do anel da contagem, no `viewBox` de 48 × 48. */
const RAIO_DO_ANEL = 21;
const VOLTA_DO_ANEL = 2 * Math.PI * RAIO_DO_ANEL;

/**
 * O anel que esvazia até a prévia fechar, com os segundos no meio. Cada passo
 * desliza por um segundo inteiro (CSS), e o anel parece andar sem parar.
 */
function AnelDaContagem({ segundos }: { segundos: number }) {
  const falta = segundos / (TEMPO_ATE_FECHAR_SEM_SERVIDOR_MS / 1000);
  return (
    <div className="anel-da-contagem" role="timer" aria-label={`A prévia fecha em ${segundos} segundos`}>
      <svg viewBox="0 0 48 48" width="48" height="48" aria-hidden="true">
        <circle className="trilho-do-anel" cx="24" cy="24" r={RAIO_DO_ANEL} />
        <circle
          className="progresso-do-anel"
          cx="24"
          cy="24"
          r={RAIO_DO_ANEL}
          style={{ strokeDasharray: VOLTA_DO_ANEL, strokeDashoffset: VOLTA_DO_ANEL * (1 - falta) }}
        />
      </svg>
      <span className="segundos-do-anel" aria-hidden="true">
        {segundos}
      </span>
    </div>
  );
}

interface PropsDaJanela {
  previaId: string;
  url: string;
  minimizada: boolean;
  focarAoAbrir: boolean;
}

const JanelaDaPrevia = memo(function JanelaDaPrevia({ previaId, url, minimizada, focarAoAbrir }: PropsDaJanela) {
  const acoes = useAcoesDoCanvas();
  const [versao, setVersao] = useState(0);
  const [menuAberto, setMenuAberto] = useState(false);
  // O host real da página que a vista nativa mostra agora (muda ao navegar, sem mudar o endereço aberto).
  const [origemAtual, setOrigemAtual] = useState<string | null>(null);
  const recarregar = useCallback(() => setVersao((atual) => atual + 1), []);
  const fechar = useCallback(() => acoes.fecharPrevia(previaId), [acoes, previaId]);
  // Endereço externo: vista nativa no app desktop (login salvo), "abrir em nova aba" no navegador.
  const apiNativa = apiDaPrevia();
  const modo = modoDaPrevia(url, apiNativa !== null);
  // Minimizada também confere e fecha: o corpo só fica escondido. Só o servidor local
  // (iframe) é conferido: um site externo fora do ar (ou sem rede) não fecha a prévia.
  const servidor = useServidorForaDoAr(modo === "iframe" ? url : "", recarregar, fechar);
  const segundos = segundosAteFechar(servidor.fechaEm, servidor.agora);
  const semEndereco = url === "";
  const hostAtual = modo === "vista-nativa" ? hostDaOrigem(origemAtual) : null;
  const outroDominio = hostAtual !== null && mudouDeDominio(url, origemAtual);

  const navegar = useCallback(
    (destino: string) => {
      // O mesmo endereço de novo: o usuário quer ver a página outra vez.
      if (destino === url) {
        recarregar();
      } else {
        acoes.navegarPrevia(previaId, destino);
      }
    },
    [acoes, previaId, url, recarregar],
  );

  // A prévia não tem tela cheia: o que existe hoje é minimizar e fechar.
  const controlesDaJanela = {
    objeto: "a prévia",
    aoMinimizar: () => acoes.minimizarOuRestaurarPrevia(previaId),
    minimizada,
    aoFechar: () => acoes.fecharPrevia(previaId),
  };

  return (
    <div className={`janela-previa ${minimizada ? "janela-previa-minimizada" : ""}`}>
      <div className={`barra-da-previa ${ALCA_DA_PREVIA}`}>
        <ControlesDoNo lado="inicio" {...controlesDaJanela} />
        <IconeNavegador className="shrink-0 text-info" />
        <CampoDoEndereco url={url} focarAoAbrir={focarAoAbrir} aoNavegar={navegar} />
        {hostAtual !== null && (
          <span
            className={`host-atual-da-previa ${outroDominio ? "host-atual-da-previa-mudou" : ""}`}
            role="note"
            title={
              outroDominio
                ? `A página agora está em ${hostAtual}, outro site em relação ao endereço aberto (${url}). Confira antes de digitar senhas.`
                : `Página aberta agora: ${hostAtual}`
            }
            aria-label={outroDominio ? `Atenção: a página mudou para outro site, ${hostAtual}` : `Página aberta agora: ${hostAtual}`}
          >
            {outroDominio && <span aria-hidden="true">⚠ </span>}
            {hostAtual}
          </span>
        )}
        {/* Minimizada, o anel fica escondido no corpo: a contagem vem para a barra. */}
        {minimizada && segundos !== null && (
          <span
            className="contagem-na-barra"
            role="timer"
            aria-label={`A prévia fecha em ${segundos} segundos`}
            title="Nada respondendo: a prévia fecha sozinha se o servidor não subir"
          >
            {segundos}
          </span>
        )}
        <button
          type="button"
          className="botao-icone nodrag"
          title="Recarregar a página"
          aria-label="Recarregar a página"
          disabled={semEndereco}
          onClick={recarregar}
        >
          <IconeRecarregar />
        </button>
        {semEndereco ? (
          <button
            type="button"
            className="botao-icone nodrag"
            title="Abrir no navegador"
            aria-label="Abrir no navegador"
            disabled
          >
            <IconeAbrirFora />
          </button>
        ) : (
          <a
            className="botao-icone nodrag"
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            title="Abrir no navegador"
            aria-label="Abrir no navegador"
          >
            <IconeAbrirFora />
          </a>
        )}
        {modo === "iframe" && (
          <span className="nodrag flex">
            <Dica sobre="a prévia" titulo="Ficou em branco?">
              Alguns sites não aceitam abrir dentro de outra página; use abrir no navegador. Login com cookie também
              pode não manter a sessão aqui.
            </Dica>
          </span>
        )}
        {apiNativa !== null && <MenuDaPrevia api={apiNativa} aberto={menuAberto} aoMudar={setMenuAberto} />}
        <ControlesDoNo lado="fim" {...controlesDaJanela} />
      </div>
      {/* Minimizada, o site continua carregado (só escondido): restaurar não o recarrega. */}
      <div className="corpo-da-previa" hidden={minimizada}>
        {semEndereco ? (
          <p className="mensagem-da-previa">
            Digite acima o endereço do servidor de desenvolvimento (por exemplo, localhost:5173) e pressione Enter.
          </p>
        ) : servidor.fora ? (
          // Com prazo, o anel conta os segundos; mantida aberta, só o aviso e o fechar à mão.
          <div className="mensagem-da-previa mensagem-fora-do-ar">
            {segundos !== null && <AnelDaContagem segundos={segundos} />}
            {segundos !== null ? (
              <p>Nada respondendo em {url}. A prévia fecha sozinha se o servidor não subir.</p>
            ) : (
              <p>Nada respondendo em {url}.</p>
            )}
            {segundos !== null ? (
              <button type="button" className="btn btn-outline btn-sm nodrag" onClick={servidor.manterAberta}>
                manter aberta
              </button>
            ) : (
              <button type="button" className="btn btn-outline btn-sm nodrag" onClick={fechar}>
                fechar
              </button>
            )}
          </div>
        ) : modo === "vista-nativa" && apiNativa !== null ? (
          // Trocar o endereço ou recarregar recria a vista (key): ela é destruída e aberta de novo.
          <VistaNativaDaPrevia
            key={`${url}#${versao}`}
            previaId={previaId}
            url={url}
            api={apiNativa}
            suspensa={minimizada || menuAberto}
            aoMudarOrigem={setOrigemAtual}
          />
        ) : modo === "nova-aba" ? (
          <div className="mensagem-da-previa mensagem-fora-do-ar">
            <p>Sites com login (Google Sheets, Docs, Notion) não abrem dentro de outra página no navegador.</p>
            <a
              className="btn btn-outline btn-sm nodrag"
              href={url}
              target="_blank"
              rel="noopener noreferrer"
            >
              abrir em nova aba
            </a>
          </div>
        ) : (
          <QuadroAtivavel>{(estilo) => <QuadroDoSite url={url} versao={versao} estilo={estilo} />}</QuadroAtivavel>
        )}
      </div>
    </div>
  );
});
