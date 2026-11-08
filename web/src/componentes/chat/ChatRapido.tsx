import {
  type ClipboardEvent,
  Fragment,
  type KeyboardEvent,
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { api, type ImagemParaEnvio, mensagemDeErro } from "../../shared/api/cliente";
import type { AtividadeDaResposta, PreferenciasDoChat } from "../../shared/api/tipos";
import { comandoDoPrompt, completarComando, dicaDeComando } from "../../shared/comandosDoPrompt";
import {
  type EstadoDoChatNaTela,
  type MensagemDoChatNaTela,
  pedidoDeAutorizacaoAtual,
  textoParaMostrar,
  ultimoModeloUsado,
} from "../../shared/estado/aplicarEventoDoChat";
import { formatarBytes, formatarDuracao } from "../../shared/formatacao";
import { ehCapturaDeTela, type ImagemAnexada, lerImagem, MAXIMO_DE_IMAGENS, problemaDaImagem, TIPOS_DE_IMAGEM } from "../../shared/imagens";
import { useModoInvisivel } from "../../shared/hooks/useModoInvisivel";
import type { CapturaDeTela } from "../../shared/ponteDoDesktop";
import { TextoFormatado } from "../TextoFormatado";
import { CartaoDeAcao, type PropsDasAcoesDoChat } from "./CartaoDeAcao";
import { CartaoDeAutorizacao } from "./CartaoDeAutorizacao";
import { SeletorDeModelo } from "./SeletorDeModelo";

const ALTURA_MAXIMA_DO_CAMPO = 140;
/** Distância do fim (px) em que a conversa ainda acompanha o texto que chega. */
const MARGEM_DE_ACOMPANHAMENTO = 80;

interface Props extends PropsDasAcoesDoChat {
  chat: EstadoDoChatNaTela;
  /** Servidor fora do ar: dá para escrever, mas não para enviar. */
  desconectado: boolean;
  /** Erro ao carregar o chat (o hook segue tentando sozinho). */
  erroAoCarregar: string | null;
  aoMudarPreferencias: (preferencias: PreferenciasDoChat) => void;
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

interface PropsDaMensagem extends PropsDasAcoesDoChat {
  mensagem: MensagemDoChatNaTela;
  atividade: AtividadeDaResposta | null;
  /** Modo invisível ativo: esconde as miniaturas das capturas de tela (só visual). */
  ocultarCapturas: boolean;
}

/** Uma mensagem da conversa. Memorizada: só a resposta em andamento re-renderiza a cada trecho. */
const MensagemNaConversa = memo(function MensagemNaConversa({
  mensagem,
  atividade,
  ocultarCapturas,
  aoAbrirTerminal,
  temVagaPara,
  aoAtualizarOrquestradores,
}: PropsDaMensagem) {
  if (mensagem.papel === "usuario") {
    const imagensVisiveis = ocultarCapturas
      ? mensagem.imagens.filter((imagem) => !ehCapturaDeTela(imagem.nome))
      : mensagem.imagens;
    return (
      <div className="mensagem-do-usuario">
        {imagensVisiveis.length > 0 && (
          <div className="anexos-do-chat">
            {imagensVisiveis.map((imagem) => (
              <a
                key={imagem.arquivo}
                href={api.enderecoDoAnexoDoChat(imagem.arquivo)}
                target="_blank"
                rel="noopener noreferrer"
                title={imagem.nome}
              >
                <img src={api.enderecoDoAnexoDoChat(imagem.arquivo)} alt={imagem.nome} />
              </a>
            ))}
          </div>
        )}
        {mensagem.texto !== "" && <p className="texto-longo">{mensagem.texto}</p>}
      </div>
    );
  }

  const respondendo = mensagem.situacao === "respondendo";
  const texto = textoParaMostrar(mensagem.texto, respondendo);
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
      {mensagem.acoes.map((acao, indice) => (
        <CartaoDeAcao
          key={`${acao.pasta}:${indice}`}
          acao={acao}
          aoAbrirTerminal={aoAbrirTerminal}
          temVagaPara={temVagaPara}
          aoAtualizarOrquestradores={aoAtualizarOrquestradores}
        />
      ))}
      {mensagem.situacao === "concluida" && mensagem.uso !== null && (
        <p className="mono text-muted">
          {formatarDuracao(mensagem.uso.duracaoMs)}
          {mensagem.uso.modeloUsado === null ? "" : ` · ${mensagem.uso.modeloUsado}`}
        </p>
      )}
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
 * enquanto chegam, e cartões para as ações que o Claude sugere no app.
 *
 * Quando o chat precisa editar um arquivo ou rodar um comando sem estar
 * autorizado, a última resposta ganha o cartão de autorização. Autorizado,
 * o selo "alterações autorizadas" fica ao lado do campo até o `/clear`; o ✕
 * dele revoga.
 */
export function ChatRapido({
  chat,
  desconectado,
  erroAoCarregar,
  aoMudarPreferencias,
  aoAbrirTerminal,
  temVagaPara,
  aoAtualizarOrquestradores,
}: Props) {
  const [texto, setTexto] = useState("");
  const [imagens, setImagens] = useState<ImagemAnexada[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [pedidoDeCancelar, setPedidoDeCancelar] = useState(false);
  const [arrastando, setArrastando] = useState(false);
  // Assinatura da última mensagem quando a conversa foi ocultada; nula = visível.
  const [ocultaEm, setOcultaEm] = useState<string | null>(null);
  // Composer em uso: o campo ganhou foco e o foco segue dentro do composer.
  const [emUso, setEmUso] = useState(false);
  const [menuAberto, setMenuAberto] = useState(false);
  const [revogando, setRevogando] = useState(false);
  const {
    disponivel: modoDisponivel,
    ativo: modoAtivo,
    entrar: entrarNoModo,
    capturarTela,
    mouseDaArea,
    sair: sairDoModo,
    erro: erroDoModo,
    descartarErro: descartarErroDoModo,
  } = useModoInvisivel();
  const campo = useRef<HTMLTextAreaElement>(null);
  const seletorDeArquivos = useRef<HTMLInputElement>(null);
  const rolagem = useRef<HTMLDivElement>(null);
  const acompanhando = useRef(true);

  const respondendo = chat.situacao === "respondendo";
  const cancelando = pedidoDeCancelar && respondendo;
  const temMensagens = chat.mensagens.length > 0;
  const oculta = ocultaEm !== null;
  const novidadeOculta = oculta && ocultaEm !== assinaturaDaUltima(chat);
  const temConteudo = texto.trim() !== "" || imagens.length > 0;
  const dica = dicaDeComando(texto, respondendo);
  const ultima = chat.mensagens.at(-1);
  const pedidoDeAutorizacao = pedidoDeAutorizacaoAtual(chat);
  // Compacto (uma linha) até a pessoa usar; recolhe só sem foco, texto, imagens nem menu aberto.
  const expandido = emUso || texto !== "" || imagens.length > 0 || menuAberto || arrastando;

  // Recolhido, o campo volta à altura de uma linha.
  useEffect(() => {
    if (!expandido && campo.current !== null) {
      campo.current.style.height = "";
    }
  }, [expandido]);

  // Acompanha o fim enquanto chega texto, a menos que o usuário tenha rolado para cima.
  useEffect(() => {
    const elemento = rolagem.current;
    if (elemento !== null && acompanhando.current) {
      elemento.scrollTop = elemento.scrollHeight;
    }
  }, [chat.mensagens.length, ultima?.texto, ultima?.situacao, chat.atividade, oculta]);

  function ajustarAltura(): void {
    const elemento = campo.current;
    if (elemento !== null) {
      elemento.style.height = "auto";
      elemento.style.height = `${Math.min(elemento.scrollHeight, ALTURA_MAXIMA_DO_CAMPO)}px`;
    }
  }

  function limparCampo(): void {
    setTexto("");
    requestAnimationFrame(ajustarAltura);
  }

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

  async function limparConversa(): Promise<void> {
    // Durante a resposta o servidor recusaria: a dica já avisa.
    if (respondendo || enviando || desconectado) {
      return;
    }
    setErro(null);
    setEnviando(true);
    try {
      await api.limparChat();
      limparCampo();
      setOcultaEm(null);
    } catch (falha) {
      setErro(`Não foi possível limpar a conversa: ${mensagemDeErro(falha)}`);
    } finally {
      setEnviando(false);
    }
  }

  /**
   * O envio de uma pergunta, do campo ou do cartão de autorização: mostra a
   * conversa e volta a acompanhar o fim. Lança se o servidor recusar.
   */
  const enviarPergunta = useCallback(
    async (pergunta: string, anexos: readonly ImagemParaEnvio[] = []): Promise<void> => {
      setEnviando(true);
      try {
        let todosOsAnexos = anexos;
        // Modo invisível: a tela vai junto, fotografada agora. Sem a foto, nada é enviado.
        if (modoAtivo) {
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
        await api.perguntarNoChat(pergunta, todosOsAnexos);
        setOcultaEm(null);
        setPedidoDeCancelar(false);
        acompanhando.current = true;
      } finally {
        setEnviando(false);
      }
    },
    [modoAtivo, capturarTela],
  );

  async function enviar(): Promise<void> {
    // "/clear" é um comando, não uma pergunta.
    if (comandoDoPrompt(texto) === "limpar") {
      await limparConversa();
      return;
    }
    if (!temConteudo || respondendo || enviando || desconectado) {
      return;
    }
    setErro(null);
    try {
      // Só imagens, sem texto: o servidor exige uma pergunta, então vai uma padrão.
      const pergunta = texto.trim() === "" ? "Analise as imagens anexadas." : texto;
      await enviarPergunta(
        pergunta,
        imagens.map((imagem) => ({ nome: imagem.nome, tipoDeMidia: imagem.tipoDeMidia, base64: imagem.base64 })),
      );
      limparCampo();
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
      } else if (temMensagens && !oculta) {
        evento.preventDefault();
        ocultar();
      }
    }
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
      : "Pergunte qualquer coisa ao Claude · / para comandos";

  return (
    <div
      className={`chat-rapido nodrag nowheel nopan ${respondendo ? "chat-rapido-respondendo" : ""}`}
      data-testid="chat-rapido"
      {...mouseDaArea}
      onDragOver={(evento) => {
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
        if (evento.dataTransfer.files.length > 0) {
          evento.preventDefault();
          setArrastando(false);
          void anexar([...evento.dataTransfer.files]);
        }
      }}
    >
      {arrastando && <div className="soltar-imagens">solte para anexar as imagens à pergunta</div>}

      {/* Oculta, a conversa continua montada: os cartões de ação lembram o que já fizeram. */}
      {temMensagens && (
        <section className="conversa-do-chat painel-flutuante" hidden={oculta} aria-label="Conversa com o Claude">
          <header className="cabecalho-do-chat">
            <span className="rotulo-tecnico">chat rápido</span>
            {respondendo && <span className="etiqueta etiqueta-ativa etiqueta-pulso">respondendo…</span>}
            <span className="flex-1" />
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
            {chat.mensagens.map((mensagem) => (
              <Fragment key={mensagem.id}>
                <MensagemNaConversa
                  mensagem={mensagem}
                  ocultarCapturas={modoAtivo}
                  atividade={mensagem.situacao === "respondendo" ? chat.atividade : null}
                  aoAbrirTerminal={aoAbrirTerminal}
                  temVagaPara={temVagaPara}
                  aoAtualizarOrquestradores={aoAtualizarOrquestradores}
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
              </Fragment>
            ))}
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

      {modoAtivo && (
        <div className="faixa-modo-invisivel" data-testid="faixa-modo-invisivel">
          <span
            className="indicador-tela-vista"
            role="status"
            title="O Claude vê a sua tela a cada pergunta do chat: uma foto dela vai junto"
          >
            <span className="ponto-tela-vista" aria-hidden="true" />
            Tela sendo vista
          </span>
          <span className="selo-tela-junto">a tela vai junto</span>
          <span className="flex-1" />
          <button
            type="button"
            className="botao-modo-invisivel botao-modo-invisivel-ativo"
            onClick={() => void sairDoModo()}
            title="Voltar ao modo normal (Ctrl+Shift+I)"
          >
            Voltar ao modo normal
          </button>
          {erroDoModo !== null && (
            <p className="hint-error texto-longo faixa-modo-invisivel-erro" role="alert">
              {erroDoModo}{" "}
              <button type="button" className="btn btn-sm btn-ghost" onClick={descartarErroDoModo}>
                fechar
              </button>
            </p>
          )}
        </div>
      )}

      {!modoAtivo && erroDoModo !== null && (
        <p className="hint-error texto-longo" role="alert">
          {erroDoModo}{" "}
          <button type="button" className="btn btn-sm btn-ghost" onClick={descartarErroDoModo}>
            fechar
          </button>
        </p>
      )}

      <div className="moldura-do-composer">
        <div
          className={`composer-do-chat ${expandido ? "composer-expandido" : "composer-compacto"}`}
          data-testid="composer-do-chat"
          onClick={(evento) => {
            // Clicar em qualquer parte expande e leva o foco ao campo (menos dentro do menu do modelo).
            if (!(evento.target instanceof Element && evento.target.closest('[role="menu"]') !== null)) {
              campo.current?.focus();
            }
          }}
          onBlur={(evento) => {
            if (!evento.currentTarget.contains(evento.relatedTarget as Node | null)) {
              setEmUso(false);
            }
          }}
        >
          {respondendo && !desconectado && <div className="faixa-de-progresso" />}
          {imagens.length > 0 && (
            <div className="miniaturas-do-prompt">
              {imagens.map((imagem) => (
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
                    onClick={() => setImagens((atuais) => atuais.filter((item) => item.id !== imagem.id))}
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
            onChange={(evento) => {
              setTexto(evento.target.value);
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
            {modoDisponivel && !modoAtivo && (
              <button
                type="button"
                className="botao-icone botao-entrar-modo-invisivel"
                aria-label="Modo invisível"
                title="Modo invisível: janela transparente, só o chat rápido; o Claude vê a tela a cada pergunta (Ctrl+Shift+I para sair)"
                onClick={() => void entrarNoModo()}
              >
                👁
              </button>
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
                disabled={!temConteudo || enviando || desconectado}
              >
                {enviando ? "…" : "enviar ⏎"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
