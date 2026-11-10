import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  MODELO_DA_ESCUTA,
  MODELO_DO_DITADO,
  type PedidoDeTranscricao,
  type RespostaDoTranscritor,
} from "./mensagens";
import {
  criarTranscritor,
  MAXIMO_DE_PEDIDOS_DA_ESCUTA_ESPERANDO,
  TEMPO_PARA_DESCARREGAR_O_DITADO_MS,
  type TrabalhadorDoTranscritor,
  TranscricaoDescartada,
} from "./transcritor";

/** Worker falso: guarda os pedidos e responde quando o teste mandar. */
class TrabalhadorFalso implements TrabalhadorDoTranscritor {
  onmessage: ((evento: MessageEvent<RespostaDoTranscritor>) => void) | null = null;
  onerror: ((evento: ErrorEvent) => void) | null = null;
  readonly pedidos: PedidoDeTranscricao[] = [];
  readonly terminate = vi.fn(() => {
    this.encerrado = true;
  });
  encerrado = false;

  postMessage(pedido: PedidoDeTranscricao): void {
    this.pedidos.push(pedido);
  }

  responder(resposta: RespostaDoTranscritor): void {
    this.onmessage?.({ data: resposta } as MessageEvent<RespostaDoTranscritor>);
  }

  /** Responde o último pedido recebido com um texto. */
  concluirUltimo(texto: string): void {
    const ultimo = this.pedidos.at(-1);
    if (ultimo === undefined) throw new Error("nenhum pedido para concluir");
    this.responder({ tipo: "texto", id: ultimo.id, texto });
  }
}

function montar() {
  const trabalhador = new TrabalhadorFalso();
  let criados = 0;
  const transcrever = criarTranscritor(() => {
    criados++;
    return trabalhador;
  });
  return { trabalhador, transcrever, criados: () => criados };
}

const audio = (valor = 0) => new Float32Array([valor, valor, valor]);

/** Deixa as promessas resolvidas rodarem os seus `then`. */
const esvaziar = () => new Promise<void>((resolver) => setTimeout(resolver, 0));

