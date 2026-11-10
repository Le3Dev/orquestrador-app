import {
  type ClipboardEvent,
  Fragment,
  type KeyboardEvent,
  memo,
  type PointerEvent as EventoDePonteiro,
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
import { type TrechoNaTela, useEscuta } from "../../shared/escuta/useEscuta";
import {
  type EstadoDoChatNaTela,
  type MensagemDoChatNaTela,
  pedidoDeAutorizacaoAtual,
  textoParaMostrar,
  ultimoModeloUsado,
} from "../../shared/estado/aplicarEventoDoChat";
import { formatarBytes, formatarDuracao, formatarMomento } from "../../shared/formatacao";
import { useMelhorarPrompt } from "../../shared/hooks/useMelhorarPrompt";
import { useModoInvisivel } from "../../shared/hooks/useModoInvisivel";
import {
  LARGURA_DO_CHAT_FIXO,
  type LadoDoChatFixo,
  limitarLarguraDoChatFixo,
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
import { CartaoDeAcao, type PropsDasAcoesDoChat } from "./CartaoDeAcao";
import { CartaoDeAutorizacao } from "./CartaoDeAutorizacao";
import { CartaoDePergunta } from "./CartaoDePergunta";
import { CartaoDeSubagente } from "./CartaoDeSubagente";
import { FaixaDaEscuta } from "./FaixaDaEscuta";
import { IndicadorDaEscuta } from "./IndicadorDaEscuta";
import { SeletorDeModelo } from "./SeletorDeModelo";
import "../../theme/chat-lateral.css";
import "../../theme/controles-de-janela.css";

const ALTURA_MAXIMA_DO_CAMPO = 140;
/** Para as mensagens sem ações: a mesma lista sempre, para a memorização delas valer. */
const SEM_ORQUESTRADORES: readonly ResumoDoOrquestrador[] = [];
/** Distância do fim (px) em que a conversa ainda acompanha o texto que chega. */
const MARGEM_DE_ACOMPANHAMENTO = 80;

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

/** Fixar: uma janela com a coluna do lado em que o chat vai ficar. */
function IconeFixar({ lado }: { lado: LadoDoChatFixo }) {
  return (
    <svg
      {...PROPS_DO_ICONE_DO_CHAT}
      // À direita, o mesmo desenho espelhado.
      style={lado === "direita" ? { transform: "scaleX(-1)" } : undefined}
    >
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <path d="M9.5 4.5v15" />
      <path d="M5.8 9h1.7M5.8 12h1.7" />
    </svg>
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

/** "14:32" para hoje; "08/11, 14:32" para outro dia. Sem data legível, nada. */
function horaDaMensagem(iso: string): string | null {
  return Number.isNaN(Date.parse(iso)) ? null : formatarMomento(iso);
}

/** A hora no pé da bolha; a data e a hora completas no balão. */
function HoraDaMensagem({ criadaEm }: { criadaEm: string }) {
  const hora = horaDaMensagem(criadaEm);
  if (hora === null) {
    return null;
  }
  return (
    <time className="hora-da-mensagem" dateTime={criadaEm} title={new Date(criadaEm).toLocaleString("pt-BR")}>
      {hora}
    </time>
  );
}

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
        {mensagem.texto !== "" && <p className="texto-longo">{mensagem.texto}</p>}
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
 * o selo "alterações autorizadas" fica ao lado do campo até o `/clear`; o ✕
 * dele revoga.
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
 * escutado: o indicador fica ao lado do 👁, a faixa da transcrição acima do
 * composer e o aviso da primeira vez dentro do chat. As perguntas da escuta
 * levam o selo "escuta"; com alterações autorizadas, vão para o campo.
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
  const { mudarPreferencias } = usePreferenciasDaTela();
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
  // Composer em uso: o campo ganhou foco e o foco segue dentro do composer.
  const [emUso, setEmUso] = useState(false);
  const [menuAberto, setMenuAberto] = useState(false);
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
  // Compacto (uma linha) até a pessoa usar; recolhe só sem foco, texto, imagens nem menu aberto.
  // Fixo, fica sempre expandido: a coluna é estreita para tudo numa linha.
  const expandido = fixo || emUso || texto !== "" || imagensVisiveis.length > 0 || menuAberto || arrastando;

  // Recolhido, o campo volta à altura de uma linha.
  useEffect(() => {
    if (!expandido && campo.current !== null) {
      campo.current.style.height = "";
    }
  }, [expandido]);

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
   * (a pergunta segue visível na faixa como "última pergunta").
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

  // A transcrição entra na conversa, intercalada com as mensagens pelo horário.
  const temOuvido = escuta.trechos.length > 0 || escuta.linhaProvisoria !== null;
  const { trechosAntes, trechosNoFim } = useMemo(() => {
    const antes = new Map<string, TrechoNaTela[]>();
    const noFim: TrechoNaTela[] = [];
    const horarios = chat.mensagens.map((mensagem) => Date.parse(mensagem.criadaEm));
    for (const trecho of escuta.trechos) {
      const indice = horarios.findIndex((horario) => horario > trecho.inicioMs);
      const id = indice === -1 ? undefined : chat.mensagens[indice]?.id;
      if (id === undefined) {
        noFim.push(trecho);
      } else {
        antes.set(id, [...(antes.get(id) ?? []), trecho]);
      }
    }
    return { trechosAntes: antes, trechosNoFim: noFim };
  }, [chat.mensagens, escuta.trechos]);
  const blocoOuvido = (trecho: TrechoNaTela) => (
    <p key={trecho.id} className="trecho-ouvido" data-testid="trecho-ouvido">
      <span className="rotulo-tecnico">ouvido</span>
      <span className="trecho-ouvido-texto">{trecho.texto}</span>
    </p>
  );

  // Acompanha o fim enquanto chega texto, a menos que o usuário tenha rolado para cima.
  useEffect(() => {
    const elemento = rolagem.current;
    if (elemento !== null && acompanhando.current) {
      elemento.scrollTop = elemento.scrollHeight;
    }
  }, [chat.mensagens.length, ultima?.texto, ultima?.situacao, chat.atividade, oculta, escuta.trechos.length, escuta.linhaProvisoria]);

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

  const placeholder = desconectado
    ? "servidor desconectado — dá para escrever, o envio volta quando ele voltar"
    : respondendo
      ? "respondendo… (esc cancela) — já pode escrever a próxima"
      : fixo
        ? // Na coluna, o texto inteiro quebraria linha: a versão curta cabe numa só.
          "Pergunte ao Claude · / para comandos"
        : "Pergunte qualquer coisa ao Claude · / para comandos";

  // O lado oposto ao atual: para onde o "mover" leva a coluna.
  const outroLado: LadoDoChatFixo = lado === "esquerda" ? "direita" : "esquerda";

  // Fixo: uma coluna (aside) ao lado do canvas; flutuante: um bloco no painel do pé do canvas.
  const Raiz = fixo ? "aside" : "div";

  return (
    <Raiz
      className={`chat-rapido nodrag nowheel nopan ${fixo ? `chat-lateral chat-lateral-${lado}` : ""} ${respondendo ? "chat-rapido-respondendo" : ""}`}
      aria-label={fixo ? "Chat rápido" : undefined}
      style={fixo ? { width: `${largura}px` } : undefined}
      data-testid="chat-rapido"
      {...mouseDaArea}
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
      {arrastando && <div className="soltar-imagens">solte para anexar as imagens à pergunta</div>}
      {fixo && aoMudarLargura !== undefined && <AlcaDaLargura largura={largura} aoMudar={aoMudarLargura} lado={lado} />}

      {/* Oculta, a conversa continua montada: os cartões de ação lembram o que já fizeram. */}
      {(temMensagens || fixo || temOuvido) && (
        <section
          className={`conversa-do-chat ${fixo ? "conversa-lateral" : "painel-flutuante"}`}
          hidden={oculta}
          aria-label="Conversa com o Claude"
        >
          <header className="cabecalho-do-chat">
            <span className="rotulo-tecnico">chat rápido</span>
            {respondendo && <span className="etiqueta etiqueta-ativa etiqueta-pulso">respondendo…</span>}
            <span className="flex-1" />
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
                {aoAlternarFixo !== undefined && (
                  <button
                    type="button"
                    className="botao-do-no"
                    aria-label={`Fixar o chat à ${lado}`}
                    title={`Fixar o chat à ${lado}: uma coluna ao lado do canvas, sempre aberta`}
                    onClick={() => aoAlternarFixo(true)}
                  >
                    <IconeFixar lado={lado} />
                  </button>
                )}
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
            {!temMensagens && escuta.trechos.length === 0 && escuta.linhaProvisoria === null && (
              <p className="vazio-do-chat-lateral text-support">
                Pergunte qualquer coisa ao Claude: a conversa aparece aqui, ao lado do canvas.
              </p>
            )}
            {chat.mensagens.map((mensagem, indice) => (
              <Fragment key={mensagem.id}>
                {(trechosAntes.get(mensagem.id) ?? []).map(blocoOuvido)}
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
            {trechosNoFim.map(blocoOuvido)}
            {escuta.linhaProvisoria !== null && (
              <p className="trecho-ouvido trecho-ouvido-provisorio" aria-live="polite" data-testid="trecho-provisorio">
                <span className="rotulo-tecnico">ouvindo</span>
                <span className="trecho-ouvido-texto">{escuta.linhaProvisoria}</span>
              </p>
            )}
          </div>
        </section>
      )}

      {temMensagens && oculta && (
        <button
          type="button"
          className="chip mostrar-conversa"
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
        <p className="hint-error texto-longo" role="alert">
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
      {comEscuta && (
        <FaixaDaEscuta
          situacao={escuta.situacao}
          progressoDoDownload={escuta.progressoDoDownload}
          automatico={escuta.automatico}
          alternarAutomatico={escuta.alternarAutomatico}
          erro={escuta.erro}
          descartarErro={escuta.descartarErro}
          ultimaPergunta={escuta.ultimaPergunta}
        />
      )}

      <div className="moldura-do-composer">
        <div
          className={`composer-do-chat ${expandido ? "composer-expandido" : "composer-compacto"}`}
          data-testid="composer-do-chat"
          onClick={(evento) => {
            // Clicar em qualquer parte expande e leva o foco ao campo (menos dentro do menu do modelo).
            const alvo = evento.target instanceof Element ? evento.target : null;
            if (alvo !== null && alvo.closest('[role="menu"]') !== null) {
              return;
            }
            // No microfone, expande mas o foco fica nele: o Esc ali descarta o ditado.
            if (alvo !== null && alvo.closest(".ditado") !== null) {
              setEmUso(true);
              return;
            }
            campo.current?.focus();
          }}
          onBlur={(evento) => {
            const composer = evento.currentTarget;
            // Gravando ou transcrevendo, não recolhe: o microfone e o aviso dele seguem à vista.
            const ditando = composer.querySelector('.ditado [aria-pressed="true"], .ditado [aria-busy="true"]') !== null;
            if (!composer.contains(evento.relatedTarget as Node | null) && !ditando) {
              setEmUso(false);
            }
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
            onFocus={() => setEmUso(true)}
            onKeyDown={aoTeclar}
            onPaste={aoColar}
            placeholder={placeholder}
            aria-label="Pergunta para o Claude"
          />
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
              +
            </button>
            <BotaoDeMelhorar
              melhoria={melhoria}
              desabilitado={texto.trim() === "" || desconectado || respondendo || enviando}
            />
            <BotaoDeDitado destino="a mensagem" className="ditado-a-direita" aoTranscrever={receberDitado} />
            {respondendo && <span className="etiqueta etiqueta-ativa etiqueta-pulso">respondendo…</span>}
            {chat.alteracoesAutorizadas && (
              <span
                className="selo-de-autorizacao"
                title="Até o próximo /clear, o chat edita arquivos e roda comandos sem perguntar"
              >
                alterações autorizadas
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
            <span className="flex-1" />
            {modoDisponivel && (
              <button
                type="button"
                className="botao-icone botao-entrar-modo-invisivel"
                aria-label="Modo invisível"
                aria-pressed={modoAtivo}
                title={
                  modoAtivo
                    ? "Tela sendo vista — clique para voltar ao modo normal (Ctrl+Shift+I)"
                    : "Modo invisível: janela transparente, só o chat rápido; o Claude vê a tela a cada pergunta (Ctrl+Shift+I para sair)"
                }
                onClick={() => void (modoAtivo ? sairDoModo() : entrarNoModo())}
              >
                👁
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
                    ? "Escutando o áudio do sistema — clique para parar"
                    : "Escutar o áudio do sistema: transcreve o que toca no computador e mostra na conversa (nada é gravado)"
                }
                onClick={() => void alternarEscutaManual()}
              >
                🎧
              </button>
            )}
            {comEscuta && (
              <IndicadorDaEscuta
                situacao={escuta.situacao}
                progressoDoDownload={escuta.progressoDoDownload}
                erro={escuta.erro}
                pausar={escuta.pausar}
                retomar={escuta.retomar}
              />
            )}
            <SeletorDeModelo
              preferencias={chat.preferencias}
              modeloUsado={ultimoModeloUsado(chat)}
              desabilitado={desconectado}
              campo={campo}
              aoAlterar={aoMudarPreferencias}
              aoFalhar={setErro}
              aoAlternarMenu={setMenuAberto}
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
          </div>
        </div>
      </div>
    </Raiz>
  );
}
