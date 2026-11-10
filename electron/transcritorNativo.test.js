"use strict";

import { afterEach, describe, expect, it, vi } from "vitest";

const {
  LIMITE_DA_PRIORIDADE_MS,
  OCIOSIDADE_MS,
  criarFila,
  dispositivosDaPlataforma,
  escolherModeloDaEscuta,
  escolherMotorDoDitado,
  idiomaDoPedido,
  iniciarMotor,
  lerTokensDeIdioma,
  mediana,
  paraAudio,
  precisoesDoDispositivo,
  segmentosDaSaida,
} = require("./transcritorNativo");

describe("dispositivos e precisões", () => {
  it("tenta webgpu, dml e cpu no Windows; webgpu e cpu no macOS", () => {
    expect(dispositivosDaPlataforma("win32")).toEqual(["webgpu", "dml", "cpu"]);
    expect(dispositivosDaPlataforma("darwin")).toEqual(["webgpu", "cpu"]);
    expect(dispositivosDaPlataforma("linux")).toEqual(["cpu"]);
  });

  it("usa fp16 no WebGPU, fp32 no DML e fp32 com q8 de reserva na CPU", () => {
    expect(precisoesDoDispositivo("webgpu")).toEqual(["fp16"]);
    expect(precisoesDoDispositivo("dml")).toEqual(["fp32"]);
    expect(precisoesDoDispositivo("cpu", "base")).toEqual(["fp32", "q8"]);
    expect(precisoesDoDispositivo("cpu", "small")).toEqual(["fp32", "q8"]);
    expect(precisoesDoDispositivo("cpu", "turbo")).toEqual(["q8"]);
    expect(precisoesDoDispositivo("webgpu", "turbo")).toEqual(["fp16"]);
  });
});

describe("escolha do modelo da escuta por B", () => {
  it("velocidade (limite 1.000 ms): turbo se 7·B ≤ 1000, small se 2,9·B ≤ 1000, senão base", () => {
    expect(LIMITE_DA_PRIORIDADE_MS).toEqual({ velocidade: 1000, precisao: 2500 });
    expect(escolherModeloDaEscuta(142)).toBe("turbo"); // 994
    expect(escolherModeloDaEscuta(143)).toBe("small"); // 1001
    expect(escolherModeloDaEscuta(344, "velocidade")).toBe("small"); // 997,6
    expect(escolherModeloDaEscuta(345, "velocidade")).toBe("base"); // 1000,5
    expect(escolherModeloDaEscuta(2000, "velocidade")).toBe("base");
  });

  it("precisão (limite 2.500 ms)", () => {
    expect(escolherModeloDaEscuta(357, "precisao")).toBe("turbo"); // 2499
    expect(escolherModeloDaEscuta(358, "precisao")).toBe("small"); // 2506
    expect(escolherModeloDaEscuta(862, "precisao")).toBe("small"); // 2499,8
    expect(escolherModeloDaEscuta(863, "precisao")).toBe("base"); // 2502,7
  });

  it("prioridade desconhecida vira velocidade; B inválido fica no base", () => {
    expect(escolherModeloDaEscuta(300, "qualquer")).toBe("small");
    expect(escolherModeloDaEscuta(Number.NaN)).toBe("base");
    expect(escolherModeloDaEscuta(0)).toBe("base");
  });

  it("mediana das passadas", () => {
    expect(mediana([300, 100, 200])).toBe(200);
    expect(mediana([100, 400])).toBe(250);
    expect(mediana([])).toBeNaN();
  });
});

describe("motor do ditado", () => {
  it("nunca o base: reaproveita small ou turbo da escuta, senão small na CPU", () => {
    expect(escolherMotorDoDitado({ modelo: "turbo" })).toEqual({ reaproveitar: true });
    expect(escolherMotorDoDitado({ modelo: "small" })).toEqual({ reaproveitar: true });
    expect(escolherMotorDoDitado({ modelo: "base" })).toEqual({ reaproveitar: false, modelo: "small", dispositivo: "cpu" });
    expect(escolherMotorDoDitado(null)).toEqual({ reaproveitar: false, modelo: "small", dispositivo: "cpu" });
  });
});

