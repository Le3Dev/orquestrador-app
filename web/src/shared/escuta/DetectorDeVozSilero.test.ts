import { AMOSTRAS_POR_JANELA_DO_VAD, type JanelasAnalisadas } from "./DetectorDeVoz";
import { DetectorDeVozSilero, type PedidoAoVad, type RespostaDoVad, type TrabalhadorDoVad } from "./DetectorDeVozSilero";

const N = AMOSTRAS_POR_JANELA_DO_VAD;

/** Worker falso: guarda os pedidos e só responde quando o teste manda. */
class TrabalhadorFalso implements TrabalhadorDoVad {
  onmessage: ((evento: MessageEvent<RespostaDoVad>) => void) | null = null;
  onerror: ((evento: ErrorEvent) => void) | null = null;
  readonly pedidos: PedidoAoVad[] = [];
  readonly transferidos: Transferable[] = [];
  encerrado = false;

  postMessage(pedido: PedidoAoVad, transferir: Transferable[]): void {
    this.pedidos.push(pedido);
    this.transferidos.push(...transferir);
  }

  terminate(): void {
    this.encerrado = true;
  }

  /** Os pedidos de análise recebidos, na ordem. */
  get analises(): Extract<PedidoAoVad, { tipo: "analisar" }>[] {
    return this.pedidos.filter((pedido) => pedido.tipo === "analisar");
  }

  /** Responde a análise de índice `indice` com a mesma probabilidade em todas as janelas. */
  responder(indice: number, probabilidade = 0.5): void {
    const pedido = this.analises[indice];
    if (pedido === undefined) throw new Error(`Não há análise ${indice}.`);
    const probabilidades = Array.from({ length: pedido.amostras.length / N }, () => probabilidade);
    this.emitir({ tipo: "probabilidades", id: pedido.id, amostras: pedido.amostras, probabilidades });
  }

  emitir(resposta: RespostaDoVad): void {
    this.onmessage?.(new MessageEvent("message", { data: resposta }));
  }
}

/** Amostras 0, 1, 2… a partir de `inicio`: dá para ver de onde cada uma veio. */
function rampa(quantidade: number, inicio = 0): Float32Array {
  return Float32Array.from({ length: quantidade }, (_, i) => inicio + i);
}

function criar(): { detector: DetectorDeVozSilero; trabalhadores: TrabalhadorFalso[] } {
  const trabalhadores: TrabalhadorFalso[] = [];
  const detector = new DetectorDeVozSilero(() => {
    const novo = new TrabalhadorFalso();
    trabalhadores.push(novo);
    return novo;
  });
  return { detector, trabalhadores };
}

/** O único worker criado até agora. */
function unico(trabalhadores: readonly TrabalhadorFalso[]): TrabalhadorFalso {
  expect(trabalhadores).toHaveLength(1);
  const trabalhador = trabalhadores[0];
  if (trabalhador === undefined) throw new Error("Nenhum worker criado.");
  return trabalhador;
}

