import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  codigoDoIdioma,
  emMegabytes,
  MODELO_DA_ESCUTA,
  MODELO_DO_DITADO,
  type PedidoAoTranscritor,
  type PedidoDeTranscricao,
  type RespostaDoTranscritor,
  segmentosDaSaida,
} from "./mensagens";
import type { OpcoesDaPassada, ResultadoDaTranscricao, SegmentoTranscrito } from "./motor";
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
  readonly mensagens: PedidoAoTranscritor[] = [];
  readonly terminate = vi.fn(() => {
    this.encerrado = true;
  });
  encerrado = false;

  /** Só os pedidos de transcrição (sem os de preparo). */
  get pedidos(): PedidoDeTranscricao[] {
    return this.mensagens.filter((mensagem): mensagem is PedidoDeTranscricao => mensagem.tipo === "transcrever");
  }

  /** O que foi transferido em cada `postMessage`. */
  readonly transferidos: Transferable[][] = [];

  postMessage(pedido: PedidoAoTranscritor, transferir: Transferable[]): void {
    this.mensagens.push(pedido);
    this.transferidos.push(transferir);
  }

  responder(resposta: RespostaDoTranscritor): void {
    this.onmessage?.({ data: resposta } as MessageEvent<RespostaDoTranscritor>);
  }

  /** Responde o último pedido de transcrição recebido com um texto. */
  concluirUltimo(texto: string, segmentos: SegmentoTranscrito[] = [], idioma = "pt"): void {
    const ultimo = this.pedidos.at(-1);
    if (ultimo === undefined) throw new Error("nenhum pedido para concluir");
    this.responder({ tipo: "resultado", id: ultimo.id, texto, segmentos, idioma, duracaoDaPassadaMs: 12 });
  }
}

function montar() {
  const trabalhador = new TrabalhadorFalso();
  let criados = 0;
  const motor = criarTranscritor(() => {
    criados++;
    return trabalhador;
  });
  /** A passada inteira, como o motor devolve. */
  const passada = (amostras: Float32Array, opcoes: OpcoesDaPassada = { origem: "ditado" }) =>
    motor.transcrever(amostras, opcoes);
  /** Só o texto da passada (a maioria dos testes de fila só olha a ordem). */
  const transcrever = (amostras: Float32Array, opcoes: OpcoesDaPassada = { origem: "ditado" }) =>
    passada(amostras, opcoes).then((resultado) => resultado.texto);
  return { trabalhador, motor, passada, transcrever, criados: () => criados };
}

const audio = (valor = 0) => new Float32Array([valor, valor, valor]);

/** Deixa as promessas resolvidas rodarem os seus `then`. */
const esvaziar = () => new Promise<void>((resolver) => setTimeout(resolver, 0));

