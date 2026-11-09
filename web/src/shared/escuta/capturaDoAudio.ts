import { TAXA_DE_AMOSTRAGEM } from "./CortadorDeTrechos";

/** Quem recebe o áudio capturado e o aviso de que a captura acabou sozinha. */
export interface OuvintesDaCaptura {
  /** Pedaços mono de 16 kHz; cada um é uma cópia própria (pode guardar ou transferir). */
  aoReceberAmostras(amostras: Float32Array): void;
  /** A captura terminou sem `parar()` (ex.: a trilha de áudio acabou); `motivo` é para a tela. */
  aoEncerrar(motivo: string): void;
}

export interface CapturaDoAudio {
  /** Desliga trilhas, nós, contexto de áudio e a URL do worklet. Pode ser chamado mais de uma vez. */
  parar(): void;
}

/** O que a captura usa do navegador; os testes trocam por falsos. */
export interface DependenciasDaCaptura {
  mediaDevices: { getDisplayMedia(opcoes: DisplayMediaStreamOptions): Promise<MediaStream> } | undefined;
  criarContexto(opcoes: AudioContextOptions): AudioContext;
  criarNoDoProcessador(contexto: AudioContext, nome: string, opcoes: AudioWorkletNodeOptions): AudioWorkletNode;
  criarUrl(blob: Blob): string;
  revogarUrl(url: string): void;
}

export const NOME_DO_PROCESSADOR = "processador-da-escuta";

/** O worklet junta ~100 ms (1.600 amostras a 16 kHz) antes de mandar à thread da tela. */
export const AMOSTRAS_POR_PEDACO = TAXA_DE_AMOSTRAGEM / 10;

export const MENSAGEM_SEM_AUDIO = "O áudio do computador não veio na captura.";
export const MENSAGEM_CAPTURA_ENCERRADA =
  "A captura do áudio do computador terminou. Clique em retomar no indicador da escuta.";

/**
 * Código do AudioWorklet, carregado de um Blob: funciona igual no dev e no
 * build do Vite, sem arquivo à parte. Mistura os canais em mono (o nó já pede
 * mono ao navegador; a média é a garantia) e manda pedaços de
 * `AMOSTRAS_POR_PEDACO`, sempre num buffer novo, transferido.
 */
export const CODIGO_DO_PROCESSADOR = `
class ProcessadorDaEscuta extends AudioWorkletProcessor {
  constructor() {
    super();
    this.pedaco = new Float32Array(${AMOSTRAS_POR_PEDACO});
    this.preenchido = 0;
  }
  process(entradas) {
    const entrada = entradas[0];
    if (!entrada || entrada.length === 0) return true;
    const canais = entrada.length;
    const tamanho = entrada[0].length;
    for (let i = 0; i < tamanho; i++) {
      let soma = 0;
      for (let c = 0; c < canais; c++) soma += entrada[c][i];
      this.pedaco[this.preenchido++] = soma / canais;
      if (this.preenchido === this.pedaco.length) {
        this.port.postMessage(this.pedaco, [this.pedaco.buffer]);
        this.pedaco = new Float32Array(${AMOSTRAS_POR_PEDACO});
        this.preenchido = 0;
      }
    }
    return true;
  }
}
registerProcessor("${NOME_DO_PROCESSADOR}", ProcessadorDaEscuta);
`;

function nomeDoErro(erro: unknown): string {
  if (typeof erro === "object" && erro !== null && "name" in erro && typeof erro.name === "string") return erro.name;
  return "";
}

/** Mensagem para a pessoa a partir de uma falha ao pedir ou montar a captura. */
export function mensagemDoErroDeCaptura(erro: unknown): string {
  switch (nomeDoErro(erro)) {
    case "NotAllowedError":
    case "SecurityError":
      return "A captura do áudio não foi liberada. Clique em retomar no indicador da escuta.";
    case "InvalidStateError":
      return "A captura do áudio precisa de um clique. Clique em retomar no indicador da escuta.";
    case "NotSupportedError":
      return "Este computador não oferece a captura do áudio do sistema. A escuta só funciona no app desktop, no Windows.";
    case "NotFoundError":
      return "Nenhuma fonte de áudio do computador foi encontrada para capturar.";
    case "NotReadableError":
    case "AbortError":
      return "O áudio do computador não pôde ser lido. Clique em retomar no indicador da escuta para tentar de novo.";
    default: {
      const mensagem = erro instanceof Error ? erro.message : String(erro);
      if (mensagem === MENSAGEM_SEM_AUDIO || mensagem === MENSAGEM_CAPTURA_ENCERRADA) return mensagem;
      return `A captura do áudio do computador falhou: ${mensagem}`;
    }
  }
}