describe("idioma", () => {
  it('"portuguese" e vazio viram pt; código é repassado; "automatico" detecta', () => {
    expect(idiomaDoPedido("portuguese")).toEqual({ detectar: false, language: "portuguese", codigo: "pt" });
    expect(idiomaDoPedido("")).toEqual({ detectar: false, language: "portuguese", codigo: "pt" });
    expect(idiomaDoPedido(undefined)).toEqual({ detectar: false, language: "portuguese", codigo: "pt" });
    expect(idiomaDoPedido("en")).toEqual({ detectar: false, language: "en", codigo: "en" });
    expect(idiomaDoPedido("automatico")).toEqual({ detectar: true });
  });

  it("lê os tokens de idioma do generation_config", () => {
    const tokens = lerTokensDeIdioma({ decoder_start_token_id: 50258, lang_to_id: { "<|en|>": 50259, "<|pt|>": 50267, ruim: 1 } });
    expect(tokens.inicio).toBe(50258);
    expect([...tokens.idiomas]).toEqual([
      [50259, "en"],
      [50267, "pt"],
    ]);
    expect(lerTokensDeIdioma({})).toBeNull();
  });
});

describe("saída do pipeline", () => {
  it("devolve texto e segmentos em segundos", () => {
    const saida = {
      text: " Olá mundo. Tudo bem?",
      chunks: [
        { text: " Olá mundo.", timestamp: [0, 1.234] },
        { text: " Tudo bem?", timestamp: [1.5, null] },
        { text: "  ", timestamp: [2, 3] },
      ],
    };
    expect(segmentosDaSaida(saida, 4)).toEqual({
      texto: "Olá mundo. Tudo bem?",
      segmentos: [
        { texto: "Olá mundo.", inicioS: 0, fimS: 1.23 },
        { texto: "Tudo bem?", inicioS: 1.5, fimS: 4 },
      ],
    });
  });

  it("aceita o áudio como Float32Array, buffer ou array", () => {
    const original = new Float32Array([0.1, -0.2]);
    expect(paraAudio(original)).toBe(original);
    expect(Array.from(paraAudio(original.buffer))).toEqual(Array.from(original));
    expect(paraAudio([0.5, 1]).length).toBe(2);
    expect(paraAudio("x")).toBeNull();
  });
});

// ── Fila ──────────────────────────────────────────────────────────────────
function itemControlado(origem, registro, extras = {}) {
  let terminar;
  const pronto = new Promise((resolver) => {
    terminar = resolver;
  });
  return {
    origem,
    ...extras,
    terminar: () => terminar(),
    executar: () => {
      registro.push(`${origem}:${extras.nome ?? ""}`);
      return pronto;
    },
  };
}

describe("fila serial", () => {
  it("o ditado passa na frente da escuta, mantendo a ordem dentro de cada origem", async () => {
    const ordem = [];
    const fila = criarFila();
    const primeiro = itemControlado("escuta", ordem, { nome: "1" });
    fila.adicionar(primeiro);
    const itens = [
      itemControlado("escuta", ordem, { nome: "2" }),
      itemControlado("escuta", ordem, { nome: "3" }),
      itemControlado("ditado", ordem, { nome: "a" }),
      itemControlado("ditado", ordem, { nome: "b" }),
    ];
    for (const item of itens) fila.adicionar(item);
    expect(fila.tamanho).toBe(5);
    primeiro.terminar();
    for (const item of [itens[2], itens[3], itens[0], itens[1]]) {
      await vi.waitFor(() => expect(ordem.at(-1)).toBe(`${item.origem}:${item.nome ?? ""}`));
      item.terminar();
    }
    expect(ordem).toEqual(["escuta:1", "ditado:a", "ditado:b", "escuta:2", "escuta:3"]);
  });

  it("o descartável só entra com a fila vazia e nada em andamento", async () => {
    const aoFicarOciosa = vi.fn();
    const fila = criarFila({ aoFicarOciosa });
    const registro = [];
    const andamento = itemControlado("ditado", registro);
    expect(fila.adicionar(andamento)).toBe(true);
    expect(fila.adicionar(itemControlado("escuta", registro, { descartavel: true }))).toBe(false);
    andamento.terminar();
    await vi.waitFor(() => expect(aoFicarOciosa).toHaveBeenCalled());
    expect(fila.ociosa()).toBe(true);
    const descartavel = itemControlado("escuta", registro, { descartavel: true });
    expect(fila.adicionar(descartavel)).toBe(true);
    descartavel.terminar();
  });

  it("descarta pendentes de uma porta que fechou", () => {
    const fila = criarFila();
    const registro = [];
    fila.adicionar(itemControlado("escuta", registro, { porta: "a" }));
    fila.adicionar(itemControlado("escuta", registro, { porta: "a" }));
    fila.adicionar(itemControlado("escuta", registro, { porta: "b" }));
    expect(fila.descartar((item) => item.porta === "a")).toHaveLength(1);
    expect(fila.tamanho).toBe(2);
  });
});

