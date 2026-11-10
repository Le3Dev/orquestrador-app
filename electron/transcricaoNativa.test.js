"use strict";

import { describe, expect, it, vi } from "vitest";

const { EventEmitter } = require("node:events");
const path = require("node:path");
const {
  ARGUMENTO_DA_TRANSCRICAO_NATIVA,
  binarioDoOnnxDisponivel,
  caminhoDoBinarioDoOnnx,
  criarTranscricaoNativa,
} = require("./transcricaoNativa");

// ── Falsos do Electron ────────────────────────────────────────────────────
class PortaFalsa extends EventEmitter {
  constructor() {
    super();
    this.par = null;
    this.iniciada = false;
    this.fechada = false;
    this.fila = [];
  }
  postMessage(dados) {
    if (this.fechada || !this.par || this.par.fechada) return;
    this.par.receber(dados);
  }
  receber(dados) {
    if (this.iniciada) this.emit("message", { data: dados });
    else this.fila.push(dados);
  }
  start() {
    this.iniciada = true;
    for (const dados of this.fila.splice(0)) this.emit("message", { data: dados });
  }
  close() {
    if (this.fechada) return;
    this.fechada = true;
    if (this.par && !this.par.fechada) {
      this.par.fechada = true;
      this.par.emit("close");
    }
  }
}

class CanalFalso {
  constructor() {
    this.port1 = new PortaFalsa();
    this.port2 = new PortaFalsa();
    this.port1.par = this.port2;
    this.port2.par = this.port1;
  }
}

function utilitarioFalso() {
  const filhos = [];
  const utilityProcess = {
    fork: vi.fn((caminho, argumentos, opcoes) => {
      const filho = new EventEmitter();
      filho.pid = 100 + filhos.length;
      filho.opcoes = opcoes;
      filho.recebidas = []; // pelo parentPort
      filho.daTela = []; // pela porta
      filho.porta = null;
      filho.postMessage = vi.fn((mensagem, transferir = []) => {
        filho.recebidas.push(mensagem);
        if (mensagem.tipo === "porta") {
          filho.porta = transferir[0];
          filho.porta.on("message", (evento) => filho.daTela.push(evento.data));
          filho.porta.start();
        }
      });
      filho.kill = vi.fn(() => {
        queueMicrotask(() => filho.emit("exit", 0));
        return true;
      });
      filho.subir = () => filho.emit("spawn");
      filho.cair = (codigo = 1) => filho.emit("exit", codigo);
      filho.responder = (dados) => filho.porta.postMessage(dados);
      filho.paraOPrincipal = (mensagem) => filho.emit("message", mensagem);
      filhos.push(filho);
      return filho;
    }),
  };
  return { utilityProcess, filhos };
}

const FRAME_PRINCIPAL = { processId: 4, routingId: 1 };

function janelaFalsa() {
  const daTela = []; // mensagens que chegam à tela
  const portas = [];
  const webContents = {
    isDestroyed: () => false,
    mainFrame: FRAME_PRINCIPAL,
    postMessage: vi.fn((canal, _mensagem, transferir) => {
      if (canal !== "transcricao:porta") return;
      const porta = transferir[0];
      porta.fechou = false;
      porta.on("message", (evento) => daTela.push(evento.data));
      porta.on("close", () => {
        porta.fechou = true;
      });
      porta.start();
      portas.push(porta);
    }),
  };
  return { janela: { isDestroyed: () => false, webContents }, daTela, portas };
}

function montar({ disponivel = true, baixarModelo = vi.fn(async () => ({ baixados: [] })) } = {}) {
  const { utilityProcess, filhos } = utilitarioFalso();
  const registrar = vi.fn();
  const motor = criarTranscricaoNativa({
    utilityProcess,
    MessageChannelMain: CanalFalso,
    caminhoDoTranscritor: "C:/app/electron/transcritorNativo.js",
    pastaDosModelos: "C:/dados/modelos-da-transcricao",
    pastaDeTrabalho: "C:/dados",
    disponivel,
    baixarModelo,
    registrar,
    ambiente: { PATH: "x" },
  });
  const tela = janelaFalsa();
  const conectar = (frame = FRAME_PRINCIPAL) => motor.conectar({ senderFrame: frame }, tela.janela);
  const portaDaTela = () => tela.portas.at(-1);
  return { motor, filhos, utilityProcess, registrar, tela, conectar, portaDaTela, baixarModelo };
}