describe("DetectorDeVozSilero", () => {
  it("manda ao worker só janelas inteiras e guarda o resto para a próxima chamada", async () => {
    const { detector, trabalhadores } = criar();

    const primeira = detector.analisar(rampa(1_000));
    const trabalhador = unico(trabalhadores);
    expect(trabalhador.analises[0]?.amostras).toEqual(rampa(N));
    trabalhador.responder(0, 0.9);
    const janelas1 = await primeira;
    expect(janelas1.probabilidades).toEqual([0.9]);
    expect(janelas1.amostras).toEqual(rampa(N));

    // 488 guardadas + 100 novas = 588: uma janela (as 488 e as 24 primeiras novas) e sobram 76.
    const segunda = detector.analisar(rampa(100, 1_000));
    const enviada = trabalhador.analises[1]?.amostras;
    expect(enviada?.length).toBe(N);
    expect(enviada?.subarray(0, 488)).toEqual(rampa(488, N));
    expect(enviada?.subarray(488)).toEqual(rampa(24, 1_000));
    trabalhador.responder(1, 0.2);
    expect((await segunda).probabilidades).toEqual([0.2]);

    // 76 + 1_000 = 1_076: duas janelas, começando pelas 76 guardadas.
    const terceira = detector.analisar(rampa(1_000, 5_000));
    const duas = trabalhador.analises[2]?.amostras;
    expect(duas?.length).toBe(2 * N);
    expect(duas?.subarray(0, 76)).toEqual(rampa(76, 1_024));
    expect(duas?.subarray(76)).toEqual(rampa(2 * N - 76, 5_000));
    trabalhador.responder(2, 0.6);
    const janelas3 = await terceira;
    expect(janelas3.probabilidades).toEqual([0.6, 0.6]);
    expect(janelas3.amostras.length).toBe(janelas3.probabilidades.length * N);
  });

  it("não guarda nem transfere a entrada de quem chamou", async () => {
    const { detector, trabalhadores } = criar();
    const entrada = rampa(2 * N);
    const resultado = detector.analisar(entrada);
    const trabalhador = unico(trabalhadores);
    expect(trabalhador.transferidos).toHaveLength(1);
    expect(trabalhador.transferidos[0]).not.toBe(entrada.buffer);
    entrada.fill(-1);
    trabalhador.responder(0);
    expect((await resultado).amostras).toEqual(rampa(2 * N));
  });

  it("sem janela inteira não chama o worker e responde vazio", async () => {
    const { detector, trabalhadores } = criar();
    const janelas = await detector.analisar(rampa(N - 1));
    expect(janelas.amostras.length).toBe(0);
    expect(janelas.probabilidades).toEqual([]);
    expect(trabalhadores).toHaveLength(0);
  });

  it("responde na ordem dos pedidos, mesmo os que não fecharam janela", async () => {
    const { detector, trabalhadores } = criar();
    const ordem: string[] = [];
    const anotar = (nome: string) => (janelas: JanelasAnalisadas) => ordem.push(`${nome}:${janelas.probabilidades.length}`);

    const a = detector.analisar(rampa(N)).then(anotar("a"));
    const b = detector.analisar(rampa(10)).then(anotar("b"));
    const c = detector.analisar(rampa(N)).then(anotar("c"));
    const trabalhador = unico(trabalhadores);
    expect(trabalhador.analises).toHaveLength(2);

    await Promise.resolve();
    expect(ordem).toEqual([]);
    trabalhador.responder(0);
    trabalhador.responder(1);
    await Promise.all([a, b, c]);
    expect(ordem).toEqual(["a:1", "b:0", "c:1"]);
  });

  it("ignora resposta fora de ordem ou de id desconhecido", async () => {
    const { detector, trabalhadores } = criar();
    let resolvida = false;
    const pedido = detector.analisar(rampa(N)).then(() => (resolvida = true));
    const trabalhador = unico(trabalhadores);
    trabalhador.emitir({ tipo: "probabilidades", id: 999, amostras: new Float32Array(N), probabilidades: [1] });
    await Promise.resolve();
    expect(resolvida).toBe(false);
    trabalhador.responder(0);
    await pedido;
    expect(resolvida).toBe(true);
  });

  it("reiniciar descarta o resto guardado e zera o modelo no worker", async () => {
    const { detector, trabalhadores } = criar();
    const primeira = detector.analisar(rampa(N + 100));
    const trabalhador = unico(trabalhadores);
    detector.reiniciar();
    expect(trabalhador.pedidos.at(-1)).toEqual({ tipo: "reiniciar" });

    // O pedido já feito ainda é respondido.
    trabalhador.responder(0);
    expect((await primeira).probabilidades).toHaveLength(1);

    // As 100 guardadas foram descartadas: a próxima janela começa nas amostras novas.
    void detector.analisar(rampa(N, 7_000));
    expect(trabalhador.analises[1]?.amostras).toEqual(rampa(N, 7_000));
  });

  it("erro numa análise rejeita só aquele pedido", async () => {
    const { detector, trabalhadores } = criar();
    const ruim = detector.analisar(rampa(N));
    const boa = detector.analisar(rampa(N));
    const trabalhador = unico(trabalhadores);
    const id = trabalhador.analises[0]?.id ?? -1;
    trabalhador.emitir({ tipo: "erro", id, mensagem: "falhou o modelo" });
    trabalhador.responder(1);
    await expect(ruim).rejects.toThrow("falhou o modelo");
    expect((await boa).probabilidades).toHaveLength(1);
  });

  it("falha do worker rejeita todos os pendentes e a próxima análise cria outro", async () => {
    const { detector, trabalhadores } = criar();
    const a = detector.analisar(rampa(N));
    const b = detector.analisar(rampa(10));
    const trabalhador = unico(trabalhadores);
    trabalhador.onerror?.(new ErrorEvent("error", { message: "script não carregou" }));
    await expect(a).rejects.toThrow("script não carregou");
    await expect(b).rejects.toThrow("script não carregou");
    expect(trabalhador.encerrado).toBe(true);

    void detector.analisar(rampa(N));
    expect(trabalhadores).toHaveLength(2);
  });

  it("encerrar termina o worker e rejeita os pendentes", async () => {
    const { detector, trabalhadores } = criar();
    const pendente = detector.analisar(rampa(N + 7));
    const trabalhador = unico(trabalhadores);
    detector.encerrar();
    expect(trabalhador.encerrado).toBe(true);
    await expect(pendente).rejects.toThrow(/encerrado/);

    // Uma resposta atrasada do worker antigo não afeta nada; o resto também foi descartado.
    trabalhador.responder(0);
    void detector.analisar(rampa(N, 100));
    expect(trabalhadores).toHaveLength(2);
    expect(trabalhadores[1]?.analises[0]?.amostras).toEqual(rampa(N, 100));
  });
});
