import type { PedidoDeTranscricao, RespostaDoTranscritor } from "./mensagens";

/** Worker falso: guarda os pedidos e responde quando o teste mandar. */
class WorkerFalso {
  static criados: WorkerFalso[] = [];
  onmessage: ((evento: MessageEvent<RespostaDoTranscritor>) => void) | null = null;
  onerror: ((evento: ErrorEvent) => void) | null = null;
  readonly pedidos: PedidoDeTranscricao[] = [];
  readonly terminate = vi.fn();

  constructor() {
    WorkerFalso.criados.push(this);
  }

  postMessage(pedido: PedidoDeTranscricao): void {
    this.pedidos.push(pedido);
  }

  responder(texto: string): void {
    const pedido = this.pedidos.shift();
    if (pedido === undefined) throw new Error("nenhum pedido pendente");
    this.onmessage?.({ data: { tipo: "texto", id: pedido.id, texto } } as MessageEvent<RespostaDoTranscritor>);
  }
}

async function carregarTranscritor() {
  vi.resetModules();
  return import("./transcritor");
}

describe("transcritor · descarga do modelo ocioso", () => {
  beforeEach(() => {
    WorkerFalso.criados = [];
    vi.useFakeTimers();
    vi.stubGlobal("Worker", WorkerFalso);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("encerra o worker depois de 3 minutos sem uso", async () => {
    const { transcrever, TEMPO_PARA_DESCARREGAR_O_DITADO_MS } = await carregarTranscritor();
    expect(TEMPO_PARA_DESCARREGAR_O_DITADO_MS).toBe(3 * 60_000);

    const resultado = transcrever(new Float32Array(16));
    const [worker] = WorkerFalso.criados;
    worker?.responder("olá mundo");
    await expect(resultado).resolves.toBe("olá mundo");

    await vi.advanceTimersByTimeAsync(TEMPO_PARA_DESCARREGAR_O_DITADO_MS - 1);
    expect(worker?.terminate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(worker?.terminate).toHaveBeenCalledTimes(1);
  });

  it("não encerra durante uma transcrição", async () => {
    const { transcrever, TEMPO_PARA_DESCARREGAR_O_DITADO_MS } = await carregarTranscritor();

    const primeiro = transcrever(new Float32Array(16));
    const [worker] = WorkerFalso.criados;
    worker?.responder("um");
    await primeiro;

    // Segundo ditado no meio da contagem: ela para enquanto ele roda.
    await vi.advanceTimersByTimeAsync(TEMPO_PARA_DESCARREGAR_O_DITADO_MS - 1000);
    const segundo = transcrever(new Float32Array(16));
    await vi.advanceTimersByTimeAsync(TEMPO_PARA_DESCARREGAR_O_DITADO_MS * 2);
    expect(worker?.terminate).not.toHaveBeenCalled();

    worker?.responder("dois");
    await expect(segundo).resolves.toBe("dois");
    // A contagem recomeça do zero depois do uso.
    await vi.advanceTimersByTimeAsync(TEMPO_PARA_DESCARREGAR_O_DITADO_MS - 1);
    expect(worker?.terminate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(worker?.terminate).toHaveBeenCalledTimes(1);
  });

  it("recria o worker no uso seguinte, com o mesmo texto", async () => {
    const { transcrever, TEMPO_PARA_DESCARREGAR_O_DITADO_MS } = await carregarTranscritor();

    const primeiro = transcrever(new Float32Array(16));
    WorkerFalso.criados[0]?.responder("antes");
    await expect(primeiro).resolves.toBe("antes");
    await vi.advanceTimersByTimeAsync(TEMPO_PARA_DESCARREGAR_O_DITADO_MS);
    expect(WorkerFalso.criados[0]?.terminate).toHaveBeenCalledTimes(1);

    const segundo = transcrever(new Float32Array(16));
    expect(WorkerFalso.criados).toHaveLength(2);
    WorkerFalso.criados[1]?.responder("depois");
    await expect(segundo).resolves.toBe("depois");
  });
});
