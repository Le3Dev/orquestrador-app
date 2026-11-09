import type { PedidoDeTranscricao, RespostaDoTranscritor } from "./mensagens";

/** Em que idioma transcrever: português fixo (o ditado) ou detectado pelo Whisper (a escuta). */
export type IdiomaDaTranscricao = "portuguese" | "automatico";

/** Quem pediu: o ditado (alguém esperando na tela) passa na frente da escuta. */
export type OrigemDaTranscricao = "ditado" | "escuta";

export interface OpcoesDaTranscricao {
  /** Padrão: `"portuguese"`. */
  idioma?: IdiomaDaTranscricao;
  /** Padrão: `"ditado"`. */
  origem?: OrigemDaTranscricao;
}

/** A escuta deixa no máximo isto de pedidos esperando; o mais antigo sai quando chega outro. */
export const MAXIMO_DE_PEDIDOS_DA_ESCUTA_ESPERANDO = 2;

/**
 * Sem transcrição (nem ditado nem escuta) por este tempo, o worker (e o modelo
 * de ~250 MB dentro dele) é encerrado para devolver a memória. O próximo pedido
 * recria o worker, que relê o modelo do cache local (Cache API), sem baixar de novo.
 */
export const TEMPO_PARA_DESCARREGAR_O_DITADO_MS = 3 * 60_000;

/**
 * Pedido da escuta jogado fora porque a fila dela encheu (o computador não
 * acompanha a fala). Não é falha: quem pediu pode ignorar em silêncio.
 */
export class TranscricaoDescartada extends Error {
  constructor() {
    super("A transcrição foi descartada: chegaram trechos mais novos da escuta.");
    this.name = "TranscricaoDescartada";
  }
}

/** O mínimo de um Worker que o transcritor usa (um falso nos testes). */
export interface TrabalhadorDoTranscritor {
  onmessage: ((evento: MessageEvent<RespostaDoTranscritor>) => void) | null;
  onerror: ((evento: ErrorEvent) => void) | null;
  postMessage(pedido: PedidoDeTranscricao, transferir: Transferable[]): void;
  terminate(): void;
}

interface PedidoNaFila {
  readonly id: number;
  readonly audio: Float32Array;
  readonly idioma: PedidoDeTranscricao["idioma"];
  readonly origem: OrigemDaTranscricao;
  readonly resolver: (texto: string) => void;
  readonly rejeitar: (erro: Error) => void;
}

export type Transcrever = (
  audio: Float32Array,
  aoBaixar?: (progresso: number) => void,
  opcoes?: OpcoesDaTranscricao,
) => Promise<string>;

/**
 * Fila serial na frente do worker do Whisper: um pedido por vez (pedidos
 * simultâneos no worker disputam a mesma CPU e todos demoram). O ditado passa
 * na frente dos pedidos da escuta que ainda não começaram; a escuta tem no
 * máximo `MAXIMO_DE_PEDIDOS_DA_ESCUTA_ESPERANDO` esperando.
 *
 * O worker é criado só no primeiro pedido, e um para a tela toda: o modelo
 * carrega uma vez e serve ao ditado e à escuta. Com a fila vazia e nada em
 * andamento por `TEMPO_PARA_DESCARREGAR_O_DITADO_MS`, ele é encerrado; o
 * pedido seguinte cria outro.
 */