describe("transcritor", () => {
  it("só cria o worker no primeiro pedido e manda um pedido por vez, na ordem", async () => {
    const { trabalhador, transcrever, criados } = montar();
    expect(criados()).toBe(0);

    const primeiro = transcrever(audio(1));
    const segundo = transcrever(audio(2));
    expect(criados()).toBe(1);
    expect(trabalhador.pedidos).toHaveLength(1);
    expect(trabalhador.pedidos[0]?.audio[0]).toBe(1);

    trabalhador.concluirUltimo("um");
    await expect(primeiro).resolves.toBe("um");
    expect(trabalhador.pedidos).toHaveLength(2);
    expect(trabalhador.pedidos[1]?.audio[0]).toBe(2);

    trabalhador.concluirUltimo("dois");
    await expect(segundo).resolves.toBe("dois");
  });

  it("por padrão pede português; com idioma automático, manda idioma nulo", () => {
    const { trabalhador, transcrever } = montar();
    void transcrever(audio());
    expect(trabalhador.pedidos[0]?.idioma).toBe("portuguese");

    trabalhador.concluirUltimo("ok");
    void transcrever(audio(), undefined, { idioma: "automatico", origem: "escuta" });
    return esvaziar().then(() => {
      expect(trabalhador.pedidos[1]?.idioma).toBeNull();
    });
  });

  it("o modelo vai pela origem: ditado com whisper-small, escuta com whisper-base", async () => {
    const { trabalhador, transcrever } = montar();
    const ditado = transcrever(audio(1));
    const escuta = transcrever(audio(2), undefined, { origem: "escuta" });
    expect(trabalhador.pedidos[0]?.modelo).toBe(MODELO_DO_DITADO);
    expect(MODELO_DO_DITADO).toBe("onnx-community/whisper-small");
    trabalhador.concluirUltimo("d");
    await ditado;
    expect(trabalhador.pedidos[1]?.modelo).toBe(MODELO_DA_ESCUTA);
    expect(MODELO_DA_ESCUTA).toBe("onnx-community/whisper-base");
    trabalhador.concluirUltimo("e");
    await escuta;
  });

  it("a provisória só entra com a fila vazia: havendo pedido esperando, é descartada sem enfileirar", async () => {
    const { trabalhador, transcrever } = montar();
    const final1 = transcrever(audio(1), undefined, { origem: "escuta" });
    const provisoria1 = transcrever(audio(2), undefined, { origem: "escuta", provisoria: true });
    // Há um pedido em andamento, mas a fila está vazia: a provisória espera.
    const provisoria2 = transcrever(audio(3), undefined, { origem: "escuta", provisoria: true });
    await expect(provisoria2).rejects.toBeInstanceOf(TranscricaoDescartada);

    trabalhador.concluirUltimo("1");
    await expect(final1).resolves.toBe("1");
    expect(trabalhador.pedidos[1]?.audio[0]).toBe(2);
    trabalhador.concluirUltimo("p");
    await expect(provisoria1).resolves.toBe("p");
  });

  it("um trecho final descarta a provisória que esperava e nunca é descartado por ela", async () => {
    const { trabalhador, transcrever } = montar();
    const emAndamento = transcrever(audio(1), undefined, { origem: "escuta" });
    const provisoria = transcrever(audio(2), undefined, { origem: "escuta", provisoria: true });
    const final1 = transcrever(audio(3), undefined, { origem: "escuta" });
    const final2 = transcrever(audio(4), undefined, { origem: "escuta" });
    await expect(provisoria).rejects.toBeInstanceOf(TranscricaoDescartada);

    // Os dois finais esperando cabem no limite: nada foi descartado por causa da provisória.
    trabalhador.concluirUltimo("0");
    await expect(emAndamento).resolves.toBe("0");
    trabalhador.concluirUltimo("1");
    await expect(final1).resolves.toBe("1");
    trabalhador.concluirUltimo("2");
    await expect(final2).resolves.toBe("2");
  });

  it("o ditado passa na frente dos pedidos da escuta que ainda não começaram", async () => {
    const { trabalhador, transcrever } = montar();
    const escuta1 = transcrever(audio(1), undefined, { idioma: "automatico", origem: "escuta" });
    const escuta2 = transcrever(audio(2), undefined, { idioma: "automatico", origem: "escuta" });
    const ditado = transcrever(audio(3));

    // O primeiro da escuta já estava no worker: não é interrompido.
    trabalhador.concluirUltimo("e1");
    await expect(escuta1).resolves.toBe("e1");
    expect(trabalhador.pedidos[1]?.audio[0]).toBe(3);

    trabalhador.concluirUltimo("d");
    await expect(ditado).resolves.toBe("d");
    expect(trabalhador.pedidos[2]?.audio[0]).toBe(2);

    trabalhador.concluirUltimo("e2");
    await expect(escuta2).resolves.toBe("e2");
  });

  it("dois ditados esperando ficam na ordem em que chegaram, ambos antes da escuta", async () => {
    const { trabalhador, transcrever } = montar();
    void transcrever(audio(1), undefined, { origem: "escuta" });
    void transcrever(audio(2), undefined, { origem: "escuta" });
    void transcrever(audio(3));
    void transcrever(audio(4));

    const ordem: number[] = [];
    for (let i = 0; i < 4; i++) {
      ordem.push(trabalhador.pedidos[i]?.audio[0] ?? -1);
      trabalhador.concluirUltimo("x");
      await esvaziar();
    }
    expect(ordem).toEqual([1, 3, 4, 2]);
  });

  it(`a escuta deixa no máximo ${MAXIMO_DE_PEDIDOS_DA_ESCUTA_ESPERANDO} esperando: o mais antigo é descartado`, async () => {
    const { trabalhador, transcrever } = montar();
    const emAndamento = transcrever(audio(1), undefined, { origem: "escuta" });
    const esperando1 = transcrever(audio(2), undefined, { origem: "escuta" });
    const esperando2 = transcrever(audio(3), undefined, { origem: "escuta" });
    const esperando3 = transcrever(audio(4), undefined, { origem: "escuta" });

    await expect(esperando1).rejects.toBeInstanceOf(TranscricaoDescartada);

    trabalhador.concluirUltimo("1");
    await expect(emAndamento).resolves.toBe("1");
    trabalhador.concluirUltimo("3");
    await expect(esperando2).resolves.toBe("3");
    trabalhador.concluirUltimo("4");
    await expect(esperando3).resolves.toBe("4");
    expect(trabalhador.pedidos.map((pedido) => pedido.audio[0])).toEqual([1, 3, 4]);
  });

  it("um ditado esperando não conta no limite da escuta", async () => {
    const { trabalhador, transcrever } = montar();
    void transcrever(audio(1));
    const e1 = transcrever(audio(2), undefined, { origem: "escuta" });
    const e2 = transcrever(audio(3), undefined, { origem: "escuta" });
    const d = transcrever(audio(4));
    trabalhador.concluirUltimo("d0");
    await esvaziar();
    trabalhador.concluirUltimo("d");
    await expect(d).resolves.toBe("d");
    trabalhador.concluirUltimo("e1");
    await expect(e1).resolves.toBe("e1");
    trabalhador.concluirUltimo("e2");
    await expect(e2).resolves.toBe("e2");
  });

  it("erro do worker rejeita só o pedido dele e a fila segue", async () => {
    const { trabalhador, transcrever } = montar();
    const falha = transcrever(audio(1));
    const seguinte = transcrever(audio(2));
    const primeiro = trabalhador.pedidos[0];
    if (primeiro === undefined) throw new Error("sem pedido");
    trabalhador.responder({ tipo: "erro", id: primeiro.id, mensagem: "modelo quebrado" });
    await expect(falha).rejects.toThrow("modelo quebrado");
    trabalhador.concluirUltimo("ok");
    await expect(seguinte).resolves.toBe("ok");
  });

  it("se o worker não sobe, todos os pedidos (em andamento e na fila) são rejeitados", async () => {
    const { trabalhador, transcrever } = montar();
    const a = transcrever(audio(1));
    const b = transcrever(audio(2), undefined, { origem: "escuta" });
    trabalhador.onerror?.({ message: "script não carregou" } as ErrorEvent);
    await expect(a).rejects.toThrow("script não carregou");
    await expect(b).rejects.toThrow("script não carregou");
    expect(trabalhador.encerrado).toBe(true);
  });

  it("o progresso do download chega a quem espera e para depois que o pedido termina", async () => {
    const { trabalhador, transcrever } = montar();
    const progressos: number[] = [];
    const pedido = transcrever(audio(), (progresso) => progressos.push(progresso));
    trabalhador.responder({ tipo: "baixando", progresso: 40 });
    trabalhador.concluirUltimo("ok");
    await pedido;
    trabalhador.responder({ tipo: "baixando", progresso: 90 });
    expect(progressos).toEqual([40]);
  });
});

