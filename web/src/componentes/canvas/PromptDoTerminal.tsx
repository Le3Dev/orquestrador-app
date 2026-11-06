import {
  type ClipboardEvent,
  type KeyboardEvent,
  memo,
  type RefObject,
  useCallback,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

import { type DadosDoPedidoNaFila, LIMITE_DA_FILA, type ModoDoTurno } from "../../shared/api/tipos";
import { comandoDoPrompt, completarComando, dicaDeComando, dicaDePedidoGrande } from "../../shared/comandosDoPrompt";
import { juntarDitado } from "../../shared/ditado/texto";
import { formatarBytes } from "../../shared/formatacao";
import { type ImagemAnexada, TIPOS_DE_IMAGEM } from "../../shared/imagens";
import { BotaoDeDitado } from "../BotaoDeDitado";
import { IconeAnexo, IconeFechar } from "../Icones";

const ALTURA_MAXIMA = 140;

const AVISO_DAS_IMAGENS =
  "imagens não entram na fila — envie quando o orquestrador estiver livre, ou remova as imagens para pôr só o texto na fila";

/** O que o terminal pode fazer no prompt de fora dele. */
export interface ControleDoPrompt {
  /** Acrescenta o texto ao fim do prompt (numa linha nova, se já houver texto) e foca o campo. Não envia. */
  acrescentarTexto: (texto: string) => void;
}

function acrescentar(atual: string, novo: string): string {
  if (atual.trim() === "") {
    return novo;
  }
  return atual.endsWith("\n") ? `${atual}${novo}` : `${atual}\n${novo}`;
}

/** A primeira linha do pedido, para caber numa linha da fila (o texto inteiro vai no `title`). */
function trechoDoPedido(texto: string): string {
  const linhas = texto.trim().split("\n");
  const primeira = linhas[0] ?? "";
  return linhas.length > 1 ? `${primeira} …` : primeira;
}

interface PropsDaFila {
  fila: readonly DadosDoPedidoNaFila[];
  /** Nenhum pedido rodando e pedidos à espera: a fila só anda com "enviar agora". */
  pausada: boolean;
  /** O pedido anterior acabou de terminar bem e o servidor está mandando o próximo. */
  enviandoProximo: boolean;
  desconectado: boolean;
  aoRemover: (pedidoId: string) => void;
  aoEnviarAgora: (pedidoId: string) => void;
}

/**
 * A fila de pedidos, compacta, acima do prompt: número, trecho do texto, o
 * selo do Plan Mode e o X para tirar da fila. Pausada, o primeiro ganha o
 * "enviar agora".
 */
function FilaDePedidos({ fila, pausada, enviandoProximo, desconectado, aoRemover, aoEnviarAgora }: PropsDaFila) {
  return (
    <section className="flex flex-col gap-0.5 px-3 pt-2" aria-label="Fila de pedidos">
      <p className="mono flex items-center gap-1.5 text-muted">
        {pausada ? (
          <span className="text-warning">fila pausada</span>
        ) : (
          <span>{enviandoProximo ? "enviando o próximo…" : "na fila"}</span>
        )}
        <span>
          · {fila.length}/{LIMITE_DA_FILA}
        </span>
        <span className="truncate">
          {pausada
            ? "· nenhum pedido rodando: envie o próximo ou remova"
            : enviandoProximo
              ? "· o pedido anterior terminou bem"
              : "· sai sozinha quando o pedido atual terminar bem"}
        </span>
      </p>
      <ol className="custom-scrollbar flex max-h-24 flex-col overflow-y-auto">
        {fila.map((pedido, indice) => {
          const numero = indice + 1;
          return (
            <li key={pedido.id} className="mono flex min-h-5 items-center gap-2 text-caption">
              <span className="w-4 shrink-0 text-right text-muted">{numero}</span>
              {pedido.modo === "planejamento" && (
                <span className="shrink-0 rounded border border-border px-1 text-[10px] text-info">plan mode</span>
              )}
              <span className="min-w-0 flex-1 truncate" title={pedido.texto}>
                {trechoDoPedido(pedido.texto)}
              </span>
              {pausada && indice === 0 && (
                <button
                  type="button"
                  className="shrink-0 rounded px-1.5 text-active hover:bg-surface-3 disabled:opacity-50"
                  disabled={desconectado}
                  title="Tira o pedido da fila e o envia agora"
                  onClick={() => aoEnviarAgora(pedido.id)}
                >
                  enviar agora
                </button>
              )}
              <button
                type="button"
                className="grid h-5 w-5 shrink-0 place-items-center rounded text-muted hover:bg-surface-3 hover:text-error disabled:opacity-50"
                disabled={desconectado}
                aria-label={`Remover da fila o pedido ${numero}`}
                title="Remover da fila"
                onClick={() => aoRemover(pedido.id)}
              >
                <IconeFechar tamanho={11} />
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

interface Props {
  /** Servidor fora do ar: dá para escrever, mas não para enviar nem cancelar. */
  desconectado: boolean;
  trabalhando: boolean;
  cancelando: boolean;
  /** Modo do próximo pedido: "planejamento" é o Plan Mode. */
  modo: ModoDoTurno;
  aoAlternarModo: () => void;
  /** O campo de texto, para quem está fora poder focá-lo (ex.: "Ajustar plano"). */
  campo: RefObject<HTMLTextAreaElement | null>;
  /** Preenchido pelo prompt: o terminal acrescenta texto por ele (ex.: uma nota arrastada). */
  controle?: RefObject<ControleDoPrompt | null>;
  imagens: readonly ImagemAnexada[];
  aoAnexar: (arquivos: File[]) => void;
  aoRemoverImagem: (id: string) => void;
  /** Devolve se a mensagem foi aceita; só então o campo é limpo. */
  aoEnviar: (texto: string) => Promise<boolean>;
  /** Com um pedido rodando, o Enter põe o texto na fila. Devolve se o servidor aceitou; só então o campo é limpo. */
  aoEnfileirar: (texto: string) => Promise<boolean>;
  /** Os pedidos à espera, na ordem em que vão sair; a mesma referência enquanto não mudam. */
  fila: readonly DadosDoPedidoNaFila[];
  /**
   * O último pedido acabou de terminar bem e o servidor está mandando o
   * próximo da fila: ela não está pausada, só a caminho. Padrão: falso.
   */
  proximoDaFilaACaminho?: boolean;
  aoRemoverDaFila: (pedidoId: string) => void;
  aoEnviarDaFila: (pedidoId: string) => void;
  /** "/clear": começa uma conversa nova. Devolve se o servidor aceitou; só então o campo é limpo. */
  aoLimparConversa: () => Promise<boolean>;
  aoCancelar: () => void;
}

/**
 * Linha de comando do terminal: Enter envia, Shift+Enter quebra linha, Esc
 * cancela o pedido em andamento e Shift+Tab liga/desliga o Plan Mode. Imagens
 * entram colando (Ctrl+V), pelo botão de anexo ou arrastando para o terminal.
 * Continua editável durante o trabalho: aí o Enter põe o pedido na fila (com
 * o modo; imagens não entram), que sai sozinha quando o pedido atual termina
 * bem. "/clear" sozinho começa uma conversa nova (Tab completa o comando). O
 * microfone dita o pedido por voz.
 *
 * Memorizado: novidades de outros terminais não o re-renderizam (o terminal
 * passa as funções estáveis).
 */
export const PromptDoTerminal = memo(function PromptDoTerminal({
  desconectado,
  trabalhando,
  cancelando,
  modo,
  aoAlternarModo,
  campo,
  controle,
  imagens,
  aoAnexar,
  aoRemoverImagem,
  aoEnviar,
  aoEnfileirar,
  fila,
  proximoDaFilaACaminho = false,
  aoRemoverDaFila,
  aoEnviarDaFila,
  aoLimparConversa,
  aoCancelar,
}: Props) {
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  // Tentou pôr imagens na fila; some quando elas saem ou o pedido acaba.
  const [avisoDasImagens, setAvisoDasImagens] = useState(false);
  // O aviso é do pedido em andamento: começou ou acabou um pedido, ele sai.
  const [trabalhandoAntes, setTrabalhandoAntes] = useState(trabalhando);
  if (trabalhando !== trabalhandoAntes) {
    setTrabalhandoAntes(trabalhando);
    setAvisoDasImagens(false);
  }
  const seletor = useRef<HTMLInputElement>(null);
  const temConteudo = texto.trim() !== "" || imagens.length > 0;
  const planejando = modo === "planejamento";
  const enviandoProximoDaFila = !trabalhando && fila.length > 0 && proximoDaFilaACaminho;
  const filaPausada = !trabalhando && fila.length > 0 && !enviandoProximoDaFila;
  const dica = dicaDeComando(texto, trabalhando) ?? dicaDePedidoGrande(texto, modo);

  const ajustarAltura = useCallback((): void => {
    const elemento = campo.current;
    if (elemento !== null) {
      elemento.style.height = "auto";
      elemento.style.height = `${Math.min(elemento.scrollHeight, ALTURA_MAXIMA)}px`;
    }
  }, [campo]);

  useImperativeHandle(
    controle,
    () => ({
      acrescentarTexto: (novo: string) => {
        setTexto((atual) => acrescentar(atual, novo));
        campo.current?.focus();
        // Depois de o React pôr o texto no campo: altura nova e cursor no fim.
        requestAnimationFrame(() => {
          ajustarAltura();
          const elemento = campo.current;
          elemento?.setSelectionRange(elemento.value.length, elemento.value.length);
        });
      },
    }),
    [campo, ajustarAltura],
  );

  async function limparConversa(): Promise<void> {
    // Durante um pedido o servidor recusaria: a dica já avisa, então nada acontece.
    if (trabalhando || enviando || desconectado) {
      return;
    }
    setEnviando(true);
    try {
      if (await aoLimparConversa()) {
        setTexto("");
        requestAnimationFrame(ajustarAltura);
      }
    } finally {
      setEnviando(false);
    }
  }

  /** Com um pedido rodando: o texto vai para a fila, com o modo. Imagens não entram: avisa e não envia. */
  async function enfileirar(): Promise<void> {
    if (imagens.length > 0) {
      setAvisoDasImagens(true);
      return;
    }
    if (texto.trim() === "") {
      return;
    }
    setEnviando(true);
    try {
      if (await aoEnfileirar(texto)) {
        setTexto("");
        requestAnimationFrame(ajustarAltura);
      }
    } finally {
      setEnviando(false);
    }
  }

  async function enviar(): Promise<void> {
    // Antes da trava do envio: "/clear" é um comando, não um pedido. As imagens
    // anexadas e o modo ficam para o próximo pedido.
    if (comandoDoPrompt(texto) === "limpar") {
      await limparConversa();
      return;
    }
    if (!temConteudo || enviando || desconectado) {
      return;
    }
    if (trabalhando) {
      await enfileirar();
      return;
    }
    setEnviando(true);
    try {
      if (await aoEnviar(texto)) {
        setTexto("");
        setAvisoDasImagens(false);
        requestAnimationFrame(ajustarAltura);
      }
    } finally {
      setEnviando(false);
    }
  }

  function aoTeclar(evento: KeyboardEvent<HTMLTextAreaElement>): void {
    // Como no Claude Code. Sem o preventDefault, o foco sairia do campo.
    if (evento.key === "Tab" && evento.shiftKey) {
      evento.preventDefault();
      aoAlternarModo();
      return;
    }
    // Tab completa o comando começado ("/cl" → "/clear"); fora disso, segue o padrão.
    const completo = evento.key === "Tab" ? completarComando(texto) : null;
    if (completo !== null) {
      evento.preventDefault();
      setTexto(completo);
      return;
    }
    if (evento.key === "Enter" && !evento.shiftKey) {
      evento.preventDefault();
      void enviar();
    }
    if (evento.key === "Escape" && trabalhando && !cancelando && !desconectado) {
      evento.preventDefault();
      aoCancelar();
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
      aoAnexar(arquivos);
    }
  }

  return (
    <div className="area-do-prompt nodrag nowheel">
      {fila.length > 0 && (
        <FilaDePedidos
          fila={fila}
          pausada={filaPausada}
          enviandoProximo={enviandoProximoDaFila}
          desconectado={desconectado}
          aoRemover={aoRemoverDaFila}
          aoEnviarAgora={aoEnviarDaFila}
        />
      )}
      {imagens.length > 0 && (
        <div className="miniaturas-do-prompt">
          {imagens.map((imagem) => (
            <figure key={imagem.id} className="miniatura" title={`${imagem.nome} · ${formatarBytes(imagem.tamanhoEmBytes)}`}>
              <img src={imagem.previa} alt={imagem.nome} />
              <button
                type="button"
                className="miniatura-remover"
                aria-label={`Remover ${imagem.nome}`}
                onClick={() => aoRemoverImagem(imagem.id)}
              >
                <IconeFechar tamanho={11} />
              </button>
            </figure>
          ))}
        </div>
      )}
      <div className="prompt-do-terminal">
        <span className={planejando ? "text-info" : "text-active"}>❯</span>
        <textarea
          ref={campo}
          rows={1}
          value={texto}
          onChange={(evento) => {
            setTexto(evento.target.value);
            ajustarAltura();
          }}
          onKeyDown={aoTeclar}
          onPaste={aoColar}
          placeholder={
            desconectado
              ? "servidor desconectado — dá para escrever, o envio volta quando ele voltar"
              : trabalhando
                ? "trabalhando… escreva o próximo e enter põe na fila · esc cancela"
                : planejando
                  ? "descreva o que planejar — nada é alterado até você aprovar"
                  : "peça algo e pressione enter · cole ou arraste imagens"
          }
          aria-label="Mensagem para o orquestrador"
        />
        <input
          ref={seletor}
          type="file"
          accept={TIPOS_DE_IMAGEM.join(",")}
          multiple
          hidden
          onChange={(evento) => {
            aoAnexar([...(evento.target.files ?? [])]);
            evento.target.value = "";
          }}
        />
        <BotaoDeDitado destino="a mensagem" aoTranscrever={receberDitado} />
        <button
          type="button"
          className="botao-icone"
          title="Anexar imagens (também dá para colar com Ctrl+V ou arrastar para o terminal)"
          aria-label="Anexar imagens"
          onClick={() => seletor.current?.click()}
        >
          <IconeAnexo />
        </button>
        {trabalhando ? (
          <button
            type="button"
            className="btn btn-sm btn-danger"
            onClick={aoCancelar}
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
      {avisoDasImagens && trabalhando && imagens.length > 0 && (
        <p className="mono hint-warning px-[14px] pb-0.5" role="alert">
          {AVISO_DAS_IMAGENS}
        </p>
      )}
      {dica !== null && (
        <p className="mono hint px-[14px] pb-0.5" role="status">
          {dica}
        </p>
      )}
      <button
        type="button"
        className={`selo-de-modo ${planejando ? "selo-de-modo-ativo" : ""}`}
        aria-pressed={planejando}
        title="Alterna o modo do próximo pedido (Shift+Tab)"
        onClick={aoAlternarModo}
      >
        {planejando ? "‖ plan mode ligado · só investiga e propõe um plano" : "› execução"}
        <span className="text-muted"> · shift+tab alterna</span>
      </button>
    </div>
  );
});