describe("transcritor (reserva no navegador)", () => {
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

  it("idioma: português fixo por padrão, sem detecção; 'automatico' pede a detecção; um código vai como veio", async () => {
    const { trabalhador, transcrever } = montar();
    void transcrever(audio());
    expect(trabalhador.pedidos[0]?.idioma).toBe("portuguese");

    trabalhador.concluirUltimo("ok");
    void transcrever(audio(), { origem: "escuta", idioma: "automatico" });
    await esvaziar();
    expect(trabalhador.pedidos[1]?.idioma).toBeNull();

    trabalhador.concluirUltimo("ok");
    void transcrever(audio(), { origem: "escuta", idioma: "en" });
    await esvaziar();
    expect(trabalhador.pedidos[2]?.idioma).toBe("en");
  });

  it("devolve os segmentos com tempos, o idioma detectado e a duração da passada", async () => {
    const { trabalhador, passada } = montar();
    const resultado = passada(audio(), { origem: "escuta", idioma: "automatico" });
    const segmentos: SegmentoTranscrito[] = [
      { texto: "Hello there.", inicioS: 0, fimS: 1.2 },
      { texto: "How are you?", inicioS: 1.2, fimS: 2.5 },
    ];
    trabalhador.concluirUltimo("Hello there. How are you?", segmentos, "en");
    const esperado: ResultadoDaTranscricao = {
      texto: "Hello there. How are you?",
      segmentos,
      idioma: "en",
      duracaoDaPassadaMs: 12,
    };
    await expect(resultado).resolves.toEqual(esperado);
  });

  it("o áudio só é transferido ao worker quando o pedido começa (na fila, ainda é de quem pediu)", async () => {
    const { trabalhador, transcrever } = montar();
    const primeiro = audio(1);
    const segundo = audio(2);
    const p1 = transcrever(primeiro);
    void transcrever(segundo);
    expect(trabalhador.transferidos).toHaveLength(1);
    expect(trabalhador.transferidos[0]?.[0]).toBe(primeiro.buffer);
    trabalhador.concluirUltimo("1");
    await p1;
    expect(trabalhador.transferidos).toHaveLength(2);
    expect(trabalhador.transferidos[1]?.[0]).toBe(segundo.buffer);
  });

  it("o modelo vai pela origem: ditado com whisper-small, escuta com whisper-base", async () => {
    const { trabalhador, transcrever } = montar();
    const ditado = transcrever(audio(1));
    const escuta = transcrever(audio(2), { origem: "escuta" });
    expect(trabalhador.pedidos[0]?.modelo).toBe(MODELO_DO_DITADO);
    expect(MODELO_DO_DITADO).toBe("onnx-community/whisper-small");
    trabalhador.concluirUltimo("d");
    await ditado;
    expect(trabalhador.pedidos[1]?.modelo).toBe(MODELO_DA_ESCUTA);
    expect(MODELO_DA_ESCUTA).toBe("onnx-community/whisper-base");
    trabalhador.concluirUltimo("e");
    await escuta;
  });

  it("a descartável só entra com a fila vazia: havendo pedido esperando, é descartada sem enfileirar", async () => {
    const { trabalhador, transcrever } = montar();
    const final1 = transcrever(audio(1), { origem: "escuta" });
    const descartavel1 = transcrever(audio(2), { origem: "escuta", descartavel: true });
    // Há um pedido em andamento, mas a fila está vazia: a descartável espera.
    const descartavel2 = transcrever(audio(3), { origem: "escuta", descartavel: true });
    await expect(descartavel2).rejects.toBeInstanceOf(TranscricaoDescartada);

    trabalhador.concluirUltimo("1");
    await expect(final1).resolves.toBe("1");
    expect(trabalhador.pedidos[1]?.audio[0]).toBe(2);
    trabalhador.concluirUltimo("p");
    await expect(descartavel1).resolves.toBe("p");
  });

  it("um trecho final descarta a descartável que esperava e nunca é descartado por ela", async () => {
    const { trabalhador, transcrever } = montar();
    const emAndamento = transcrever(audio(1), { origem: "escuta" });
    const descartavel = transcrever(audio(2), { origem: "escuta", descartavel: true });
    const final1 = transcrever(audio(3), { origem: "escuta" });
    const final2 = transcrever(audio(4), { origem: "escuta" });
    await expect(descartavel).rejects.toBeInstanceOf(TranscricaoDescartada);

    // Os dois finais esperando cabem no limite: nada foi descartado por causa da descartável.
    trabalhador.concluirUltimo("0");
    await expect(emAndamento).resolves.toBe("0");
    trabalhador.concluirUltimo("1");
    await expect(final1).resolves.toBe("1");
    trabalhador.concluirUltimo("2");
    await expect(final2).resolves.toBe("2");
  });

  it("o ditado nunca é descartável, mesmo pedindo", async () => {
    const { trabalhador, transcrever } = montar();
    const primeiro = transcrever(audio(1));
    const segundo = transcrever(audio(2), { origem: "ditado", descartavel: true });
    const terceiro = transcrever(audio(3), { origem: "ditado", descartavel: true });
    trabalhador.concluirUltimo("1");
    await expect(primeiro).resolves.toBe("1");
    trabalhador.concluirUltimo("2");
    await expect(segundo).resolves.toBe("2");
    trabalhador.concluirUltimo("3");
    await expect(terceiro).resolves.toBe("3");
  });

  it("o ditado passa na frente dos pedidos da escuta que ainda não começaram", async () => {
    const { trabalhador, transcrever } = montar();
    const escuta1 = transcrever(audio(1), { origem: "escuta", idioma: "automatico" });
    const escuta2 = transcrever(audio(2), { origem: "escuta", idioma: "automatico" });
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
    void transcrever(audio(1), { origem: "escuta" });
    void transcrever(audio(2), { origem: "escuta" });
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
    const emAndamento = transcrever(audio(1), { origem: "escuta" });
    const esperando1 = transcrever(audio(2), { origem: "escuta" });
    const esperando2 = transcrever(audio(3), { origem: "escuta" });
    const esperando3 = transcrever(audio(4), { origem: "escuta" });

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
    const e1 = transcrever(audio(2), { origem: "escuta" });
    const e2 = transcrever(audio(3), { origem: "escuta" });
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

  it("se o worker não sobe, todos os pedidos (em andamento, na fila e preparos) são rejeitados", async () => {
    const { trabalhador, motor, transcrever } = montar();
    const a = transcrever(audio(1));
    const b = transcrever(audio(2), { origem: "escuta" });
    const preparo = motor.preparar("escuta");
    trabalhador.onerror?.({ message: "script não carregou" } as ErrorEvent);
    await expect(a).rejects.toThrow("script não carregou");
    await expect(b).rejects.toThrow("script não carregou");
    await expect(preparo).rejects.toThrow("script não carregou");
    expect(trabalhador.encerrado).toBe(true);
  });

  it("o progresso do download chega por origem, com o total em MB, e termina com null", async () => {
    const { trabalhador, motor, transcrever } = montar();
    const avisos: [string, unknown][] = [];
    motor.aoBaixar((origem, progresso) => avisos.push([origem, progresso]));
    const pedido = transcrever(audio());
    trabalhador.responder({ tipo: "baixando", modelo: MODELO_DO_DITADO, progresso: 40, totalMb: 243.5 });
    trabalhador.responder({ tipo: "baixando", modelo: MODELO_DA_ESCUTA, progresso: 10, totalMb: null });
    trabalhador.concluirUltimo("ok");
    await pedido;
    expect(avisos).toEqual([
      ["ditado", { progresso: 40, totalMb: 243.5 }],
      ["escuta", { progresso: 10, totalMb: null }],
      ["ditado", null],
    ]);
  });

  it("preparar carrega o modelo da origem, informa o motor (wasm, não nativo) e resolve no 'pronto'", async () => {
    const { trabalhador, motor } = montar();
    const mudancas: unknown[] = [];
    motor.aoMudarMotor((origem, descricao) => mudancas.push([origem, descricao]));
    expect(motor.motorAtual("escuta")).toBeNull();

    const preparo = motor.preparar("escuta");
    const mensagem = trabalhador.mensagens[0];
    expect(mensagem).toMatchObject({ tipo: "preparar", modelo: MODELO_DA_ESCUTA });
    const esperado = { dispositivo: "wasm", modelo: MODELO_DA_ESCUTA, precisao: "q8", nativo: false };
    expect(mudancas).toEqual([["escuta", esperado]]);

    trabalhador.responder({ tipo: "pronto", id: mensagem?.id ?? -1 });
    await expect(preparo).resolves.toEqual(esperado);
    expect(motor.motorAtual("escuta")).toEqual(esperado);
    expect(motor.motorAtual("ditado")).toBeNull();
  });
});

describe("mensagens do worker", () => {
  it("o idioma devolvido é sempre um código: 'portuguese' vira 'pt', um detectado fica como veio", () => {
    expect(codigoDoIdioma("portuguese")).toBe("pt");
    expect(codigoDoIdioma("en")).toBe("en");
  });

  it("os segmentos saem dos trechos com tempo; sem fim, vão até o fim do áudio; vazios saem", () => {
    expect(
      segmentosDaSaida(
        [
          { text: " Olá. ", timestamp: [0, 1.5] },
          { text: "  ", timestamp: [1.5, 2] },
          { text: " Tudo bem?", timestamp: [2, null] },
        ],
        3.2,
      ),
    ).toEqual([
      { texto: "Olá.", inicioS: 0, fimS: 1.5 },
      { texto: "Tudo bem?", inicioS: 2, fimS: 3.2 },
    ]);
  });

  it("o total do download vai em MB, com uma casa; sem total, null", () => {
    expect(emMegabytes(255_852_544)).toBe(244);
    expect(emMegabytes(1_572_864)).toBe(1.5);
    expect(emMegabytes(0)).toBeNull();
    expect(emMegabytes(undefined)).toBeNull();
  });
});

describe("transcritor · descarga do modelo ocioso", () => {
  /** Um worker novo a cada criação, para ver o encerramento e a recriação. */
  function montarComRecriacao() {
    const criados: TrabalhadorFalso[] = [];
    const motor = criarTranscritor(() => {
      const novo = new TrabalhadorFalso();
      criados.push(novo);
      return novo;
    });
    const transcrever = (amostras: Float32Array, opcoes: OpcoesDaPassada = { origem: "ditado" }) =>
      motor.transcrever(amostras, opcoes).then((resultado) => resultado.texto);
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

    const emAndamento = transcrever(audio(1), { origem: "escuta" });
    const esperando = transcrever(audio(2), { origem: "escuta" });
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