describe("transcritor · descarga do modelo ocioso", () => {
  /** Um worker novo a cada criação, para ver o encerramento e a recriação. */
  function montarComRecriacao() {
    const criados: TrabalhadorFalso[] = [];
    const transcrever = criarTranscritor(() => {
      const novo = new TrabalhadorFalso();
      criados.push(novo);
      return novo;
    });
    return { criados, transcrever };
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("encerra o worker depois de 3 minutos sem uso", async () => {
    expect(TEMPO_PARA_DESCARREGAR_O_DITADO_MS).toBe(3 * 60_000);
    const { criados, transcrever } = montarComRecriacao();

    const resultado = transcrever(audio());
    const [worker] = criados;
    worker?.concluirUltimo("olá mundo");
    await expect(resultado).resolves.toBe("olá mundo");

    await vi.advanceTimersByTimeAsync(TEMPO_PARA_DESCARREGAR_O_DITADO_MS - 1);
    expect(worker?.terminate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(worker?.terminate).toHaveBeenCalledTimes(1);
  });

  it("não encerra durante uma transcrição", async () => {
    const { criados, transcrever } = montarComRecriacao();

    const primeiro = transcrever(audio());
    const [worker] = criados;
    worker?.concluirUltimo("um");
    await primeiro;

    // Segundo ditado no meio da contagem: ela para enquanto ele roda.
    await vi.advanceTimersByTimeAsync(TEMPO_PARA_DESCARREGAR_O_DITADO_MS - 1000);
    const segundo = transcrever(audio());
    await vi.advanceTimersByTimeAsync(TEMPO_PARA_DESCARREGAR_O_DITADO_MS * 2);
    expect(worker?.terminate).not.toHaveBeenCalled();

    worker?.concluirUltimo("dois");
    await expect(segundo).resolves.toBe("dois");
    // A contagem recomeça do zero depois do uso.
    await vi.advanceTimersByTimeAsync(TEMPO_PARA_DESCARREGAR_O_DITADO_MS - 1);
    expect(worker?.terminate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(worker?.terminate).toHaveBeenCalledTimes(1);
  });

  it("não encerra com pedidos da escuta ainda na fila", async () => {
    const { criados, transcrever } = montarComRecriacao();

    const emAndamento = transcrever(audio(1), undefined, { origem: "escuta" });
    const esperando = transcrever(audio(2), undefined, { origem: "escuta" });
    const [worker] = criados;

    worker?.concluirUltimo("1");
    await expect(emAndamento).resolves.toBe("1");
    // O segundo começou assim que o primeiro terminou: a contagem não corre.
    await vi.advanceTimersByTimeAsync(TEMPO_PARA_DESCARREGAR_O_DITADO_MS * 2);
    expect(worker?.terminate).not.toHaveBeenCalled();

    worker?.concluirUltimo("2");
    await expect(esperando).resolves.toBe("2");
    await vi.advanceTimersByTimeAsync(TEMPO_PARA_DESCARREGAR_O_DITADO_MS);
    expect(worker?.terminate).toHaveBeenCalledTimes(1);
  });

  it("recria o worker no uso seguinte, com o mesmo texto", async () => {
    const { criados, transcrever } = montarComRecriacao();

    const primeiro = transcrever(audio());
    criados[0]?.concluirUltimo("antes");
    await expect(primeiro).resolves.toBe("antes");
    await vi.advanceTimersByTimeAsync(TEMPO_PARA_DESCARREGAR_O_DITADO_MS);
    expect(criados[0]?.terminate).toHaveBeenCalledTimes(1);

    const segundo = transcrever(audio());
    expect(criados).toHaveLength(2);
    criados[1]?.concluirUltimo("depois");
    await expect(segundo).resolves.toBe("depois");
  });
});
