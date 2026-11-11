import {
  type ClipboardEvent,
  type CSSProperties,
  Fragment,
  type KeyboardEvent,
  memo,
  type PointerEvent as EventoDePonteiro,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { api, type ImagemParaEnvio, mensagemDeErro } from "../../shared/api/cliente";
import type {
  AtividadeDaResposta,
  ImagemDaMensagemDoChat,
  OrigemDaPergunta,
  PreferenciasDoChat,
  ResumoDoOrquestrador,
} from "../../shared/api/tipos";
import { comandoDoPrompt, completarComando, dicaDeComando } from "../../shared/comandosDoPrompt";
import { juntarDitado } from "../../shared/ditado/texto";
import { perguntaDaMensagemDaEscuta } from "../../shared/escuta/mensagemDaEscuta";
import { type EscutaNaTela, useEscuta } from "../../shared/escuta/useEscuta";
import {
  type EstadoDoChatNaTela,
  type MensagemDoChatNaTela,
  pedidoDeAutorizacaoAtual,
  textoParaMostrar,
  ultimoModeloUsado,
} from "../../shared/estado/aplicarEventoDoChat";
import { EVENTO_PARA_FOCAR_O_CHAT } from "../../shared/focarChat";
import { formatarBytes, formatarDuracao } from "../../shared/formatacao";
import {
  type AreaVisivel,
  type GeometriaDoChat,
  limitarGeometriaDoChat,
  moverGeometriaDoChat,
  PASSO_DE_MOVER_O_CHAT,
} from "../../shared/geometriaDoChat";
import { useMelhorarPrompt } from "../../shared/hooks/useMelhorarPrompt";
import { useModoInvisivel } from "../../shared/hooks/useModoInvisivel";
import {
  ALTURA_DA_CONVERSA_DO_CHAT,
  LARGURA_DO_CHAT_FIXO,
  type LadoDoChatFixo,
  limitarAlturaDaConversaDoChat,
  limitarLarguraDoChatFixo,
  limitarOpacidadeDoChat,
  OPACIDADE_DO_CHAT,
  usePreferenciasDaTela,
} from "../../shared/hooks/usePreferenciasDaTela";
import {
  ehCapturaDeTela,
  type ImagemAnexada,
  imagemDaCaptura,
  imagensParaEnvio,
  lerImagem,
  liberarImagens,
  MAXIMO_DE_IMAGENS,
  problemaDaImagem,
  TIPOS_DE_IMAGEM,
} from "../../shared/imagens";
import type { CapturaDeTela } from "../../shared/ponteDoDesktop";
import { BotaoDeDitado } from "../BotaoDeDitado";
import { AvisoDaMelhoria, BotaoDeMelhorar } from "../MelhoriaDoPrompt";
import { TextoFormatado } from "../TextoFormatado";
import { AvisoDaEscuta } from "./AvisoDaEscuta";
import { BalaoOuvido } from "./BalaoOuvido";
import { CartaoDeAcao, type PropsDasAcoesDoChat } from "./CartaoDeAcao";
import { CartaoDeAutorizacao } from "./CartaoDeAutorizacao";
import { CartaoDePergunta } from "./CartaoDePergunta";
import { CartaoDeSubagente } from "./CartaoDeSubagente";
import { frasesSemAsEnviadas } from "./frasesOuvidas";
import { HoraDaMensagem } from "./HoraDaMensagem";
import { IndicadorDaEscuta } from "./IndicadorDaEscuta";
import { MenuDeMaisAcoes, type ItemDoMenuDeMaisAcoes } from "./MenuDeMaisAcoes";
import { SeletorDeModelo } from "./SeletorDeModelo";
import "../../theme/chat-lateral.css";
import "../../theme/controles-de-janela.css";

const ALTURA_MAXIMA_DO_CAMPO = 140;
/** A altura (px) que o chat móvel assume ao ser movido pela primeira vez, sem conversa à vista. */
const ALTURA_PADRAO_DO_CHAT_MOVEL = 420;
/** Quanto a seta do teclado muda a altura da conversa (px). */
const PASSO_DA_ALTURA_DA_CONVERSA = 24;
/** A conversa do chat flutuante não passa desta fração da altura da janela. */
const FRACAO_MAXIMA_DA_CONVERSA = 0.85;
/** Sem preferência, a conversa vai até esta fração da altura da janela (o 36vh de sempre). */
const FRACAO_PADRAO_DA_CONVERSA = 0.36;
/** Quanto das conversas Ctrl+Alt+PageUp/PageDown rolam (fração da altura visível). */
const FRACAO_DA_ROLAGEM = 0.8;
/** Para as mensagens sem ações: a mesma lista sempre, para a memorização delas valer. */
const SEM_ORQUESTRADORES: readonly ResumoDoOrquestrador[] = [];
/** Distância do fim (px) em que a conversa ainda acompanha o texto que chega. */
const MARGEM_DE_ACOMPANHAMENTO = 80;

/** Uma frase fechada da escuta: vira uma mensagem sua, com a marca "ouvido", na conversa. */
type FraseOuvida = EscutaNaTela["legenda"]["frases"][number];

interface Props extends PropsDasAcoesDoChat {
  chat: EstadoDoChatNaTela;
  /** Servidor fora do ar: dá para escrever, mas não para enviar. */
  desconectado: boolean;
  /** Erro ao carregar o chat (o hook segue tentando sozinho). */
  erroAoCarregar: string | null;
  aoMudarPreferencias: (preferencias: PreferenciasDoChat) => void;
  /**
   * Fixo (a preferência da tela): uma coluna da altura toda ao lado do canvas,
   * com a conversa sempre à vista e o campo embaixo. Padrão: flutuante no pé do canvas.
   */
  fixo?: boolean;
  /** De que lado do canvas fica a coluna fixa (a alça vai na borda virada para o canvas). Padrão: esquerda. */
  lado?: LadoDoChatFixo;
  /**
   * Fixa o chat ao lado do canvas (true) ou o solta de volta no pé dele (false).
   * `ocultar` (só ao soltar) pede o chat já oculto embaixo: é o "ocultar" da coluna.
   * Sem ela, não há botão de fixar, soltar nem ocultar na coluna.
   */
  aoAlternarFixo?: (fixo: boolean, ocultar?: boolean) => void;
  /**
   * Flutuante: monta com a conversa já oculta (só o "mostrar conversa"). O chat é
   * remontado ao trocar de modo, então o canvas leva por aqui o "ocultar" da coluna.
   */
  comecaOculto?: boolean;
  /** Fixo: a largura da coluna (px). Padrão: 360. */
  largura?: number;
  /** Fixo: grava a largura nova (ao soltar a alça, pelo teclado ou nos dois cliques). Sem ela, não há alça. */
  aoMudarLargura?: (largura: number) => void;
}

/** O mínimo (px) que a área do canvas guarda ao lado do chat fixo. */
const LARGURA_MINIMA_DO_CANVAS = 360;
/** Quanto cada seta do teclado muda a largura do chat fixo (px). */
const PASSO_DA_LARGURA = 16;
/** No corpo, enquanto a alça é arrastada: sem seleção de texto e com o cursor de redimensionar em toda a tela. */
const CLASSE_DO_ARRASTE = "redimensionando-chat-lateral";

/**
 * A maior largura possível agora: até 640 px e sem deixar o canvas (o resto
 * da linha) com menos de 360 px. Sem medida (a linha ainda sem tamanho), só os 640.
 */
function larguraMaximaAgora(coluna: HTMLElement | null): number {
  const linha = coluna?.parentElement?.getBoundingClientRect().width ?? 0;
  const disponivel = linha > 0 ? linha : window.innerWidth;
  return Math.max(LARGURA_DO_CHAT_FIXO.minima, Math.min(LARGURA_DO_CHAT_FIXO.maxima, disponivel - LARGURA_MINIMA_DO_CANVAS));
}

/** Entre a mínima e a maior possível agora. */
function limitarAgora(largura: number, coluna: HTMLElement | null): number {
  return Math.min(limitarLarguraDoChatFixo(largura), larguraMaximaAgora(coluna));
}

interface PropsDaAlca {
  largura: number;
  aoMudar: (largura: number) => void;
  /** O lado da coluna: à direita, a alça fica na borda esquerda e o arraste se inverte. */
  lado: LadoDoChatFixo;
}

/**
 * A alça da borda do chat fixo virada para o canvas (a direita da coluna da
 * esquerda, a esquerda da coluna da direita): arrastar muda a largura ao vivo
 * (só no estilo da coluna, sem re-renderizar a conversa) e grava ao soltar; as
 * setas levam a borda 16 px para o lado delas, Home/End vão ao mínimo/máximo e
 * dois cliques voltam aos 360.
 */
function AlcaDaLargura({ largura, aoMudar, lado }: PropsDaAlca) {
  // À direita, levar a borda para a esquerda alarga a coluna.
  const sentido = lado === "direita" ? -1 : 1;
  // Durante o arraste: a largura ao vivo (para o aria-valuenow); nula, a gravada.
  const [aoVivo, setAoVivo] = useState<number | null>(null);
  const arraste = useRef<{ ponteiro: number; inicioX: number; inicio: number; atual: number; coluna: HTMLElement } | null>(
    null,
  );

  // Desmontar no meio do arraste (soltar o chat, por exemplo) não deixa a tela travada sem seleção.
  useEffect(() => () => document.body.classList.remove(CLASSE_DO_ARRASTE), []);

  function terminar(gravar: boolean): void {
    const atual = arraste.current;
    if (atual === null) {
      return;
    }
    arraste.current = null;
    setAoVivo(null);
    document.body.classList.remove(CLASSE_DO_ARRASTE);
    // Um clique sem mover (o começo dos dois cliques) não grava nada.
    const final = gravar && atual.atual !== atual.inicio ? atual.atual : largura;
    // A coluna fica com a final já agora; o React a confirma ao receber a largura gravada.
    atual.coluna.style.width = `${final}px`;
    if (final !== largura) {
      aoMudar(final);
    }
  }

  function aoApertar(evento: EventoDePonteiro<HTMLDivElement>): void {
    const coluna = evento.currentTarget.parentElement;
    if (evento.button !== 0 || coluna === null) {
      return;
    }
    // Sem seleção de texto nem o canvas entendendo como arrastar o fundo.
    evento.preventDefault();
    evento.stopPropagation();
    if (typeof evento.currentTarget.setPointerCapture === "function") {
      evento.currentTarget.setPointerCapture(evento.pointerId);
    }
    const medida = coluna.getBoundingClientRect().width;
    const inicio = medida > 0 ? Math.round(medida) : largura;
    arraste.current = { ponteiro: evento.pointerId, inicioX: evento.clientX, inicio, atual: inicio, coluna };
    document.body.classList.add(CLASSE_DO_ARRASTE);
  }

  function aoMover(evento: EventoDePonteiro<HTMLDivElement>): void {
    const atual = arraste.current;
    if (atual === null || atual.ponteiro !== evento.pointerId) {
      return;
    }
    evento.stopPropagation();
    const nova = limitarAgora(atual.inicio + sentido * (evento.clientX - atual.inicioX), atual.coluna);
    if (nova !== atual.atual) {
      atual.atual = nova;
      atual.coluna.style.width = `${nova}px`;
      setAoVivo(nova);
    }
  }

  function aoTeclar(evento: KeyboardEvent<HTMLDivElement>): void {
    const coluna = evento.currentTarget.parentElement;
    const destinos: Readonly<Record<string, number>> = {
      ArrowLeft: largura - sentido * PASSO_DA_LARGURA,
      ArrowRight: largura + sentido * PASSO_DA_LARGURA,
      Home: LARGURA_DO_CHAT_FIXO.minima,
      End: LARGURA_DO_CHAT_FIXO.maxima,
    };
    const destino = destinos[evento.key];
    if (destino === undefined) {
      return;
    }
    evento.preventDefault();
    evento.stopPropagation();
    const nova = limitarAgora(destino, coluna);
    if (nova !== largura) {
      aoMudar(nova);
    }
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Largura do chat"
      aria-valuenow={aoVivo ?? largura}
      aria-valuemin={LARGURA_DO_CHAT_FIXO.minima}
      aria-valuemax={LARGURA_DO_CHAT_FIXO.maxima}
      tabIndex={0}
      title="Arraste para mudar a largura do chat · dois cliques voltam ao padrão"
      className={`alca-do-chat-lateral alca-do-chat-lateral-${lado} nodrag nopan nowheel ${aoVivo === null ? "" : "alca-arrastando"}`}
      onPointerDown={aoApertar}
      onPointerMove={aoMover}
      onPointerUp={() => terminar(true)}
      onPointerCancel={() => terminar(false)}
      onLostPointerCapture={() => terminar(true)}
      onKeyDown={aoTeclar}
      onDoubleClick={() => {
        if (largura !== LARGURA_DO_CHAT_FIXO.padrao) {
          aoMudar(LARGURA_DO_CHAT_FIXO.padrao);
        }
      }}
    />
  );
}

/** Os ícones dos controles do chat: traço fino, do tamanho dos botões das janelas do canvas. */
const PROPS_DO_ICONE_DO_CHAT = {
  width: 14,
  height: 14,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

/** Os ícones da barra do chat: traço de 1,8, como os das ilhas do canvas (o tamanho muda de um para outro). */
function IconeDaBarra({ tamanho = 18, children }: { tamanho?: number; children: ReactNode }) {
  return (
    <svg
      width={tamanho}
      height={tamanho}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/** Anexar imagens: um "+". */
function IconeAnexar() {
  return (
    <IconeDaBarra>
      <path d="M12 5v14M5 12h14" />
    </IconeDaBarra>
  );
}

/** Modo invisível: o olho; ligado, o olho cortado. */
function IconeOlho({ cortado }: { cortado: boolean }) {
  return (
    <IconeDaBarra>
      {cortado ? (
        <>
          <path d="M10.6 5.7c.45-.1.93-.2 1.4-.2 6 0 9.5 6.5 9.5 6.5s-.9 1.7-2.5 3.4M6.6 7.1C3.9 8.9 2.5 12 2.5 12s3.5 6.5 9.5 6.5c1.6 0 3-.4 4.2-1" />
          <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
          <path d="m4 4 16 16" />
        </>
      ) : (
        <>
          <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
          <circle cx="12" cy="12" r="3" />
        </>
      )}
    </IconeDaBarra>
  );
}

/** Escuta do áudio (sem o modo invisível): fones de ouvido. */
function IconeFones() {
  return (
    <IconeDaBarra>
      <path d="M4.5 15v-3a7.5 7.5 0 0 1 15 0v3" />
      <rect x="3.5" y="14" width="4" height="6" rx="1.6" />
      <rect x="16.5" y="14" width="4" height="6" rx="1.6" />
    </IconeDaBarra>
  );
}

/** Alterações autorizadas: um escudo com o visto. */
function IconeEscudo() {
  return (
    <IconeDaBarra tamanho={16}>
      <path d="M12 3.5 5 6v5.5c0 4.2 2.9 7.6 7 9 4.1-1.4 7-4.8 7-9V6l-7-2.5Z" />
      <path d="m9 12 2.2 2.2L15.5 10" />
    </IconeDaBarra>
  );
}

/** Soltar embaixo: o chat volta a flutuar no pé do canvas (a janela com a barra embaixo). */
function IconeSoltar() {
  return (
    <svg {...PROPS_DO_ICONE_DO_CHAT}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <path d="M3.5 14h17" />
    </svg>
  );
}

/** Limpar conversa: uma vassoura. */
function IconeLimpar() {
  return (
    <svg {...PROPS_DO_ICONE_DO_CHAT}>
      <path d="M18.5 3.5 13 10.5" />
      <path d="M9.5 10.5h6l2 3.5-.8 6H8.3L7.5 14Z" />
      <path d="M10.5 16.5v3M13.5 16.5v3" />
    </svg>
  );
}

/** Mover para o outro lado: duas setas em sentidos opostos. */
function IconeMover() {
  return (
    <svg {...PROPS_DO_ICONE_DO_CHAT}>
      <path d="M5 8h13l-3-3M19 16H6l3 3" />
    </svg>
  );
}

/** Ocultar o chat: o traço do minimizar das janelas. */
function IconeOcultar() {
  return (
    <svg {...PROPS_DO_ICONE_DO_CHAT}>
      <path d="M5 12h14" />
    </svg>
  );
}

/** Seis pontinhos na horizontal: a alça de mover o chat no modo invisível. */
function IconeAlcaDeMover() {
  return (
    <svg width={22} height={10} viewBox="0 0 22 10" fill="currentColor" aria-hidden="true">
      <circle cx="4" cy="3" r="1.3" />
      <circle cx="11" cy="3" r="1.3" />
      <circle cx="18" cy="3" r="1.3" />
      <circle cx="4" cy="7.5" r="1.3" />
      <circle cx="11" cy="7.5" r="1.3" />
      <circle cx="18" cy="7.5" r="1.3" />
    </svg>
  );
}

/** Opacidade: um círculo meio cheio. */
function IconeOpacidade() {
  return (
    <svg {...PROPS_DO_ICONE_DO_CHAT}>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 4v16a8 8 0 0 1 0-16Z" fill="currentColor" />
    </svg>
  );
}

/** O controle deslizante da opacidade do chat inteiro (de 20% a 100%, de 10 em 10). */
function ControleDeOpacidade({ valor, aoMudar }: { valor: number; aoMudar: (opacidade: number) => void }) {
  return (
    <label className="controle-de-opacidade" title="Opacidade (Ctrl+Alt+ + / −)">
      <IconeOpacidade />
      <input
        type="range"
        className="controle-de-opacidade-faixa"
        aria-label="Opacidade do chat"
        aria-valuetext={`${Math.round(valor * 100)}%`}
        min={OPACIDADE_DO_CHAT.minima}
        max={OPACIDADE_DO_CHAT.maxima}
        step={OPACIDADE_DO_CHAT.passo}
        value={valor}
        onChange={(evento) => aoMudar(limitarOpacidadeDoChat(Number(evento.target.value)))}
      />
    </label>
  );
}

/** Verbos seguidos direto do arquivo, sem dois-pontos ("lendo README.md…"). */
const VERBOS_DE_ARQUIVO: ReadonlySet<string> = new Set(["lendo", "editando", "escrevendo"]);

/** Ex.: "pesquisando na web: clima em BH…", "lendo README.md…", "rodando: npm test…". */
function descreverAtividade({ ferramenta, detalhe }: AtividadeDaResposta): string {
  const verbos: Readonly<Record<string, string>> = {
    WebSearch: "pesquisando na web",
    WebFetch: "abrindo página",
    Read: "lendo",
    Grep: "procurando",
    Glob: "listando arquivos",
    Edit: "editando",
    NotebookEdit: "editando",
    Write: "escrevendo",
    PowerShell: "rodando",
    Bash: "rodando",
  };
  const verbo = verbos[ferramenta];
  if (verbo === undefined) {
    return `${ferramenta}${detalhe === "" ? "" : `: ${detalhe}`}…`;
  }
  if (detalhe === "") {
    return `${verbo}…`;
  }
  return VERBOS_DE_ARQUIVO.has(verbo) ? `${verbo} ${detalhe}…` : `${verbo}: ${detalhe}…`;
}

/**
 * O tipo do dado de uma resposta arrastada do chat: o canvas, ao recebê-la,
 * cria uma nota com o texto onde ela foi solta.
 */
export const TIPO_DA_RESPOSTA_DO_CHAT = "application/x-orquestrador-resposta-do-chat";

/** Seis pontos: o lugar de pegar a resposta para arrastá-la. */
function IconeArrastar() {
  return (
    <svg width={12} height={12} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="9" cy="6" r="1.6" />
      <circle cx="15" cy="6" r="1.6" />
      <circle cx="9" cy="12" r="1.6" />
      <circle cx="15" cy="12" r="1.6" />
      <circle cx="9" cy="18" r="1.6" />
      <circle cx="15" cy="18" r="1.6" />
    </svg>
  );
}

/**
 * Uma imagem anexada, em tamanho maior, por cima da tela. Esc, o ✕ ou um
 * clique fora fecham. Dentro do app (e não numa aba): no aplicativo, o
 * navegador do sistema não tem acesso ao servidor.
 */
function ImagemAmpliada({ imagem, aoFechar }: { imagem: ImagemDaMensagemDoChat; aoFechar: () => void }) {
  const fechar = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    fechar.current?.focus();
  }, []);

  return createPortal(
    <div
      className="nokey nowheel nodrag fundo-que-esmaece fundo-da-imagem-ampliada"
      data-area-clicavel
      onMouseDown={(evento) => {
        if (evento.target === evento.currentTarget) {
          aoFechar();
        }
      }}
      onKeyDown={(evento) => {
        evento.stopPropagation();
        if (evento.key === "Escape") {
          evento.preventDefault();
          aoFechar();
        }
      }}
    >
      <figure role="dialog" aria-modal="true" aria-label={imagem.nome} className="surgir imagem-ampliada">
        <img src={api.enderecoDoAnexoDoChat(imagem.arquivo)} alt={imagem.nome} />
        <figcaption>
          <span className="truncate">{imagem.nome}</span>
          <button ref={fechar} type="button" className="botao-icone" title="Fechar (Esc)" aria-label="Fechar" onClick={aoFechar}>
            ✕
          </button>
        </figcaption>
      </figure>
    </div>,
    document.body,
  );
}

interface PropsDaMensagem extends PropsDasAcoesDoChat {
  mensagem: MensagemDoChatNaTela;
  atividade: AtividadeDaResposta | null;
}

/** Uma mensagem da conversa. Memorizada: só a resposta em andamento re-renderiza a cada trecho. */
const MensagemNaConversa = memo(function MensagemNaConversa({
  mensagem,
  atividade,
  aoAbrirTerminal,
  temVagaPara,
  aoAtualizarOrquestradores,
  orquestradores,
}: PropsDaMensagem) {
  // A imagem anexada aberta em tamanho maior; nula, nenhuma.
  const [ampliada, setAmpliada] = useState<ImagemDaMensagemDoChat | null>(null);

  if (mensagem.papel === "usuario") {
    // Capturas de tela seguem para o Claude, mas nunca viram miniatura (só visual).
    const imagensVisiveis = mensagem.imagens.filter((imagem) => !ehCapturaDeTela(imagem.nome));
    // A da escuta aparece como se fosse digitada: só a pergunta (o contexto e a instrução seguem só para o Claude).
    const textoVisivel =
      mensagem.origem === "escuta" ? (perguntaDaMensagemDaEscuta(mensagem.texto) ?? mensagem.texto) : mensagem.texto;
    return (
      <div className="mensagem-do-usuario">
        {imagensVisiveis.length > 0 && (
          <div className="anexos-do-chat">
            {imagensVisiveis.map((imagem) => (
              <button
                key={imagem.arquivo}
                type="button"
                className="miniatura-do-anexo"
                title={`${imagem.nome} · clique para ampliar`}
                aria-label={`Ampliar ${imagem.nome}`}
                onClick={() => setAmpliada(imagem)}
              >
                <img src={api.enderecoDoAnexoDoChat(imagem.arquivo)} alt={imagem.nome} />
              </button>
            ))}
          </div>
        )}
        {textoVisivel !== "" && <p className="texto-longo">{textoVisivel}</p>}
        {mensagem.origem === "escuta" && (
          <span className="selo-da-escuta" title="Pergunta detectada pela escuta do áudio, no modo invisível">
            escuta
          </span>
        )}
        <HoraDaMensagem criadaEm={mensagem.criadaEm} />
        {ampliada !== null && <ImagemAmpliada imagem={ampliada} aoFechar={() => setAmpliada(null)} />}
      </div>
    );
  }

  const respondendo = mensagem.situacao === "respondendo";
  const texto = textoParaMostrar(mensagem.texto, respondendo);
  // Só a resposta pronta, com texto, vai para o canvas.
  const arrastavel = mensagem.situacao === "concluida" && texto !== "";
  return (
    <article className="mensagem-do-claude" aria-busy={respondendo}>
      {texto !== "" && (
        <div className={respondendo ? "texto-respondendo" : undefined}>
          <TextoFormatado texto={texto} className="markdown-compacto" />
        </div>
      )}
      {respondendo && texto === "" && (
        <p className="mono text-muted">
          pensando<span className="cursor" />
        </p>
      )}
      {respondendo && atividade !== null && atividade.mensagemId === mensagem.id && (
        <p className="mono truncate text-secondary" title={atividade.detalhe}>
          <span className="text-active">·</span> {descreverAtividade(atividade)}
        </p>
      )}
      {mensagem.avisos.map((aviso) => (
        <div key={aviso} className="alert alert-warning">
          {aviso}
        </div>
      ))}
      {mensagem.situacao === "falhou" && (
        <div className="alert alert-error" role="alert">
          A resposta falhou{mensagem.motivoDaFalha === null ? "." : `: ${mensagem.motivoDaFalha}`}
        </div>
      )}
      {mensagem.situacao === "cancelada" && <p className="mono text-muted">resposta cancelada</p>}
      {/* Um cartão por ação, pelo tipo; a posição na resposta é a chave (as de subagente não têm pasta). */}
      {mensagem.acoes.map((acao, indice) =>
        acao.tipo === "abrir_orquestrador" ? (
          <CartaoDeAcao
            key={`${acao.tipo}:${indice}`}
            acao={acao}
            aoAbrirTerminal={aoAbrirTerminal}
            temVagaPara={temVagaPara}
            aoAtualizarOrquestradores={aoAtualizarOrquestradores}
            orquestradores={orquestradores}
          />
        ) : (
          <CartaoDeSubagente key={`${acao.tipo}:${indice}`} acao={acao} />
        ),
      )}
      <footer className="rodape-da-mensagem mono text-muted">
        <HoraDaMensagem criadaEm={mensagem.criadaEm} />
        {mensagem.situacao === "concluida" && mensagem.uso !== null && (
          <span>
            {formatarDuracao(mensagem.uso.duracaoMs)}
            {mensagem.uso.modeloUsado === null ? "" : ` · ${mensagem.uso.modeloUsado}`}
          </span>
        )}
        {arrastavel && (
          <span
            className="alca-da-resposta"
            draggable
            title="Arraste para o canvas: a resposta vira uma nota onde for solta"
            onDragStart={(evento) => {
              evento.dataTransfer.setData(TIPO_DA_RESPOSTA_DO_CHAT, texto);
              evento.dataTransfer.setData("text/plain", texto);
              evento.dataTransfer.effectAllowed = "copy";
            }}
          >
            <IconeArrastar />
            arrastar
          </span>
        )}
      </footer>
    </article>
  );
});

/** Identifica a última mensagem e sua situação: muda quando chega resposta nova ou ela termina. */
function assinaturaDaUltima(chat: EstadoDoChatNaTela): string {
  const ultima = chat.mensagens.at(-1);
  return ultima === undefined ? "" : `${ultima.id}:${ultima.situacao}`;
}

/**
 * O chat rápido com o Claude, no centro de baixo do canvas: um composer
 * (Enter envia, Shift+Enter quebra linha, Esc cancela ou oculta, "/clear"
 * limpa) e, acima dele, a conversa. Respostas em Markdown, com o cursor
 * enquanto chegam, cartões para as ações que o Claude sugere no app e
 * cartões de pergunta com opções clicáveis (a escolha vai como a próxima pergunta).
 * O microfone dita a pergunta por voz (Esc, com ele focado, descarta a gravação).
 *
 * Quando o chat precisa editar um arquivo ou rodar um comando sem estar
 * autorizado, a última resposta ganha o cartão de autorização. Autorizado,
 * um indicador pequeno (um escudo na cor do aviso) fica na barra até o `/clear`;
 * o ✕ que aparece nele, ao passar o mouse ou ao focar, revoga.
 *
 * Flutuante, a barra é uma ilha de uma linha (a mesma pele das ilhas do canvas):
 * + · campo · ✦ · microfone · olho · modelo · enviar · fixar ao lado.
 *
 * Com `fixo`, o mesmo chat vira uma coluna ao lado do canvas (`<aside>`, do
 * `lado` pedido): conversa em bolhas sempre à vista, campo embaixo e, no cabeçalho,
 * quatro botões de ícone iguais aos das janelas: limpar a conversa, mover para o outro
 * lado (a preferência do lado), soltar embaixo (o chat flutua no pé do canvas) e,
 * no canto direito, ocultar (o chat vai para baixo já oculto, e "mostrar conversa" o reexibe ali).
 * Com `aoMudarLargura`, a borda da coluna virada para o canvas ganha a alça
 * de largura.
 *
 * No modo invisível (com a escuta disponível), o áudio do computador é
 * escutado: a transcrição entra na própria conversa (um balão "ouvido" por
 * frase, a pergunta destacada, e a frase em andamento num balão provisório no
 * fim); o indicador fica ao lado do olho e abre o menu da escuta (Automático,
 * idioma e prioridade do motor); o aviso da primeira vez e o erro ficam
 * dentro do chat. As perguntas da escuta levam o selo "escuta"; com
 * alterações autorizadas, vão para o campo.
 */
export function ChatRapido({
  chat,
  desconectado,
  erroAoCarregar,
  aoMudarPreferencias,
  aoAbrirTerminal,
  temVagaPara,
  aoAtualizarOrquestradores,
  orquestradores,
  fixo = false,
  lado = "esquerda",
  aoAlternarFixo,
  comecaOculto = false,
  largura = LARGURA_DO_CHAT_FIXO.padrao,
  aoMudarLargura,
}: Props) {
  const { preferencias, mudarPreferencias } = usePreferenciasDaTela();
  const [texto, setTexto] = useState("");
  const [imagens, setImagens] = useState<ImagemAnexada[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [pedidoDeCancelar, setPedidoDeCancelar] = useState(false);
  const [arrastando, setArrastando] = useState(false);
  // Assinatura da última mensagem quando a conversa foi ocultada; nula = visível.
  const [ocultaEm, setOcultaEm] = useState<string | null>(() =>
    comecaOculto && !fixo ? assinaturaDaUltima(chat) : null,
  );
  const [revogando, setRevogando] = useState(false);
  // De onde veio o texto do composer: "escuta" quando a escuta o pôs ali (chat com alterações autorizadas).
  const [origemDoComposer, setOrigemDoComposer] = useState<OrigemDaPergunta | null>(null);
  // Leitura síncrona do campo para a escuta: o callback dela é estável e não vê o estado novo.
  const composerAtual = useRef({ texto, origem: origemDoComposer });
  composerAtual.current = { texto, origem: origemDoComposer };
  const {
    disponivel: modoDisponivel,
    ativo: modoAtivo,
    escutaDisponivel,
    escutaManualLigada,
    alternarEscutaManual,
    entrar: entrarNoModo,
    capturarTela,
    aoCapturarQuadro,
    aoAtalho,
    aoMudarOculto,
    definirFocavel,
    mouseDaArea,
    sair: sairDoModo,
    erro: erroDoModo,
    descartarErro: descartarErroDoModo,
  } = useModoInvisivel();
  // Contagem síncrona dos anexos pendentes: vários quadros podem chegar antes de renderizar.
  const quantidadeDeImagens = useRef(0);
  quantidadeDeImagens.current = imagens.length;
  // As anexadas agora, para liberar as miniaturas (URLs `blob:`) ao enviar e ao desmontar.
  const imagensAtuais = useRef(imagens);
  imagensAtuais.current = imagens;
  useEffect(() => () => liberarImagens(imagensAtuais.current), []);
  const campo = useRef<HTMLTextAreaElement>(null);
  const seletorDeArquivos = useRef<HTMLInputElement>(null);
  const rolagem = useRef<HTMLDivElement>(null);
  const acompanhando = useRef(true);

  const respondendo = chat.situacao === "respondendo";
  const cancelando = pedidoDeCancelar && respondendo;
  const temMensagens = chat.mensagens.length > 0;
  // Fixo, a conversa nunca se oculta.
  const oculta = !fixo && ocultaEm !== null;
  const novidadeOculta = oculta && ocultaEm !== assinaturaDaUltima(chat);
  const imagensVisiveis = imagens.filter((imagem) => !ehCapturaDeTela(imagem.nome));
  const temConteudo = texto.trim() !== "" || imagens.length > 0;
  const dica = dicaDeComando(texto, respondendo);
  const ultima = chat.mensagens.at(-1);
  const pedidoDeAutorizacao = pedidoDeAutorizacaoAtual(chat);
  function ajustarAltura(): void {
    const elemento = campo.current;
    if (elemento !== null) {
      elemento.style.height = "auto";
      elemento.style.height = `${Math.min(elemento.scrollHeight, ALTURA_MAXIMA_DO_CAMPO)}px`;
    }
  }

  function limparCampo(): void {
    setTexto("");
    setOrigemDoComposer(null);
    requestAnimationFrame(ajustarAltura);
  }

  /** O ✨ troca o texto do campo (e o "desfazer" o devolve); não envia nada. */
  const melhoria = useMelhorarPrompt({
    texto,
    aoTrocarTexto: (novo) => {
      setTexto(novo);
      requestAnimationFrame(ajustarAltura);
    },
    onde: "chat",
  });

  const anexar = useCallback(
    async (arquivos: File[]): Promise<void> => {
      setErro(null);
      let quantidade = imagens.length;
      for (const arquivo of arquivos) {
        const problema = problemaDaImagem(arquivo, quantidade);
        if (problema !== null) {
          setErro(problema);
          continue;
        }
        quantidade += 1;
        try {
          const imagem = await lerImagem(arquivo);
          setImagens((atuais) => [...atuais, imagem]);
        } catch (falha) {
          setErro(mensagemDeErro(falha));
        }
      }
    },
    [imagens.length],
  );

  /** Guarda um quadro capturado (botão ou atalho) como anexo pendente, respeitando o limite. */
  const adicionarQuadro = useCallback((captura: CapturaDeTela): void => {
    if (quantidadeDeImagens.current >= MAXIMO_DE_IMAGENS) {
      setErro(`Dá para anexar até ${MAXIMO_DE_IMAGENS} imagens por mensagem: o quadro não foi guardado.`);
      return;
    }
    quantidadeDeImagens.current += 1;
    setErro(null);
    let imagem: ImagemAnexada;
    try {
      imagem = imagemDaCaptura(captura);
    } catch (falha) {
      quantidadeDeImagens.current -= 1;
      setErro(`Não foi possível guardar o quadro: ${mensagemDeErro(falha)}`);
      return;
    }
    setImagens((atuais) => [...atuais, imagem]);
  }, []);

  // Quadros do atalho global Ctrl+Shift+S (o app de trás mantém o foco).
  useEffect(() => {
    if (!modoAtivo) {
      return undefined;
    }
    return aoCapturarQuadro(adicionarQuadro);
  }, [modoAtivo, aoCapturarQuadro, adicionarQuadro]);

  async function limparConversa(): Promise<void> {
    // Durante a resposta o servidor recusaria: a dica já avisa.
    if (respondendo || enviando || desconectado) {
      return;
    }
    setErro(null);
    setEnviando(true);
    try {
      await api.limparChat();
      escuta.limparTrechos();
      limparCampo();
      setOcultaEm(null);
    } catch (falha) {
      setErro(`Não foi possível limpar a conversa: ${mensagemDeErro(falha)}`);
    } finally {
      setEnviando(false);
    }
  }

  /**
   * O envio de uma pergunta, do campo, do cartão de autorização ou da escuta:
   * mostra a conversa e volta a acompanhar o fim. Lança se o servidor recusar
   * (o erro original, ex.: o 409 de outra resposta em andamento).
   * `origem`: só nas perguntas que não foram digitadas (ex.: "escuta").
   */
  const enviarPergunta = useCallback(
    async (
      pergunta: string,
      anexos: readonly ImagemParaEnvio[] = [],
      opcoes: { origem?: OrigemDaPergunta } = {},
    ): Promise<void> => {
      setEnviando(true);
      try {
        let todosOsAnexos = anexos;
        // Modo invisível: a tela vai junto, fotografada agora — a menos que já haja um quadro
        // capturado (botão/atalho) entre os anexos. Sem a foto, nada é enviado.
        if (modoAtivo && !anexos.some((anexo) => ehCapturaDeTela(anexo.nome))) {
          if (anexos.length >= MAXIMO_DE_IMAGENS) {
            throw new Error(
              `No modo invisível a tela ocupa uma das ${MAXIMO_DE_IMAGENS} imagens: remova uma imagem anexada.`,
            );
          }
          let captura: CapturaDeTela;
          try {
            captura = await capturarTela();
          } catch (falha) {
            throw new Error(`Não foi possível capturar a tela: ${mensagemDeErro(falha)}. A pergunta não foi enviada.`);
          }
          todosOsAnexos = [
            ...anexos,
            { nome: captura.nome, tipoDeMidia: captura.tipoDeMidia, base64: captura.base64 },
          ];
        }
        // Sem origem, a chamada segue como sempre (sem o terceiro argumento).
        if (opcoes.origem === undefined) {
          await api.perguntarNoChat(pergunta, todosOsAnexos);
        } else {
          await api.perguntarNoChat(pergunta, todosOsAnexos, { origem: opcoes.origem });
        }
        setOcultaEm(null);
        setPedidoDeCancelar(false);
        acompanhando.current = true;
      } finally {
        setEnviando(false);
      }
    },
    [modoAtivo, capturarTela],
  );

  /** A pergunta detectada pela escuta vai como a do campo, com o print e a origem; rejeita com o erro original. */
  const enviarDaEscuta = useCallback(
    (pergunta: string): Promise<void> => enviarPergunta(pergunta, [], { origem: "escuta" }),
    [enviarPergunta],
  );

  /**
   * Com alterações autorizadas, a pergunta da escuta só vai para o campo: o usuário confere e aperta Enter.
   * Não apaga um rascunho digitado: só troca o campo vazio ou o que a própria escuta pôs ali
   * (a pergunta segue destacada no balão "ouvido" da conversa).
   */
  const preencherComposerDaEscuta = useCallback((pergunta: string): void => {
    const atual = composerAtual.current;
    if (atual.texto.trim() !== "" && atual.origem !== "escuta") {
      return;
    }
    composerAtual.current = { texto: pergunta, origem: "escuta" };
    setTexto(pergunta);
    setOrigemDoComposer("escuta");
    requestAnimationFrame(() => {
      const elemento = campo.current;
      if (elemento !== null) {
        elemento.style.height = "auto";
        elemento.style.height = `${Math.min(elemento.scrollHeight, ALTURA_MAXIMA_DO_CAMPO)}px`;
      }
    });
  }, []);

  // A escuta do áudio liga sozinha no modo invisível (depois do aviso da primeira vez) e para ao sair.
  const escuta = useEscuta({
    modoInvisivelAtivo: modoAtivo,
    escutaManualLigada,
    escutaDisponivel,
    chatLivre: !respondendo && !enviando && !desconectado && !melhoria.melhorando,
    autorizacaoAtiva: chat.alteracoesAutorizadas,
    enviar: enviarDaEscuta,
    preencherComposer: preencherComposerDaEscuta,
  });
  const comEscuta = escutaDisponivel && (modoAtivo || escutaManualLigada);

  // A escuta é parte da conversa, como se você tivesse dito cada fala no chat: um balão por enunciado.
  // O aberto fica no fim e cresce no lugar; ao fechar, o mesmo balão (mesmo id) vira uma mensagem sua com
  // a marca "ouvido", intercalada com as outras pelo horário. A pergunta que a escuta enviou some daqui:
  // ela já é a mensagem.
  const frasesDaLegenda = escuta.legenda.frases;
  const frasesOuvidas = useMemo(
    () => frasesSemAsEnviadas(frasesDaLegenda, chat.mensagens),
    [frasesDaLegenda, chat.mensagens],
  );
  const emAndamento = escuta.legenda.emAndamento;
  // Nunca o mesmo enunciado duas vezes: se a legenda já o tem fechado (mesmo id), vale o fechado.
  const enunciadoAberto =
    emAndamento !== null &&
    (emAndamento.confirmado.trim() !== "" || emAndamento.parcial.trim() !== "") &&
    !frasesDaLegenda.some((frase) => frase.id === emAndamento.id)
      ? emAndamento
      : null;
  const temOuvido = frasesOuvidas.length > 0 || enunciadoAberto !== null;
  const { frasesAntes, frasesNoFim } = useMemo(() => {
    const antes = new Map<string, FraseOuvida[]>();
    const noFim: FraseOuvida[] = [];
    const horarios = chat.mensagens.map((mensagem) => Date.parse(mensagem.criadaEm));
    for (const frase of frasesOuvidas) {
      const indice = horarios.findIndex((horario) => horario > frase.inicioMs);
      const id = indice === -1 ? undefined : chat.mensagens[indice]?.id;
      if (id === undefined) {
        noFim.push(frase);
      } else {
        antes.set(id, [...(antes.get(id) ?? []), frase]);
      }
    }
    return { frasesAntes: antes, frasesNoFim: noFim };
  }, [chat.mensagens, frasesOuvidas]);
  const balaoOuvido = (frase: FraseOuvida) => (
    <BalaoOuvido
      key={frase.id}
      id={frase.id}
      texto={frase.texto}
      inicioMs={frase.inicioMs}
      fimMs={frase.fimMs}
      pergunta={frase.pergunta}
      aberto={false}
    />
  );
  // O aberto vai no MESMO array das frases do fim e com a chave que terá fechado: quando ele fecha depois
  // das mensagens (o caso comum), o React reaproveita o elemento, sem piscar nem duplicar.
  const baloesNoFim =
    enunciadoAberto === null
      ? frasesNoFim.map(balaoOuvido)
      : [
          ...frasesNoFim.map(balaoOuvido),
          <BalaoOuvido
            key={enunciadoAberto.id}
            id={enunciadoAberto.id}
            texto={enunciadoAberto.confirmado}
            parcial={enunciadoAberto.parcial}
            inicioMs={enunciadoAberto.inicioMs}
            pergunta={false}
            aberto
          />,
        ];

  // ---- Modo invisível: o chat é móvel e redimensionável, e a janela só é focável enquanto se digita ----
  // Só flutuante e no modo: a coluna fixa não existe nele (o canvas a solta ao entrar).
  const movel = modoAtivo && !fixo;
  const conversaVisivel = (temMensagens || fixo || temOuvido) && !oculta;
  const raiz = useRef<HTMLElement | null>(null);
  const [area, setArea] = useState<AreaVisivel>(() => ({ largura: window.innerWidth, altura: window.innerHeight }));
  // A geometria durante um arraste (ao vivo); nula fora dele (vale a gravada).
  const [geometriaAoVivo, setGeometriaAoVivo] = useState<GeometriaDoChat | null>(null);
  const [gestoDoChat, setGestoDoChat] = useState<"mover" | "redimensionar" | null>(null);
  const gesto = useRef<{
    ponteiro: number;
    tipo: "mover" | "redimensionar";
    inicioX: number;
    inicioY: number;
    base: GeometriaDoChat;
    atual: GeometriaDoChat;
  } | null>(null);
  const opacidade = preferencias.opacidadeDoChat;
  const geometriaGravada = preferencias.chatNoModoInvisivel;
  // Nunca fora da tela, mesmo que a janela tenha encolhido depois de gravada (a gravada não muda).
  const geometria = geometriaAoVivo ?? (geometriaGravada === null ? null : limitarGeometriaDoChat(geometriaGravada, area));

  // A janela do app redimensionada (outro monitor, resolução): o chat reajusta para caber.
  useEffect(() => {
    if (!movel) {
      return undefined;
    }
    const aoRedimensionar = (): void => setArea({ largura: window.innerWidth, altura: window.innerHeight });
    window.addEventListener("resize", aoRedimensionar);
    aoRedimensionar();
    return () => window.removeEventListener("resize", aoRedimensionar);
  }, [movel]);

  /** A geometria de agora: a gravada ou, no lugar padrão, a medida na tela (para o primeiro arraste). */
  function geometriaAgora(): GeometriaDoChat {
    if (geometria !== null) {
      return geometria;
    }
    const medida = raiz.current?.getBoundingClientRect();
    const temMedida = medida !== undefined && medida.width > 0 && medida.height > 0;
    const largura = temMedida ? medida.width : Math.min(720, area.largura - 32);
    const altura = temMedida && conversaVisivel ? medida.height : Math.min(ALTURA_PADRAO_DO_CHAT_MOVEL, area.altura);
    const fundo = temMedida ? medida.bottom : area.altura - 16;
    return limitarGeometriaDoChat(
      { x: temMedida ? medida.left : (area.largura - largura) / 2, y: fundo - altura, largura, altura },
      area,
    );
  }

  function comecarGesto(tipo: "mover" | "redimensionar", evento: EventoDePonteiro<HTMLElement>): void {
    if (evento.button !== 0) {
      return;
    }
    // Sem seleção de texto nem o canvas entendendo como arrastar o fundo.
    evento.preventDefault();
    evento.stopPropagation();
    if (typeof evento.currentTarget.setPointerCapture === "function") {
      evento.currentTarget.setPointerCapture(evento.pointerId);
    }
    const base = geometriaAgora();
    gesto.current = { ponteiro: evento.pointerId, tipo, inicioX: evento.clientX, inicioY: evento.clientY, base, atual: base };
    setGeometriaAoVivo(base);
    setGestoDoChat(tipo);
  }

  function andarNoGesto(evento: EventoDePonteiro<HTMLElement>): void {
    const atual = gesto.current;
    if (atual === null || atual.ponteiro !== evento.pointerId) {
      return;
    }
    evento.stopPropagation();
    const dx = evento.clientX - atual.inicioX;
    const dy = evento.clientY - atual.inicioY;
    const { base } = atual;
    const nova =
      atual.tipo === "mover"
        ? moverGeometriaDoChat(base, dx, dy, area)
        : limitarGeometriaDoChat(
            {
              ...base,
              // A borda de baixo e a da direita seguem o mouse, mas o chat não passa da tela.
              largura: Math.min(base.largura + dx, area.largura - base.x),
              altura: Math.min(base.altura + dy, area.altura - base.y),
            },
            area,
          );
    atual.atual = nova;
    setGeometriaAoVivo(nova);
  }

  /** Solta o chat: grava a geometria final (a menos que o gesto tenha sido cancelado ou sem movimento). */
  const terminarGesto = useCallback(
    (gravar: boolean): void => {
      const atual = gesto.current;
      if (atual === null) {
        return;
      }
      gesto.current = null;
      setGestoDoChat(null);
      setGeometriaAoVivo(null);
      if (gravar && atual.atual !== atual.base) {
        mudarPreferencias({ chatNoModoInvisivel: atual.atual });
      }
    },
    [mudarPreferencias],
  );

  // O overlay oculto (Ctrl+Barra invertida) ou a saída do modo no meio de um arraste: cancela, sem gravar.
  useEffect(() => {
    if (!modoAtivo) {
      terminarGesto(false);
      return undefined;
    }
    return aoMudarOculto((oculto) => {
      if (oculto) {
        terminarGesto(false);
      }
    });
  }, [modoAtivo, aoMudarOculto, terminarGesto]);

  function voltarAoLugarPadrao(): void {
    mudarPreferencias({ chatNoModoInvisivel: null });
  }

  /** Deixa a janela focável (a pedido do clique no campo) e leva o teclado ao campo. */
  async function focarCampo(): Promise<void> {
    if (modoAtivo) {
      await definirFocavel(true);
    }
    campo.current?.focus();
  }

  /** Enviou, apertou Esc ou saiu do chat: o teclado volta ao app de trás. */
  function liberarFoco(): void {
    if (modoAtivo) {
      campo.current?.blur();
      void definirFocavel(false);
    }
  }

  // Os atalhos globais do modo (a janela não tem o foco, então chegam pelo processo principal).
  const tratarAtalho = useRef<(acao: string) => void>(() => undefined);
  tratarAtalho.current = (acao) => {
    const passos: Readonly<Record<string, readonly [number, number]>> = {
      "mover-cima": [0, -PASSO_DE_MOVER_O_CHAT],
      "mover-baixo": [0, PASSO_DE_MOVER_O_CHAT],
      "mover-esquerda": [-PASSO_DE_MOVER_O_CHAT, 0],
      "mover-direita": [PASSO_DE_MOVER_O_CHAT, 0],
    };
    const passo = passos[acao];
    if (passo !== undefined) {
      if (movel) {
        mudarPreferencias({ chatNoModoInvisivel: moverGeometriaDoChat(geometriaAgora(), passo[0], passo[1], area) });
      }
      return;
    }
    if (acao === "rolar-acima" || acao === "rolar-abaixo") {
      const elemento = rolagem.current;
      if (elemento !== null) {
        elemento.scrollTop += (acao === "rolar-abaixo" ? 1 : -1) * Math.max(1, elemento.clientHeight * FRACAO_DA_ROLAGEM);
      }
      return;
    }
    if (acao === "opacidade-mais" || acao === "opacidade-menos") {
      const sentido = acao === "opacidade-mais" ? 1 : -1;
      mudarPreferencias({ opacidadeDoChat: limitarOpacidadeDoChat(opacidade + sentido * OPACIDADE_DO_CHAT.passo) });
      return;
    }
    if (acao === "focar-campo") {
      campo.current?.focus();
    }
  };
  useEffect(() => {
    if (!modoAtivo) {
      return undefined;
    }
    return aoAtalho((acao) => tratarAtalho.current(acao));
  }, [modoAtivo, aoAtalho]);

  // Ctrl+J e "Focar o chat rápido" (paleta): mostra a conversa, se oculta, e leva o cursor ao campo.
  const pedirFoco = useRef<() => void>(() => undefined);
  pedirFoco.current = () => {
    acompanhando.current = true;
    setOcultaEm(null);
    void focarCampo();
  };
  useEffect(() => {
    const aoPedirFoco = (): void => pedirFoco.current();
    window.addEventListener(EVENTO_PARA_FOCAR_O_CHAT, aoPedirFoco);
    return () => window.removeEventListener(EVENTO_PARA_FOCAR_O_CHAT, aoPedirFoco);
  }, []);

  // A altura (máxima) da conversa do chat flutuante: a alça do topo dela ajusta ao vivo e grava ao soltar.
  const [alturaAoVivo, setAlturaAoVivo] = useState<number | null>(null);
  const gestoDaAltura = useRef<{ ponteiro: number; inicioY: number; inicio: number; atual: number } | null>(null);
  const alturaGravada = preferencias.alturaDaConversaDoChat;
  /** A altura de agora, sempre dentro da janela; sem preferência, os 36% de sempre. */
  function alturaDaConversaAgora(): number {
    const maxima = Math.max(ALTURA_DA_CONVERSA_DO_CHAT.minima, window.innerHeight * FRACAO_MAXIMA_DA_CONVERSA);
    const base = alturaAoVivo ?? alturaGravada ?? window.innerHeight * FRACAO_PADRAO_DA_CONVERSA;
    return Math.round(Math.min(maxima, Math.max(ALTURA_DA_CONVERSA_DO_CHAT.minima, base)));
  }
  function limitarAlturaAgora(altura: number): number {
    const maxima = Math.max(ALTURA_DA_CONVERSA_DO_CHAT.minima, window.innerHeight * FRACAO_MAXIMA_DA_CONVERSA);
    return Math.round(Math.min(maxima, Math.max(ALTURA_DA_CONVERSA_DO_CHAT.minima, altura)));
  }
  function terminarGestoDaAltura(gravar: boolean): void {
    const atual = gestoDaAltura.current;
    if (atual === null) {
      return;
    }
    gestoDaAltura.current = null;
    setAlturaAoVivo(null);
    if (gravar && atual.atual !== atual.inicio) {
      mudarPreferencias({ alturaDaConversaDoChat: limitarAlturaDaConversaDoChat(atual.atual) });
    }
  }

  // Acompanha o fim enquanto chega texto (das respostas e da escuta), a menos que o usuário tenha rolado para cima.
  useEffect(() => {
    const elemento = rolagem.current;
    if (elemento !== null && acompanhando.current) {
      elemento.scrollTop = elemento.scrollHeight;
    }
  }, [
    chat.mensagens.length,
    ultima?.texto,
    ultima?.situacao,
    chat.atividade,
    oculta,
    frasesOuvidas,
    enunciadoAberto?.confirmado,
    enunciadoAberto?.parcial,
  ]);

  async function enviar(): Promise<void> {
    // "/clear" é um comando, não uma pergunta.
    if (comandoDoPrompt(texto) === "limpar") {
      await limparConversa();
      return;
    }
    if (!temConteudo || respondendo || enviando || desconectado || melhoria.melhorando) {
      return;
    }
    setErro(null);
    try {
      // Só imagens, sem texto: o servidor exige uma pergunta, então vai uma padrão.
      const pergunta = texto.trim() === "" ? "Analise as imagens anexadas." : texto;
      // O base64 só nasce aqui; o "enviando" já vale enquanto ele é gerado.
      let anexos: ImagemParaEnvio[] = [];
      if (imagens.length > 0) {
        setEnviando(true);
        try {
          anexos = await imagensParaEnvio(imagens);
        } catch (falha) {
          setEnviando(false);
          throw falha;
        }
      }
      await enviarPergunta(
        pergunta,
        anexos,
        // A pergunta que a escuta pôs no campo leva o selo, mesmo que o usuário a tenha retocado.
        origemDoComposer === null ? {} : { origem: origemDoComposer },
      );
      limparCampo();
      liberarFoco();
      // As enviadas (e as que chegaram durante o envio, que também saem) liberam a miniatura.
      liberarImagens(imagensAtuais.current);
      setImagens([]);
    } catch (falha) {
      setErro(mensagemDeErro(falha));
    }
  }

  /** O ✕ do selo: o chat volta a pedir autorização antes de alterar. O evento confirma. */
  async function revogarAutorizacao(): Promise<void> {
    if (revogando || desconectado) {
      return;
    }
    setErro(null);
    setRevogando(true);
    try {
      await api.autorizarAlteracoesDoChat(false);
    } catch (falha) {
      setErro(`Não foi possível revogar a autorização: ${mensagemDeErro(falha)}`);
    } finally {
      setRevogando(false);
    }
  }

  async function cancelar(): Promise<void> {
    if (!respondendo || cancelando || desconectado) {
      return;
    }
    setErro(null);
    setPedidoDeCancelar(true);
    try {
      await api.cancelarRespostaDoChat();
    } catch (falha) {
      setErro(`Não foi possível cancelar: ${mensagemDeErro(falha)}`);
      setPedidoDeCancelar(false);
    }
  }

  function ocultar(): void {
    setOcultaEm(assinaturaDaUltima(chat));
  }

  function aoTeclar(evento: KeyboardEvent<HTMLTextAreaElement>): void {
    // Tab completa o comando começado ("/cl" → "/clear"); fora disso, segue o padrão.
    const completo = evento.key === "Tab" && !evento.shiftKey ? completarComando(texto) : null;
    if (completo !== null) {
      evento.preventDefault();
      setTexto(completo);
      return;
    }
    if (evento.key === "Enter" && !evento.shiftKey && !evento.nativeEvent.isComposing) {
      evento.preventDefault();
      void enviar();
      return;
    }
    if (evento.key === "Escape") {
      if (respondendo) {
        evento.preventDefault();
        void cancelar();
      } else if (!fixo && temMensagens && !oculta) {
        evento.preventDefault();
        ocultar();
      }
      // No modo invisível o Esc também devolve o teclado ao app de trás.
      liberarFoco();
    }
  }

  function receberDitado(ditado: string): void {
    setTexto((atual) => juntarDitado(atual, ditado));
    requestAnimationFrame(ajustarAltura);
    campo.current?.focus();
  }

  function aoColar(evento: ClipboardEvent<HTMLTextAreaElement>): void {
    const arquivos = [...evento.clipboardData.files].filter((arquivo) => arquivo.type.startsWith("image/"));
    if (arquivos.length > 0) {
      evento.preventDefault();
      void anexar(arquivos);
    }
  }

  // Textos curtos: o campo da barra é estreito e o placeholder fica numa linha só.
  const placeholder = desconectado
    ? "Servidor desconectado"
    : respondendo
      ? "Respondendo… esc cancela"
      : "Pergunte ao Claude";
  // O que o placeholder curto não diz: a dica no balão do campo.
  const dicaDoCampo = desconectado
    ? "Servidor desconectado: dá para escrever, o envio volta quando ele voltar"
    : respondendo
      ? "Respondendo: esc cancela, e já dá para escrever a próxima pergunta"
      : "Enter envia, Shift+Enter quebra a linha, / para comandos";

  // O menu ⋯ da barra: melhorar o pedido e, no flutuante, fixar ao lado.
  const itensDoMenu: ItemDoMenuDeMaisAcoes[] = [
    {
      id: "melhorar",
      rotulo: "Melhorar o pedido",
      titulo: "Reescreve o texto do campo num pedido mais claro (dá para desfazer)",
      desabilitado: texto.trim() === "" || desconectado || respondendo || enviando,
      aoEscolher: melhoria.melhorar,
    },
  ];
  if (!fixo && !movel && aoAlternarFixo !== undefined) {
    itensDoMenu.push({
      id: "fixar",
      rotulo: `Fixar o chat à ${lado}`,
      titulo: `Fixar o chat à ${lado}: uma coluna ao lado do canvas, sempre aberta`,
      aoEscolher: () => aoAlternarFixo(true),
    });
  }

  // O lado oposto ao atual: para onde o "mover" leva a coluna.
  const outroLado: LadoDoChatFixo = lado === "esquerda" ? "direita" : "esquerda";

  // Fixo: uma coluna (aside) ao lado do canvas; flutuante: um bloco no painel do pé do canvas.
  const Raiz = fixo ? "aside" : "div";

  // Móvel e já movido: a caixa fica onde foi gravada. Com a conversa à vista, do topo e com a altura gravada; sem
  // ela, presa ao fundo da mesma caixa (o campo não pula quando a conversa se oculta).
  let estiloMovel: CSSProperties | undefined;
  if (movel && geometria !== null) {
    estiloMovel = conversaVisivel
      ? { left: geometria.x, top: geometria.y, width: geometria.largura, height: geometria.altura }
      : { left: geometria.x, bottom: area.altura - geometria.y - geometria.altura, width: geometria.largura };
  }
  // A opacidade vale para o chat inteiro (fundo e texto) e só para o flutuante: a coluna fixa e o resto do app não mudam.
  const estiloDoChat: CSSProperties | undefined =
    opacidade === OPACIDADE_DO_CHAT.padrao
      ? estiloMovel
      : ({ ...estiloMovel, "--opacidade-do-chat": opacidade } as CSSProperties);
  const classeDoMovel = movel ? `chat-rapido-movel ${geometria === null ? "chat-rapido-movel-padrao" : ""}` : "";

  return (
    <Raiz
      ref={(elemento: HTMLElement | null) => {
        raiz.current = elemento;
      }}
      className={`chat-rapido nodrag nowheel nopan ${fixo ? `chat-lateral chat-lateral-${lado}` : ""} ${classeDoMovel} ${respondendo ? "chat-rapido-respondendo" : ""}`}
      aria-label={fixo ? "Chat rápido" : undefined}
      style={fixo ? { width: `${largura}px` } : estiloDoChat}
      data-testid="chat-rapido"
      {...mouseDaArea}
      onBlur={(evento) => {
        // O foco saiu do chat (clicou fora, trocou de app): o teclado volta ao app de trás.
        if (modoAtivo && !evento.currentTarget.contains(evento.relatedTarget as Node | null)) {
          void definirFocavel(false);
        }
      }}
      onDragOver={(evento) => {
        // Uma resposta arrastada daqui não cai no próprio chat (nem no canvas por baixo dele).
        if (evento.dataTransfer.types.includes(TIPO_DA_RESPOSTA_DO_CHAT)) {
          evento.stopPropagation();
          return;
        }
        if (evento.dataTransfer.types.includes("Files")) {
          evento.preventDefault();
          setArrastando(true);
        }
      }}
      onDragLeave={(evento) => {
        if (!evento.currentTarget.contains(evento.relatedTarget as Node | null)) {
          setArrastando(false);
        }
      }}
      onDrop={(evento) => {
        if (evento.dataTransfer.types.includes(TIPO_DA_RESPOSTA_DO_CHAT)) {
          evento.stopPropagation();
          return;
        }
        if (evento.dataTransfer.files.length > 0) {
          evento.preventDefault();
          setArrastando(false);
          void anexar([...evento.dataTransfer.files]);
        }
      }}
    >
      {movel && (
        <div className="barra-do-chat-movel" data-area-clicavel data-testid="barra-do-chat-movel">
          <button
            type="button"
            className="alca-de-mover-o-chat"
            aria-label="Mover o chat"
            title="Arraste para mover o chat (Ctrl+Alt+setas movem 40 px)"
            onPointerDown={(evento) => comecarGesto("mover", evento)}
            onPointerMove={andarNoGesto}
            onPointerUp={() => terminarGesto(true)}
            onPointerCancel={() => terminarGesto(false)}
            onLostPointerCapture={() => terminarGesto(true)}
            onKeyDown={(evento) => {
              const acoes: Readonly<Record<string, string>> = {
                ArrowUp: "mover-cima",
                ArrowDown: "mover-baixo",
                ArrowLeft: "mover-esquerda",
                ArrowRight: "mover-direita",
              };
              const acao = acoes[evento.key];
              if (acao !== undefined) {
                evento.preventDefault();
                tratarAtalho.current(acao);
              }
            }}
          >
            <IconeAlcaDeMover />
          </button>
          <ControleDeOpacidade valor={opacidade} aoMudar={(valor) => mudarPreferencias({ opacidadeDoChat: valor })} />
          {geometria !== null && (
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              aria-label="Voltar ao lugar padrão"
              title="Voltar ao lugar padrão: centralizado no rodapé, com o tamanho de sempre"
              onClick={voltarAoLugarPadrao}
            >
              lugar padrão
            </button>
          )}
        </div>
      )}
      {gestoDoChat !== null && <div className="camada-de-gesto-do-chat" data-area-clicavel />}
      {arrastando && <div className="soltar-imagens" data-area-clicavel>solte para anexar as imagens à pergunta</div>}
      {fixo && aoMudarLargura !== undefined && <AlcaDaLargura largura={largura} aoMudar={aoMudarLargura} lado={lado} />}

      {/* Oculta, a conversa continua montada: os cartões de ação lembram o que já fizeram. */}
      {(temMensagens || fixo || temOuvido) && (
        <section
          className={`conversa-do-chat ${fixo ? "conversa-lateral" : "painel-flutuante"}`}
          data-area-clicavel
          // O teto da conversa do flutuante (no móvel já movido, a caixa inteira manda).
          style={
            !fixo && !movel && (alturaGravada !== null || alturaAoVivo !== null)
              ? { maxHeight: `${alturaDaConversaAgora()}px` }
              : undefined
          }
          hidden={oculta}
          aria-label="Conversa com o Claude"
        >
          {!fixo && !movel && (
            <div
              role="separator"
              aria-orientation="horizontal"
              aria-label="Altura da conversa"
              aria-valuenow={alturaDaConversaAgora()}
              aria-valuemin={ALTURA_DA_CONVERSA_DO_CHAT.minima}
              aria-valuemax={Math.round(window.innerHeight * FRACAO_MAXIMA_DA_CONVERSA)}
              tabIndex={0}
              title="Arraste para mudar a altura da conversa · dois cliques voltam ao padrão"
              className={`alca-da-altura-da-conversa nodrag nopan nowheel ${alturaAoVivo === null ? "" : "alca-arrastando"}`}
              onPointerDown={(evento) => {
                if (evento.button !== 0) {
                  return;
                }
                evento.preventDefault();
                evento.stopPropagation();
                if (typeof evento.currentTarget.setPointerCapture === "function") {
                  evento.currentTarget.setPointerCapture(evento.pointerId);
                }
                const inicio = alturaDaConversaAgora();
                gestoDaAltura.current = { ponteiro: evento.pointerId, inicioY: evento.clientY, inicio, atual: inicio };
                setAlturaAoVivo(inicio);
              }}
              onPointerMove={(evento) => {
                const atual = gestoDaAltura.current;
                if (atual === null || atual.ponteiro !== evento.pointerId) {
                  return;
                }
                evento.stopPropagation();
                // O chat fica no pé do canvas: subir a alça (clientY menor) cresce a conversa.
                atual.atual = limitarAlturaAgora(atual.inicio + (atual.inicioY - evento.clientY));
                setAlturaAoVivo(atual.atual);
              }}
              onPointerUp={() => terminarGestoDaAltura(true)}
              onPointerCancel={() => terminarGestoDaAltura(false)}
              onLostPointerCapture={() => terminarGestoDaAltura(true)}
              onKeyDown={(evento) => {
                const passos: Readonly<Record<string, number>> = {
                  ArrowUp: PASSO_DA_ALTURA_DA_CONVERSA,
                  ArrowDown: -PASSO_DA_ALTURA_DA_CONVERSA,
                };
                const passo = passos[evento.key];
                if (passo !== undefined) {
                  evento.preventDefault();
                  mudarPreferencias({
                    alturaDaConversaDoChat: limitarAlturaDaConversaDoChat(limitarAlturaAgora(alturaDaConversaAgora() + passo)),
                  });
                }
              }}
              onDoubleClick={() => mudarPreferencias({ alturaDaConversaDoChat: null })}
            />
          )}
          <header className="cabecalho-do-chat">
            <span className="rotulo-tecnico">chat rápido</span>
            {respondendo && <span className="etiqueta etiqueta-ativa etiqueta-pulso">respondendo…</span>}
            <span className="flex-1" />
            {!fixo && !movel && (
              <ControleDeOpacidade valor={opacidade} aoMudar={(valor) => mudarPreferencias({ opacidadeDoChat: valor })} />
            )}
            {fixo ? (
              <span className="controles-do-chat" role="group" aria-label="Controles do chat">
                <button
                  type="button"
                  className="botao-do-no"
                  aria-label="Limpar conversa"
                  title={
                    respondendo
                      ? "Cancele a resposta antes de limpar."
                      : chat.alteracoesAutorizadas
                        ? "Limpar conversa: começa uma nova (/clear) e desfaz a autorização de alterações"
                        : "Limpar conversa: começa uma nova (/clear)"
                  }
                  disabled={respondendo || enviando || desconectado}
                  onClick={() => void limparConversa()}
                >
                  <IconeLimpar />
                </button>
                <button
                  type="button"
                  className="botao-do-no"
                  aria-label={`Mover o chat para a ${outroLado}`}
                  title={`Mover o chat para a ${outroLado}`}
                  onClick={() => mudarPreferencias({ ladoDoChatFixo: outroLado })}
                >
                  <IconeMover />
                </button>
                {aoAlternarFixo !== undefined && (
                  <>
                    <button
                      type="button"
                      className="botao-do-no"
                      aria-label="Soltar embaixo"
                      title="Soltar embaixo: o chat sai da coluna e passa a flutuar no centro de baixo do canvas, ainda aberto"
                      onClick={() => aoAlternarFixo(false)}
                    >
                      <IconeSoltar />
                    </button>
                    {/* Igual ao minimizar das janelas, sempre no canto direito: o chat sai da coluna e fica embaixo, oculto. */}
                    <button
                      type="button"
                      className="botao-do-no"
                      aria-label="Ocultar o chat"
                      title="Ocultar o chat: ele sai da coluna e, ao mostrar de novo, volta embaixo"
                      onClick={() => aoAlternarFixo(false, true)}
                    >
                      <IconeOcultar />
                    </button>
                  </>
                )}
              </span>
            ) : (
              <>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  onClick={() => void limparConversa()}
                  disabled={respondendo || enviando || desconectado}
                  title={
                    respondendo
                      ? "Cancele a resposta antes de limpar."
                      : chat.alteracoesAutorizadas
                        ? "Começa uma conversa nova (/clear) e desfaz a autorização de alterações"
                        : "Começa uma conversa nova (/clear)"
                  }
                >
                  limpar
                </button>
                <button type="button" className="btn btn-sm btn-ghost" onClick={ocultar} title="Ocultar a conversa (esc)">
                  ocultar
                </button>
              </>
            )}
          </header>
          <div
            ref={rolagem}
            className="mensagens-do-chat custom-scrollbar"
            onScroll={() => {
              const elemento = rolagem.current;
              if (elemento !== null) {
                acompanhando.current =
                  elemento.scrollHeight - elemento.scrollTop - elemento.clientHeight < MARGEM_DE_ACOMPANHAMENTO;
              }
            }}
          >
            {!temMensagens && !temOuvido && (
              <p className="vazio-do-chat-lateral text-support">
                Pergunte qualquer coisa ao Claude: a conversa aparece aqui, ao lado do canvas.
              </p>
            )}
            {chat.mensagens.map((mensagem, indice) => (
              <Fragment key={mensagem.id}>
                {(frasesAntes.get(mensagem.id) ?? []).map(balaoOuvido)}
                <MensagemNaConversa
                  mensagem={mensagem}
                  atividade={mensagem.situacao === "respondendo" ? chat.atividade : null}
                  aoAbrirTerminal={aoAbrirTerminal}
                  temVagaPara={temVagaPara}
                  aoAtualizarOrquestradores={aoAtualizarOrquestradores}
                  // Só quem tem cartões de abrir orquestrador acompanha a lista: as outras não re-renderizam a cada consulta.
                  orquestradores={
                    mensagem.acoes.some((acao) => acao.tipo === "abrir_orquestrador") ? orquestradores : SEM_ORQUESTRADORES
                  }
                />
                {/* Fora da mensagem memorizada: o cartão depende do estado do chat, não só da mensagem. */}
                {pedidoDeAutorizacao?.mensagemId === mensagem.id && (
                  <CartaoDeAutorizacao
                    autorizacao={pedidoDeAutorizacao.autorizacao}
                    autorizado={chat.alteracoesAutorizadas}
                    desabilitado={respondendo || desconectado}
                    aoEnviarPergunta={enviarPergunta}
                  />
                )}
                {/* Também fora: trava quando chega uma mensagem depois (a resposta já foi dada). */}
                {mensagem.papel === "claude" && mensagem.situacao === "concluida" && mensagem.perguntas.length > 0 && (
                  <CartaoDePergunta
                    perguntas={mensagem.perguntas}
                    respondida={indice < chat.mensagens.length - 1}
                    desabilitado={respondendo || enviando || desconectado}
                    aoResponder={enviarPergunta}
                  />
                )}
              </Fragment>
            ))}
            {baloesNoFim}
          </div>
        </section>
      )}

      {temMensagens && oculta && (
        <button
          type="button"
          className="mostrar-conversa"
          data-area-clicavel
          onClick={() => {
            acompanhando.current = true;
            setOcultaEm(null);
          }}
        >
          {novidadeOculta && <span className="ponto-de-status ponto-de-status-ativo" aria-hidden="true" />}
          {novidadeOculta ? "resposta nova · mostrar conversa" : "mostrar conversa"} ({chat.mensagens.length})
        </button>
      )}

      {erroDoModo !== null && (
        <p className="hint-error texto-longo" role="alert" data-area-clicavel>
          {erroDoModo}{" "}
          <button type="button" className="btn btn-sm btn-ghost" onClick={descartarErroDoModo}>
            fechar
          </button>
        </p>
      )}

      {/* Escuta do áudio: dentro do .chat-rapido, a única área que recebe cliques no modo invisível. */}
      {comEscuta && escuta.precisaDoAviso && (
        <AvisoDaEscuta aoConfirmar={escuta.confirmarAviso} aoRecusar={escuta.recusarAviso} />
      )}
      {/* A escuta não tem caixa à parte: só o erro, numa linha com "fechar", acima do campo. */}
      {comEscuta && escuta.erro !== null && (
        <p className="hint-error texto-longo erro-da-escuta" role="alert" data-testid="erro-da-escuta" data-area-clicavel>
          {escuta.erro}{" "}
          <button type="button" className="btn btn-sm btn-ghost" onClick={escuta.descartarErro}>
            fechar
          </button>
        </p>
      )}

      <div className="moldura-do-composer" data-area-clicavel>
        <div
          className="composer-do-chat"
          data-testid="composer-do-chat"
          onClick={(evento) => {
            // Clicar em qualquer parte leva o foco ao campo (menos no menu do modelo e no indicador da
            // escuta, cujo menu precisa do foco para fechar no Esc).
            const alvo = evento.target instanceof Element ? evento.target : null;
            if (alvo !== null && alvo.closest('[role="menu"], .indicador-da-escuta, .menu-de-mais-acoes') !== null) {
              return;
            }
            // No microfone o foco fica nele: o Esc ali descarta o ditado.
            if (alvo !== null && alvo.closest(".ditado") !== null) {
              return;
            }
            void focarCampo();
          }}
        >
          {respondendo && !desconectado && <div className="faixa-de-progresso" />}
          {imagensVisiveis.length > 0 && (
            <div className="miniaturas-do-prompt">
              {imagensVisiveis.map((imagem) => (
                <figure
                  key={imagem.id}
                  className="miniatura"
                  title={`${imagem.nome} · ${formatarBytes(imagem.tamanhoEmBytes)}`}
                >
                  <img src={imagem.previa} alt={imagem.nome} />
                  <button
                    type="button"
                    className="miniatura-remover"
                    aria-label={`Remover ${imagem.nome}`}
                    onClick={() => {
                      liberarImagens([imagem]);
                      setImagens((atuais) => atuais.filter((item) => item.id !== imagem.id));
                    }}
                  >
                    ✕
                  </button>
                </figure>
              ))}
            </div>
          )}
          {/* A barra: + · campo · ✦ · microfone · indicadores · olho · modelo · enviar · fixar. Na coluna, o campo vai para a linha de cima (CSS). */}
          <div className="linha-do-composer">
            <input
              ref={seletorDeArquivos}
              type="file"
              accept={TIPOS_DE_IMAGEM.join(",")}
              multiple
              hidden
              onChange={(evento) => {
                void anexar([...(evento.target.files ?? [])]);
                evento.target.value = "";
              }}
            />
            <button
              type="button"
              className="botao-icone botao-de-anexar"
              aria-label="Anexar imagens"
              title="Anexar imagens (também dá para colar com Ctrl+V ou arrastar para o chat)"
              onClick={() => seletorDeArquivos.current?.click()}
            >
              <IconeAnexar />
            </button>
            <textarea
              ref={campo}
              rows={1}
              className="campo-do-chat"
              value={texto}
              readOnly={melhoria.melhorando}
              aria-busy={melhoria.melhorando}
              onChange={(evento) => {
                setTexto(evento.target.value);
                // Apagar o campo tira a marca da escuta: o que for escrito depois é do usuário.
                if (evento.target.value === "") {
                  setOrigemDoComposer(null);
                }
                ajustarAltura();
              }}
              onKeyDown={aoTeclar}
              onPointerDown={() => {
                // Janela não focável: ela precisa virar focável antes de o campo receber o teclado.
                if (modoAtivo) {
                  void focarCampo();
                }
              }}
              onPaste={aoColar}
              placeholder={placeholder}
              title={dicaDoCampo}
              aria-label="Pergunta para o Claude"
            />
            {/* Melhorando, o "cancelar" fica à vista; o "melhorar" mora no menu ⋯. */}
            {melhoria.melhorando && <BotaoDeMelhorar melhoria={melhoria} desabilitado={false} />}
            <BotaoDeDitado destino="a mensagem" className="ditado-a-direita" aoTranscrever={receberDitado} />
            {chat.alteracoesAutorizadas && (
              <span
                className="selo-de-autorizacao"
                role="group"
                aria-label="Alterações autorizadas"
                title="Alterações autorizadas até o /clear: o chat edita arquivos e roda comandos sem perguntar"
              >
                <IconeEscudo />
                <button
                  type="button"
                  className="revogar-autorizacao"
                  aria-label="Revogar a autorização de alterações"
                  title="Revogar: o chat volta a pedir autorização antes de editar ou rodar comandos"
                  disabled={revogando || desconectado}
                  onClick={() => void revogarAutorizacao()}
                >
                  ✕
                </button>
              </span>
            )}
            <span className="espaco-do-composer" />
            {modoDisponivel && (
              <button
                type="button"
                className="botao-entrar-modo-invisivel"
                aria-label="Modo invisível"
                aria-pressed={modoAtivo}
                title={
                  modoAtivo
                    ? "Tela sendo vista: clique para voltar ao modo normal (Ctrl+\\ oculta ou mostra o chat; Ctrl+Shift+I sai)"
                    : "Modo invisível (fantasma): janela transparente, só o chat rápido; o Claude vê a tela a cada pergunta (Ctrl+\\ entra e alterna; Ctrl+Shift+I sai)"
                }
                onClick={() => void (modoAtivo ? sairDoModo() : entrarNoModo())}
              >
                <IconeOlho cortado={modoAtivo} />
                <span className="rotulo-do-modo-invisivel" aria-hidden="true">
                  Fantasma
                </span>
                {modoAtivo && <span className="ponto-tela-vista" aria-hidden="true" />}
              </button>
            )}
            {escutaDisponivel && !modoAtivo && (
              <button
                type="button"
                className="botao-icone botao-de-escuta-manual"
                aria-label="Escuta do áudio"
                aria-pressed={escutaManualLigada}
                title={
                  escutaManualLigada
                    ? "Escutando o áudio do sistema: clique para parar"
                    : "Escutar o áudio do sistema: transcreve o que toca no computador e mostra na conversa (nada é gravado)"
                }
                onClick={() => void alternarEscutaManual()}
              >
                <IconeFones />
              </button>
            )}
            {comEscuta && (
              <IndicadorDaEscuta
                situacao={escuta.situacao}
                progressoDoDownload={escuta.progressoDoDownload}
                download={escuta.download}
                motor={escuta.motor}
                erro={escuta.erro}
                pausar={escuta.pausar}
                retomar={escuta.retomar}
                automatico={escuta.automatico}
                alternarAutomatico={escuta.alternarAutomatico}
                preferenciasDaTela={escuta.preferenciasDaTela}
                mudarIdioma={escuta.mudarIdioma}
                mudarPrioridadeDoMotor={escuta.mudarPrioridadeDoMotor}
              />
            )}
            <SeletorDeModelo
              preferencias={chat.preferencias}
              modeloUsado={ultimoModeloUsado(chat)}
              desabilitado={desconectado}
              campo={campo}
              aoAlterar={aoMudarPreferencias}
              aoFalhar={setErro}
            />
            {respondendo ? (
              <button
                type="button"
                className="btn btn-sm btn-danger"
                onClick={() => void cancelar()}
                disabled={cancelando || desconectado}
              >
                {cancelando ? "cancelando…" : "cancelar"}
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-sm btn-cta"
                onClick={() => void enviar()}
                disabled={!temConteudo || enviando || desconectado || melhoria.melhorando}
              >
                {enviando ? "…" : "enviar ⏎"}
              </button>
            )}
            {/* O menu ⋯, no fim da barra: as ações menos usadas (a coluna tem os controles no cabeçalho). */}
            <MenuDeMaisAcoes itens={itensDoMenu} campo={campo} />
          </div>
          {dica !== null && (
            <p className="mono hint px-3" role="status">
              {dica}
            </p>
          )}
          {origemDoComposer === "escuta" && (
            <p className="hint nota-da-escuta px-3" data-testid="nota-da-escuta">
              Pergunta da escuta: confira e aperte Enter
            </p>
          )}
          <AvisoDaMelhoria melhoria={melhoria} className="px-3" />
          {(erro ?? erroAoCarregar) !== null && (
            <p className="hint-error texto-longo px-3" role="alert">
              {erro ?? `Não foi possível carregar o chat: ${erroAoCarregar}`}
            </p>
          )}
        </div>
      </div>
      {movel && (
        <button
          type="button"
          className="alca-de-redimensionar-do-chat"
          data-area-clicavel
          aria-label="Redimensionar o chat"
          title="Arraste para mudar o tamanho do chat"
          onPointerDown={(evento) => comecarGesto("redimensionar", evento)}
          onPointerMove={andarNoGesto}
          onPointerUp={() => terminarGesto(true)}
          onPointerCancel={() => terminarGesto(false)}
          onLostPointerCapture={() => terminarGesto(true)}
        />
      )}
    </Raiz>
  );
}