describe("binário do onnxruntime-node", () => {
  it("monta o caminho do binding N-API por plataforma e arquitetura", () => {
    const resolver = () => path.join("C:", "app", "node_modules", "onnxruntime-node", "package.json");
    expect(caminhoDoBinarioDoOnnx({ plataforma: "win32", arquitetura: "x64", resolver })).toBe(
      path.join("C:", "app", "node_modules", "onnxruntime-node", "bin", "napi-v6", "win32", "x64", "onnxruntime_binding.node"),
    );
    expect(
      caminhoDoBinarioDoOnnx({
        resolver: () => {
          throw new Error("sem pacote");
        },
      }),
    ).toBeNull();
    expect(binarioDoOnnxDisponivel({ resolver }, () => true)).toBe(true);
    expect(binarioDoOnnxDisponivel({ resolver }, () => false)).toBe(false);
    expect(ARGUMENTO_DA_TRANSCRICAO_NATIVA).toBe("--transcricao-nativa-disponivel");
  });
});

describe("transcricao:conectar", () => {
  it("recusa quem não é o frame principal da janela principal", () => {
    const { conectar, tela, registrar } = montar();
    expect(() => conectar({ processId: 4, routingId: 9 })).toThrow(/frame principal/);
    expect(() => conectar(null)).toThrow(/frame principal/);
    expect(tela.janela.webContents.postMessage).not.toHaveBeenCalled();
    expect(registrar).toHaveBeenCalledWith(expect.stringContaining("recusado"));
  });

  it("entrega a porta à tela sem subir o utilitário", () => {
    const { conectar, tela, utilityProcess, motor } = montar();
    conectar();
    expect(tela.janela.webContents.postMessage).toHaveBeenCalledWith("transcricao:porta", null, [expect.any(PortaFalsa)]);
    expect(utilityProcess.fork).not.toHaveBeenCalled();
    expect(motor.estado.conectada).toBe(true);
  });

  it("recusa sem o binário do onnxruntime-node", () => {
    const { conectar } = montar({ disponivel: false });
    expect(() => conectar()).toThrow(/não está disponível/);
  });

  it("uma conexão nova fecha a porta anterior", () => {
    const { conectar, tela } = montar();
    conectar();
    const primeira = tela.portas[0];
    conectar();
    expect(primeira.fechou).toBe(true);
    expect(tela.portas[1].fechou).toBe(false);
  });
});