export function criarTranscritor(criarTrabalhador: () => TrabalhadorDoTranscritor): Transcrever {
  let trabalhador: TrabalhadorDoTranscritor | null = null;
  let proximoId = 1;
  let emAndamento: PedidoNaFila | null = null;
  let fila: PedidoNaFila[] = [];
  let cronometroDeDescarga: ReturnType<typeof setTimeout> | null = null;
  const ouvintesDoDownload = new Set<(progresso: number) => void>();

  function pararCronometroDeDescarga(): void {
    if (cronometroDeDescarga !== null) {
      clearTimeout(cronometroDeDescarga);
      cronometroDeDescarga = null;
    }
  }

  /** Reinicia a contagem para descarregar o modelo; nunca conta com pedido em andamento ou na fila. */
  function agendarDescarga(): void {
    pararCronometroDeDescarga();
    if (trabalhador === null || emAndamento !== null || fila.length > 0) return;
    cronometroDeDescarga = setTimeout(() => {
      cronometroDeDescarga = null;
      const ocioso = trabalhador;
      if (ocioso === null || emAndamento !== null || fila.length > 0) return;
      trabalhador = null;
      ocioso.terminate();
    }, TEMPO_PARA_DESCARREGAR_O_DITADO_MS);
  }

  function obterTrabalhador(): TrabalhadorDoTranscritor {
    if (trabalhador !== null) return trabalhador;
    const novo = criarTrabalhador();
    novo.onmessage = (evento) => {
      const resposta = evento.data;
      if (resposta.tipo === "baixando") {
        for (const ouvinte of ouvintesDoDownload) ouvinte(resposta.progresso);
        return;
      }
      const atual = emAndamento;
      if (atual === null || atual.id !== resposta.id) return;
      emAndamento = null;
      if (resposta.tipo === "texto") atual.resolver(resposta.texto);
      else atual.rejeitar(new Error(resposta.mensagem));
      processarProximo();
    };
    novo.onerror = (evento) => {
      // O worker nem subiu (ex.: falha ao carregar o script): ninguém espera para sempre.
      const erro = new Error(evento.message || "O reconhecimento de voz falhou ao iniciar.");
      const afetados = emAndamento === null ? fila : [emAndamento, ...fila];
      emAndamento = null;
      fila = [];
      for (const pedido of afetados) pedido.rejeitar(erro);
      pararCronometroDeDescarga();
      novo.terminate();
      if (trabalhador === novo) trabalhador = null;
    };
    trabalhador = novo;
    return novo;
  }

  function processarProximo(): void {
    while (emAndamento === null && fila.length > 0) {
      const proximo = fila.shift();
      if (proximo === undefined) return;
      try {
        const pedido: PedidoDeTranscricao = { id: proximo.id, audio: proximo.audio, idioma: proximo.idioma };
        // O buffer só é transferido aqui, quando o pedido começa: na fila ele ainda é de quem pediu.
        obterTrabalhador().postMessage(pedido, [proximo.audio.buffer]);
        emAndamento = proximo;
      } catch (erro) {
        proximo.rejeitar(erro instanceof Error ? erro : new Error(String(erro)));
      }
    }
    // Com trabalho, a contagem para; sem nada em andamento nem na fila, recomeça do zero.
    agendarDescarga();
  }

  function enfileirar(pedido: PedidoNaFila): void {
    if (pedido.origem === "ditado") {
      // Na frente da escuta, mas atrás de outro ditado que já esperava.
      const primeiroDaEscuta = fila.findIndex((item) => item.origem === "escuta");
      if (primeiroDaEscuta < 0) fila.push(pedido);
      else fila.splice(primeiroDaEscuta, 0, pedido);
      return;
    }
    fila.push(pedido);
    const daEscuta = fila.filter((item) => item.origem === "escuta");
    if (daEscuta.length > MAXIMO_DE_PEDIDOS_DA_ESCUTA_ESPERANDO) {
      const maisAntigo = daEscuta[0];
      if (maisAntigo !== undefined) {
        fila = fila.filter((item) => item !== maisAntigo);
        maisAntigo.rejeitar(new TranscricaoDescartada());
      }
    }
  }

  return (audio, aoBaixar, opcoes = {}) => {
    const id = proximoId++;
    if (aoBaixar !== undefined) ouvintesDoDownload.add(aoBaixar);
    return new Promise<string>((resolver, rejeitar) => {
      enfileirar({
        id,
        audio,
        idioma: (opcoes.idioma ?? "portuguese") === "automatico" ? null : "portuguese",
        origem: opcoes.origem ?? "ditado",
        resolver,
        rejeitar,
      });
      processarProximo();
    }).finally(() => {
      if (aoBaixar !== undefined) ouvintesDoDownload.delete(aoBaixar);
    });
  };
}

/**
 * Transcreve áudio mono a 16 kHz com o Whisper local. `aoBaixar` recebe o
 * progresso do primeiro download do modelo. Padrões: português e ditado. O
 * buffer do áudio é transferido ao worker quando o pedido começa: não use o
 * `audio` depois de chamar. Um pedido da escuta pode ser rejeitado com
 * `TranscricaoDescartada` se a fila dela encher.
 */
export const transcrever: Transcrever = criarTranscritor(
  () => new Worker(new URL("./transcritor.worker.ts", import.meta.url), { type: "module" }),
);