function dependenciasDoNavegador(): DependenciasDaCaptura {
  return {
    mediaDevices: typeof navigator === "undefined" ? undefined : navigator.mediaDevices,
    criarContexto: (opcoes) => new AudioContext(opcoes),
    criarNoDoProcessador: (contexto, nome, opcoes) => new AudioWorkletNode(contexto, nome, opcoes),
    criarUrl: (blob) => URL.createObjectURL(blob),
    revogarUrl: (url) => URL.revokeObjectURL(url),
  };
}

/**
 * Começa a capturar o áudio do computador (o que toca nos alto-falantes) pelo
 * `getDisplayMedia`, que no app desktop o processo principal atende com
 * `audio: 'loopback'`. O Chromium exige pedir vídeo junto: as trilhas de vídeo
 * são paradas na hora. O áudio é reamostrado a 16 kHz pelo AudioContext e
 * chega em pedaços mono por `aoReceberAmostras`. Nada é gravado em disco.
 *
 * Lança `Error` com mensagem pronta para a tela quando a captura não sai.
 */
export async function iniciarCapturaDoAudio(
  ouvintes: OuvintesDaCaptura,
  dependencias: DependenciasDaCaptura = dependenciasDoNavegador(),
): Promise<CapturaDoAudio> {
  const mediaDevices = dependencias.mediaDevices;
  if (mediaDevices === undefined || typeof mediaDevices.getDisplayMedia !== "function") {
    throw new Error(mensagemDoErroDeCaptura(new DOMException("sem getDisplayMedia", "NotSupportedError")));
  }

  let fluxo: MediaStream;
  try {
    fluxo = await mediaDevices.getDisplayMedia({ audio: true, video: true });
  } catch (erro) {
    throw new Error(mensagemDoErroDeCaptura(erro));
  }

  // Só o áudio interessa: a tela vai por outro caminho (a captura de tela do modo invisível).
  for (const trilha of fluxo.getVideoTracks()) trilha.stop();
  const trilhasDeAudio = fluxo.getAudioTracks();
  if (trilhasDeAudio.length === 0) {
    for (const trilha of fluxo.getTracks()) trilha.stop();
    throw new Error(MENSAGEM_SEM_AUDIO);
  }

  let parada = false;
  /** Só depois de montada a captura o fim da trilha vira `aoEncerrar`; antes, vira erro de `iniciar`. */
  let montada = false;
  let contexto: AudioContext | null = null;
  let url: string | null = null;
  let origem: MediaStreamAudioSourceNode | null = null;
  let no: AudioWorkletNode | null = null;

  const aoTerminarTrilha = (): void => {
    if (parada) return;
    parar();
    if (montada) ouvintes.aoEncerrar(MENSAGEM_CAPTURA_ENCERRADA);
  };

  function parar(): void {
    if (parada) return;
    parada = true;
    for (const trilha of trilhasDeAudio) trilha.removeEventListener("ended", aoTerminarTrilha);
    for (const trilha of fluxo.getTracks()) trilha.stop();
    try {
      origem?.disconnect();
      if (no !== null) {
        no.port.onmessage = null;
        no.port.close();
        no.disconnect();
      }
    } catch {
      // Nó já desligado: nada a fazer.
    }
    if (contexto !== null && contexto.state !== "closed") void contexto.close().catch(() => undefined);
    if (url !== null) dependencias.revogarUrl(url);
    origem = null;
    no = null;
    contexto = null;
    url = null;
  }

  for (const trilha of trilhasDeAudio) trilha.addEventListener("ended", aoTerminarTrilha);

  try {
    contexto = dependencias.criarContexto({ sampleRate: TAXA_DE_AMOSTRAGEM });
    url = dependencias.criarUrl(new Blob([CODIGO_DO_PROCESSADOR], { type: "text/javascript" }));
    await contexto.audioWorklet.addModule(url);
    if (parada) throw new Error(MENSAGEM_CAPTURA_ENCERRADA);
    origem = contexto.createMediaStreamSource(fluxo);
    // Sem saídas: o nó só consome (nada volta aos alto-falantes) e o navegador o processa mesmo assim.
    no = dependencias.criarNoDoProcessador(contexto, NOME_DO_PROCESSADOR, {
      numberOfInputs: 1,
      numberOfOutputs: 0,
      channelCount: 1,
      channelCountMode: "explicit",
      channelInterpretation: "speakers",
    });
    no.port.onmessage = (evento: MessageEvent<unknown>) => {
      if (!parada && evento.data instanceof Float32Array) ouvintes.aoReceberAmostras(evento.data);
    };
    origem.connect(no);
    if (contexto.state === "suspended") await contexto.resume();
    if (parada || trilhasDeAudio.every((trilha) => trilha.readyState === "ended")) {
      throw new Error(MENSAGEM_CAPTURA_ENCERRADA);
    }
  } catch (erro) {
    parar();
    throw new Error(mensagemDoErroDeCaptura(erro));
  }

  montada = true;
  return { parar };
}