describe("repasse entre a tela e o utilitário", () => {
  it("sobe o utilitário no primeiro pedido, com a prioridade da escuta junto da porta", () => {
    const { conectar, portaDaTela, filhos, utilityProcess } = montar();
    conectar();
    portaDaTela().postMessage({ tipo: "preparar", origem: "escuta", prioridade: "precisao" });
    expect(utilityProcess.fork).toHaveBeenCalledTimes(1);
    const [caminho, , opcoes] = utilityProcess.fork.mock.calls[0];
    expect(caminho).toBe("C:/app/electron/transcritorNativo.js");
    expect(opcoes).toMatchObject({ cwd: "C:/dados", env: { PATH: "x", ORQUESTRADOR_PASTA_DOS_MODELOS: "C:/dados/modelos-da-transcricao" } });
    const filho = filhos[0];
    filho.subir();
    expect(filho.recebidas[0]).toEqual({ tipo: "porta", prioridadeDaEscuta: "precisao" });
    // O que foi postado antes do "spawn" esperou na porta.
    expect(filho.daTela).toEqual([{ tipo: "preparar", origem: "escuta", prioridade: "precisao" }]);
  });

  it("ignora descarregar sem utilitário no ar", () => {
    const { conectar, portaDaTela, utilityProcess } = montar();
    conectar();
    portaDaTela().postMessage({ tipo: "descarregar" });
    expect(utilityProcess.fork).not.toHaveBeenCalled();
  });

  it("troca o id de transcrever por um interno e desfaz na volta", () => {
    const { conectar, portaDaTela, filhos, tela } = montar();
    conectar();
    const audio = new Float32Array([0.1, 0.2]);
    portaDaTela().postMessage({ tipo: "transcrever", id: 7, origem: "ditado", audio, idioma: "portuguese", descartavel: false });
    const filho = filhos[0];
    filho.subir();
    const pedido = filho.daTela[0];
    expect(pedido).toMatchObject({ tipo: "transcrever", origem: "ditado", audio, idioma: "portuguese", descartavel: false });
    filho.responder({ tipo: "motor", origem: "ditado", motor: { dispositivo: "cpu", modelo: "onnx-community/whisper-small", precisao: "fp32", nativo: true } });
    filho.responder({ tipo: "resultado", id: pedido.id, texto: "olá", segmentos: [], idioma: "pt", duracaoDaPassadaMs: 120 });
    expect(tela.daTela).toEqual([
      { tipo: "motor", origem: "ditado", motor: { dispositivo: "cpu", modelo: "onnx-community/whisper-small", precisao: "fp32", nativo: true } },
      { tipo: "resultado", id: 7, texto: "olá", segmentos: [], idioma: "pt", duracaoDaPassadaMs: 120 },
    ]);
  });

  it("a resposta de uma porta antiga não chega à porta nova", () => {
    const { conectar, portaDaTela, filhos, tela } = montar();
    conectar();
    portaDaTela().postMessage({ tipo: "transcrever", id: 1, origem: "escuta", audio: new Float32Array(1), idioma: "pt", descartavel: false });
    const filho = filhos[0];
    filho.subir();
    const antigo = filho.daTela[0].id;
    conectar(); // tela recarregada
    portaDaTela().postMessage({ tipo: "transcrever", id: 1, origem: "escuta", audio: new Float32Array(1), idioma: "pt", descartavel: false });
    const novo = filho.daTela[1].id;
    expect(novo).not.toBe(antigo);
    filho.responder({ tipo: "resultado", id: antigo, texto: "velho", segmentos: [], idioma: "pt", duracaoDaPassadaMs: 1 });
    filho.responder({ tipo: "erro", id: novo, mensagem: "falhou" });
    expect(tela.daTela).toEqual([{ tipo: "erro", id: 1, mensagem: "falhou" }]);
  });

  it("repassa o erro descartado com o id da tela", () => {
    const { conectar, portaDaTela, filhos, tela } = montar();
    conectar();
    portaDaTela().postMessage({ tipo: "transcrever", id: 3, origem: "escuta", audio: new Float32Array(1), idioma: "pt", descartavel: true });
    const filho = filhos[0];
    filho.subir();
    filho.responder({ tipo: "erro", id: filho.daTela[0].id, mensagem: "Motor ocupado; trecho descartado.", descartado: true });
    expect(tela.daTela).toEqual([{ tipo: "erro", id: 3, mensagem: "Motor ocupado; trecho descartado.", descartado: true }]);
  });
});