// ── Motor (com parentPort e porta falsos) ──────────────────────────────────
function montarMotor() {
  const doPrincipal = [];
  let aoMensagem = null;
  const parentPort = {
    postMessage: vi.fn((mensagem) => doPrincipal.push(mensagem)),
    on: (_evento, ouvinte) => {
      aoMensagem = ouvinte;
    },
  };
  const motor = iniciarMotor(parentPort, { pastaDosModelos: "C:/modelos", plataforma: "win32" });
  const paraATela = [];
  const ouvintes = {};
  const porta = {
    postMessage: vi.fn((mensagem) => paraATela.push(mensagem)),
    on: (evento, ouvinte) => {
      ouvintes[evento] = ouvinte;
    },
    start: vi.fn(),
  };
  aoMensagem({ data: { tipo: "porta", prioridadeDaEscuta: "precisao" }, ports: [porta] });
  const daTela = (dados) => ouvintes.message({ data: dados });
  return { motor, doPrincipal, paraATela, daTela, porta };
}

describe("motor no utilitário", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("responde erro com descartado: true quando o descartável chega com o motor ocupado", () => {
    const { doPrincipal, paraATela, daTela } = montarMotor();
    daTela({ tipo: "transcrever", id: 1, origem: "escuta", audio: new Float32Array(1600), idioma: "portuguese", descartavel: false });
    // O primeiro pedido prepara a escuta: pede o base ao principal e espera.
    expect(doPrincipal).toContainEqual(
      expect.objectContaining({ tipo: "modelo", repositorio: "onnx-community/whisper-base", precisao: "fp16", dispositivo: "webgpu" }),
    );
    daTela({ tipo: "transcrever", id: 2, origem: "escuta", audio: new Float32Array(1600), idioma: "portuguese", descartavel: true });
    expect(paraATela).toContainEqual({ tipo: "erro", id: 2, mensagem: "Motor ocupado; trecho descartado.", descartado: true });
  });

  it("repassa o progresso do download como baixando e o erro do download como erro do pedido", async () => {
    const { doPrincipal, paraATela, daTela, motor } = montarMotor();
    daTela({ tipo: "preparar", origem: "escuta", prioridade: "velocidade" });
    await vi.waitFor(() => expect(doPrincipal.some((m) => m.tipo === "modelo")).toBe(true));
    const { pedido } = doPrincipal.find((m) => m.tipo === "modelo");
    motor.aoMensagemDoPrincipal({ data: { tipo: "modelo:progresso", pedido, progresso: 40, totalMb: 139.5 } });
    expect(paraATela).toContainEqual({ tipo: "baixando", origem: "escuta", progresso: 40, totalMb: 139.5 });
    motor.aoMensagemDoPrincipal({ data: { tipo: "modelo:erro", pedido, mensagem: "sem rede" } });
    await vi.waitFor(() => expect(paraATela.some((m) => m.tipo === "erro")).toBe(true));
    expect(paraATela.find((m) => m.tipo === "erro")).toEqual({
      tipo: "erro",
      id: null,
      mensagem: expect.stringContaining("sem rede"),
    });
  });

  it("depois de 3 min parado avisa o principal com quantas mensagens recebeu", async () => {
    vi.useFakeTimers();
    const { doPrincipal, daTela } = montarMotor();
    daTela({ tipo: "descarregar" });
    await vi.advanceTimersByTimeAsync(0);
    expect(doPrincipal).toContainEqual({ tipo: "ocioso", recebidas: 1 });
    doPrincipal.length = 0;
    await vi.advanceTimersByTimeAsync(OCIOSIDADE_MS);
    expect(doPrincipal).toContainEqual({ tipo: "ocioso", recebidas: 1 });
  });
});