describe("ociosidade, quedas e religamento", () => {
  async function prepararUmFilho(m) {
    m.conectar();
    m.portaDaTela().postMessage({ tipo: "preparar", origem: "escuta", prioridade: "velocidade" });
    const filho = m.filhos.at(-1);
    filho.subir();
    return filho;
  }

  it("ocioso sem nada a caminho: encerra o utilitário sem fechar a porta da tela; o próximo pedido sobe outro", async () => {
    const m = montar();
    const filho = await prepararUmFilho(m);
    filho.paraOPrincipal({ tipo: "pronto", origem: "escuta", motor: {} });
    filho.paraOPrincipal({ tipo: "ocioso", recebidas: 1 });
    expect(filho.kill).toHaveBeenCalled();
    await Promise.resolve();
    expect(m.portaDaTela().fechou).toBe(false);
    expect(m.motor.estado).toMatchObject({ filho: false, quedasSeguidas: 0, desistiu: false });

    m.portaDaTela().postMessage({ tipo: "transcrever", id: 1, origem: "escuta", audio: new Float32Array(1), idioma: "pt", descartavel: false });
    expect(m.utilityProcess.fork).toHaveBeenCalledTimes(2);
  });

  it("ocioso com mensagem a caminho: não encerra", async () => {
    const m = montar();
    const filho = await prepararUmFilho(m);
    m.portaDaTela().postMessage({ tipo: "transcrever", id: 1, origem: "escuta", audio: new Float32Array(1), idioma: "pt", descartavel: false });
    filho.paraOPrincipal({ tipo: "ocioso", recebidas: 1 }); // mandou 2
    expect(filho.kill).not.toHaveBeenCalled();
  });

  it("queda: fecha a porta da tela para ela reconectar; a segunda seguida desiste", async () => {
    const m = montar();
    const primeiro = await prepararUmFilho(m);
    primeiro.cair(3);
    expect(m.portaDaTela().fechou).toBe(true);
    expect(m.motor.estado).toMatchObject({ quedasSeguidas: 1, desistiu: false, conectada: false });

    const segundo = await prepararUmFilho(m); // a tela reconecta e repete o preparo
    expect(m.utilityProcess.fork).toHaveBeenCalledTimes(2);
    segundo.cair(3);
    expect(m.portaDaTela().fechou).toBe(true);
    expect(m.motor.estado).toMatchObject({ quedasSeguidas: 2, desistiu: true });
    expect(() => m.conectar()).toThrow(/cair duas vezes/);
    expect(m.registrar).toHaveBeenCalledWith(expect.stringContaining("Parei de religar"));
  });

  it('um "pronto" entre as quedas zera a contagem', async () => {
    const m = montar();
    (await prepararUmFilho(m)).cair();
    const segundo = await prepararUmFilho(m);
    segundo.paraOPrincipal({ tipo: "pronto", origem: "escuta", motor: {} });
    segundo.cair();
    expect(m.motor.estado).toMatchObject({ quedasSeguidas: 1, desistiu: false });
    expect(() => m.conectar()).not.toThrow();
  });

  it("encerrar (app fechando) mata o utilitário sem contar queda", async () => {
    const m = montar();
    const filho = await prepararUmFilho(m);
    m.motor.encerrar();
    expect(filho.kill).toHaveBeenCalled();
    await Promise.resolve();
    expect(m.motor.estado).toMatchObject({ quedasSeguidas: 0, fechando: true });
    expect(() => m.conectar()).toThrow(/fechando/);
  });
});

describe("pedidos de modelo do utilitário", () => {
  it("baixa pelo principal e devolve progresso e pronto", async () => {
    const baixarModelo = vi.fn(async ({ aoProgredir }) => {
      aoProgredir({ progresso: 0, totalMb: 139.5 });
      aoProgredir({ progresso: 100, totalMb: 139.5 });
      return { baixados: ["onnx/encoder_model.onnx"] };
    });
    const m = montar({ baixarModelo });
    m.conectar();
    m.portaDaTela().postMessage({ tipo: "preparar", origem: "escuta", prioridade: "velocidade" });
    const filho = m.filhos[0];
    filho.subir();
    filho.paraOPrincipal({ tipo: "modelo", pedido: 5, repositorio: "onnx-community/whisper-base", precisao: "fp16", dispositivo: "webgpu" });
    await vi.waitFor(() => expect(filho.recebidas.at(-1)).toEqual({ tipo: "modelo:pronto", pedido: 5 }));
    expect(baixarModelo).toHaveBeenCalledWith(
      expect.objectContaining({
        repositorio: "onnx-community/whisper-base",
        precisao: "fp16",
        dispositivo: "webgpu",
        pasta: "C:/dados/modelos-da-transcricao",
      }),
    );
    expect(filho.recebidas).toContainEqual({ tipo: "modelo:progresso", pedido: 5, progresso: 0, totalMb: 139.5 });
    expect(m.registrar).toHaveBeenCalledWith(expect.stringContaining("139.5 MB"));
  });

  it("devolve modelo:erro quando o download falha", async () => {
    const m = montar({ baixarModelo: vi.fn(async () => Promise.reject(new Error("HTTP 503"))) });
    m.conectar();
    m.portaDaTela().postMessage({ tipo: "preparar", origem: "ditado", prioridade: "precisao" });
    const filho = m.filhos[0];
    filho.subir();
    filho.paraOPrincipal({ tipo: "modelo", pedido: 1, repositorio: "onnx-community/whisper-small", precisao: "fp32", dispositivo: "cpu" });
    await vi.waitFor(() => expect(filho.recebidas.at(-1)).toMatchObject({ tipo: "modelo:erro", pedido: 1 }));
    expect(filho.recebidas.at(-1).mensagem).toContain("HTTP 503");
  });
});
