import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TEMPO_PARA_DESCARREGAR_O_DITADO_MS, TranscricaoDescartada } from "./filaDeTranscricao";
import type { DescricaoDoMotor, OrigemDaTranscricao, ProgressoDoDownload, ResultadoDaTranscricao } from "./motor";
import {
  type ConexaoDaTranscricaoNativa,
  conexaoPelaJanela,
  criarMotorNativo,
  FalhaDoMotorNativo,
  lerMensagemDoUtilitario,
  MAXIMO_DE_QUEDAS_DO_MOTOR_NATIVO,
  type MensagemParaOUtilitario,
  type PortaDaTranscricao,
  TEMPO_PARA_RECEBER_A_PORTA_MS,
  TEMPO_PARA_TROCAR_A_PORTA_DESCARREGADA_MS,
  TIPO_DA_MENSAGEM_DA_PORTA,
} from "./motorNativo";

type PedidoAoUtilitario = Extract<MensagemParaOUtilitario, { tipo: "transcrever" }>;

function ehMensagem(valor: unknown): valor is MensagemParaOUtilitario {
  return typeof valor === "object" && valor !== null && "tipo" in valor;
}

/** A ponta da tela de uma `MessagePort` falsa: guarda o que a tela manda e simula o utilitário. */
class PortaFalsa implements PortaDaTranscricao {
  onmessage: ((evento: MessageEvent) => void) | null = null;
  readonly enviadas: MensagemParaOUtilitario[] = [];
  readonly transferidos: Transferable[][] = [];
  fechada = false;
  private readonly ouvintesDoFechamento: (() => void)[] = [];

  postMessage(mensagem: unknown, transferir: Transferable[]): void {
    if (!ehMensagem(mensagem)) throw new Error("mensagem fora do protocolo");
    this.enviadas.push(mensagem);
    this.transferidos.push(transferir);
  }

  addEventListener(_tipo: "close", ouvinte: () => void): void {
    this.ouvintesDoFechamento.push(ouvinte);
  }

  close(): void {
    this.fechada = true;
  }

  get tipos(): string[] {
    return this.enviadas.map((mensagem) => mensagem.tipo);
  }

  get pedidos(): PedidoAoUtilitario[] {
    return this.enviadas.filter((mensagem): mensagem is PedidoAoUtilitario => mensagem.tipo === "transcrever");
  }

  /** O utilitário manda uma mensagem à tela. */
  responder(dados: unknown): void {
    this.onmessage?.({ data: dados } as MessageEvent);
  }

  /** Conclui o último pedido de transcrição com um texto. */
  concluirUltimo(texto: string): void {
    const ultimo = this.pedidos.at(-1);
    if (ultimo === undefined) throw new Error("nenhum pedido para concluir");
    this.responder({ tipo: "resultado", id: ultimo.id, texto, segmentos: [], idioma: "pt", duracaoDaPassadaMs: 5 });
  }

  /** O outro lado fechou (o utilitário caiu ou foi encerrado). */
  cair(): void {
    for (const ouvinte of this.ouvintesDoFechamento) ouvinte();
  }
}

/** A conexão falsa: `conectar()` entrega uma porta nova (como o app, pelo `message`). */
class ConexaoFalsa implements ConexaoDaTranscricaoNativa {
  conexoes = 0;
  entregarAoConectar = true;
  erroAoConectar: Error | null = null;
  readonly portas: PortaFalsa[] = [];
  private readonly ouvintes = new Set<(porta: PortaDaTranscricao) => void>();

  conectar(): Promise<void> {
    this.conexoes++;
    if (this.erroAoConectar !== null) return Promise.reject(this.erroAoConectar);
    if (this.entregarAoConectar) queueMicrotask(() => this.entregar());
    return Promise.resolve();
  }

  aoReceberPorta(ouvinte: (porta: PortaDaTranscricao) => void): () => void {
    this.ouvintes.add(ouvinte);
    return () => this.ouvintes.delete(ouvinte);
  }

  /** O app entrega uma porta (pedida ou não, como depois de religar o utilitário). */
  entregar(): PortaFalsa {
    const porta = new PortaFalsa();
    this.portas.push(porta);
    for (const ouvinte of this.ouvintes) ouvinte(porta);
    return porta;
  }

  get porta(): PortaFalsa {
    const atual = this.portas.at(-1);
    if (atual === undefined) throw new Error("nenhuma porta entregue");
    return atual;
  }
}

/** Deixa rodar as microtarefas (o `conectar` e a entrega da porta). */
async function microtarefas(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

function montar() {
  const conexao = new ConexaoFalsa();
  const motor = criarMotorNativo(conexao);
  const falhas: FalhaDoMotorNativo[] = [];
  motor.aoFalhar((erro) => falhas.push(erro));
  return { conexao, motor, falhas };
}

const audio = (valor = 0) => new Float32Array([valor, valor, valor]);

const MOTOR_DML: DescricaoDoMotor = {
  dispositivo: "dml",
  modelo: "onnx-community/whisper-large-v3-turbo",
  precisao: "fp16",
  nativo: true,
};

describe("motor nativo (a porta para o utilitário)", () => {
  it("preparar conecta no primeiro uso, manda a prioridade, informa motor e download, e resolve no 'pronto'", async () => {
    const { conexao, motor } = montar();
    const motores: [OrigemDaTranscricao, DescricaoDoMotor | null][] = [];
    const downloads: [OrigemDaTranscricao, ProgressoDoDownload | null][] = [];
    motor.aoMudarMotor((origem, descricao) => motores.push([origem, descricao]));
    motor.aoBaixar((origem, progresso) => downloads.push([origem, progresso]));
    expect(conexao.conexoes).toBe(0);

    const preparo = motor.preparar("escuta");
    await microtarefas();
    expect(conexao.conexoes).toBe(1);
    // Sem prioridade, a escuta pede velocidade.
    expect(conexao.porta.enviadas).toEqual([{ tipo: "preparar", origem: "escuta", prioridade: "velocidade" }]);

    conexao.porta.responder({ tipo: "baixando", origem: "escuta", progresso: 30, totalMb: 1550.2 });
    conexao.porta.responder({ tipo: "motor", origem: "escuta", motor: { ...MOTOR_DML, nativo: false } });
    conexao.porta.responder({ tipo: "pronto", origem: "escuta" });

    await expect(preparo).resolves.toEqual(MOTOR_DML);
    expect(motor.motorAtual("escuta")).toEqual(MOTOR_DML);
    expect(motor.motorAtual("ditado")).toBeNull();
    // O utilitário é sempre nativo, diga o que disser.
    expect(motores).toEqual([["escuta", MOTOR_DML]]);
    expect(downloads).toEqual([
      ["escuta", { progresso: 30, totalMb: 1550.2 }],
      ["escuta", null],
    ]);
  });

  it("preparar o ditado pede precisão; uma prioridade dada vai como veio", async () => {
    const { conexao, motor } = montar();
    void motor.preparar("ditado");
    await microtarefas();
    void motor.preparar("escuta", "precisao");
    expect(conexao.porta.enviadas).toEqual([
      { tipo: "preparar", origem: "ditado", prioridade: "precisao" },
      { tipo: "preparar", origem: "escuta", prioridade: "precisao" },
    ]);
  });

  it("transcrever manda o áudio sem transferir o buffer e devolve o resultado com segmentos e idioma", async () => {
    const { conexao, motor } = montar();
    const original = audio(7);
    const resultado = motor.transcrever(original, { origem: "escuta", idioma: "automatico" });
    await microtarefas();

    const [pedido] = conexao.porta.pedidos;
    expect(pedido).toMatchObject({ tipo: "transcrever", origem: "escuta", idioma: "automatico", descartavel: false });
    expect(Array.from(pedido?.audio ?? [])).toEqual([7, 7, 7]);
    // Com um ArrayBuffer na lista de transferência, o Electron entrega `null` ao processo principal
    // (MessagePortMain) e o pedido some: a lista vai vazia, e o áudio de quem pediu segue intacto.
    expect(conexao.porta.transferidos.at(-1)).toEqual([]);
    expect(original.byteLength).toBe(12);
    expect(original[0]).toBe(7);

    const esperado: ResultadoDaTranscricao = {
      texto: "Hello there.",
      segmentos: [{ texto: "Hello there.", inicioS: 0, fimS: 1.4 }],
      idioma: "en",
      duracaoDaPassadaMs: 320,
    };
    conexao.porta.responder({ tipo: "resultado", id: pedido?.id, ...esperado });
    await expect(resultado).resolves.toEqual(esperado);
  });

  it("idioma: português por padrão; o ditado nunca vai descartável", async () => {
    const { conexao, motor } = montar();
    void motor.transcrever(audio(), { origem: "ditado", descartavel: true });
    await microtarefas();
    expect(conexao.porta.pedidos[0]).toMatchObject({ origem: "ditado", idioma: "portuguese", descartavel: false });
  });

  it("um 'erro' com descartado vira TranscricaoDescartada", async () => {
    const { conexao, motor } = montar();
    const parcial = motor.transcrever(audio(), { origem: "escuta", descartavel: true });
    await microtarefas();
    const [pedido] = conexao.porta.pedidos;
    expect(pedido?.descartavel).toBe(true);
    conexao.porta.responder({ tipo: "erro", id: pedido?.id, mensagem: "Motor ocupado.", descartado: true });
    await expect(parcial).rejects.toBeInstanceOf(TranscricaoDescartada);
  });

  it("o erro de um pedido rejeita só ele, e a fila segue", async () => {
    const { conexao, motor, falhas } = montar();
    const falho = motor.transcrever(audio(1), { origem: "ditado" });
    const seguinte = motor.transcrever(audio(2), { origem: "ditado" });
    await microtarefas();
    expect(conexao.porta.pedidos).toHaveLength(1);
    conexao.porta.responder({ tipo: "erro", id: conexao.porta.pedidos[0]?.id, mensagem: "A transcrição falhou: x" });
    await expect(falho).rejects.toThrow("A transcrição falhou: x");
    await expect(falho).rejects.not.toBeInstanceOf(FalhaDoMotorNativo);
    conexao.porta.concluirUltimo("ok");
    await expect(seguinte).resolves.toMatchObject({ texto: "ok" });
    expect(falhas).toEqual([]);
  });

  it("um pedido por vez: o ditado passa na frente da escuta que ainda espera", async () => {
    const { conexao, motor } = montar();
    const escuta1 = motor.transcrever(audio(1), { origem: "escuta" });
    await microtarefas();
    const escuta2 = motor.transcrever(audio(2), { origem: "escuta" });
    const ditado = motor.transcrever(audio(3), { origem: "ditado" });
    const porta = conexao.porta;
    expect(porta.pedidos.map((pedido) => pedido.audio[0])).toEqual([1]);

    porta.concluirUltimo("e1");
    await expect(escuta1).resolves.toMatchObject({ texto: "e1" });
    expect(porta.pedidos.map((pedido) => pedido.audio[0])).toEqual([1, 3]);

    porta.concluirUltimo("d");
    await expect(ditado).resolves.toMatchObject({ texto: "d" });
    porta.concluirUltimo("e2");
    await expect(escuta2).resolves.toMatchObject({ texto: "e2" });
    expect(porta.pedidos.map((pedido) => pedido.audio[0])).toEqual([1, 3, 2]);
  });

  it("os pedidos que esperam a porta saem com o ditado na frente", async () => {
    const { conexao, motor } = montar();
    void motor.transcrever(audio(1), { origem: "escuta" });
    void motor.transcrever(audio(2), { origem: "ditado" });
    await microtarefas();
    expect(conexao.porta.pedidos.map((pedido) => pedido.audio[0])).toEqual([2]);
  });

  it("um 'erro' sem id com preparo esperando: o nativo desiste (FalhaDoMotorNativo) e avisa aoFalhar", async () => {
    const { conexao, motor, falhas } = montar();
    const preparo = motor.preparar("ditado");
    const pedido = motor.transcrever(audio(), { origem: "ditado" });
    await microtarefas();
    conexao.porta.responder({ tipo: "erro", id: null, mensagem: "Não foi possível preparar a transcrição: sem GPU" });
    await expect(preparo).rejects.toBeInstanceOf(FalhaDoMotorNativo);
    await expect(pedido).rejects.toBeInstanceOf(FalhaDoMotorNativo);
    expect(falhas).toHaveLength(1);
    expect(conexao.porta.fechada).toBe(true);
    // Desistiu de vez: novos pedidos falham na hora.
    await expect(motor.transcrever(audio(), { origem: "ditado" })).rejects.toBeInstanceOf(FalhaDoMotorNativo);
  });

  it("um 'erro' sem id e sem preparo esperando (aviso do app) é ignorado", async () => {
    const { conexao, motor, falhas } = montar();
    const pedido = motor.transcrever(audio(), { origem: "ditado" });
    await microtarefas();
    conexao.porta.responder({ tipo: "erro", id: null, mensagem: "O motor caiu e foi religado." });
    conexao.porta.concluirUltimo("ok");
    await expect(pedido).resolves.toMatchObject({ texto: "ok" });
    expect(falhas).toEqual([]);
  });

  it("o app avisa que desligou o motor ('indisponivel'): desiste na hora", async () => {
    const { conexao, motor, falhas } = montar();
    const pedido = motor.transcrever(audio(), { origem: "ditado" });
    await microtarefas();
    conexao.porta.responder({ tipo: "erro", id: null, mensagem: "caiu duas vezes", indisponivel: true });
    await expect(pedido).rejects.toBeInstanceOf(FalhaDoMotorNativo);
    expect(falhas).toHaveLength(1);
  });

  it("a porta que fecha no meio de um pedido: reconecta, prepara de novo a origem e reenvia o pedido", async () => {
    const { conexao, motor, falhas } = montar();
    const preparo = motor.preparar("escuta", "precisao");
    await microtarefas();
    conexao.porta.responder({ tipo: "motor", origem: "escuta", motor: MOTOR_DML });
    conexao.porta.responder({ tipo: "pronto", origem: "escuta" });
    await preparo;

    const pedido = motor.transcrever(audio(5), { origem: "escuta" });
    const primeira = conexao.porta;
    expect(primeira.pedidos).toHaveLength(1);
    primeira.cair();
    await microtarefas();

    expect(conexao.conexoes).toBe(2);
    const segunda = conexao.porta;
    expect(segunda).not.toBe(primeira);
    // O utilitário novo não sabe da prioridade: o preparo vai antes do pedido reenviado.
    expect(segunda.tipos).toEqual(["preparar", "transcrever"]);
    expect(segunda.enviadas[0]).toEqual({ tipo: "preparar", origem: "escuta", prioridade: "precisao" });
    expect(segunda.pedidos[0]?.audio[0]).toBe(5);
    segunda.concluirUltimo("de novo");
    await expect(pedido).resolves.toMatchObject({ texto: "de novo" });
    expect(falhas).toEqual([]);
  });

  it(`na ${MAXIMO_DE_QUEDAS_DO_MOTOR_NATIVO}ª queda com trabalho perdido, desiste (sem um resultado no meio)`, async () => {
    const { conexao, motor, falhas } = montar();
    const pedido = motor.transcrever(audio(), { origem: "ditado" });
    await microtarefas();
    conexao.porta.cair();
    await microtarefas();
    expect(falhas).toEqual([]);
    conexao.porta.cair();
    await expect(pedido).rejects.toBeInstanceOf(FalhaDoMotorNativo);
    expect(falhas).toHaveLength(1);
  });

  it("um resultado entregue zera as quedas", async () => {
    const { conexao, motor, falhas } = montar();
    const primeiro = motor.transcrever(audio(1), { origem: "ditado" });
    await microtarefas();
    conexao.porta.cair();
    await microtarefas();
    conexao.porta.concluirUltimo("1");
    await primeiro;

    const segundo = motor.transcrever(audio(2), { origem: "ditado" });
    conexao.porta.cair();
    await microtarefas();
    conexao.porta.concluirUltimo("2");
    await expect(segundo).resolves.toMatchObject({ texto: "2" });
    expect(falhas).toEqual([]);
  });

  it("a porta que fecha ociosa (o utilitário descarregou) não conta como queda nem recarrega o modelo", async () => {
    const { conexao, motor, falhas } = montar();
    const preparo = motor.preparar("escuta");
    await microtarefas();
    conexao.porta.responder({ tipo: "pronto", origem: "escuta" });
    await preparo;

    for (let i = 0; i < MAXIMO_DE_QUEDAS_DO_MOTOR_NATIVO + 1; i++) {
      conexao.porta.cair();
      // O app entrega a porta nova sozinho: nada é preparado até o próximo uso.
      const nova = conexao.entregar();
      expect(nova.enviadas).toEqual([]);
    }
    expect(falhas).toEqual([]);
    expect(conexao.conexoes).toBe(1);

    const pedido = motor.transcrever(audio(), { origem: "escuta" });
    expect(conexao.porta.tipos).toEqual(["preparar", "transcrever"]);
    conexao.porta.concluirUltimo("ok");
    await expect(pedido).resolves.toMatchObject({ texto: "ok" });
  });

  it("uma porta nova sem a antiga fechar: o pedido em andamento vai de novo nela", async () => {
    const { conexao, motor } = montar();
    const pedido = motor.transcrever(audio(9), { origem: "ditado" });
    await microtarefas();
    const antiga = conexao.porta;
    const nova = conexao.entregar();
    expect(antiga.fechada).toBe(true);
    expect(nova.pedidos[0]?.audio[0]).toBe(9);
    // Resposta atrasada da antiga não vale.
    antiga.concluirUltimo("velha");
    nova.concluirUltimo("nova");
    await expect(pedido).resolves.toMatchObject({ texto: "nova" });
  });

  it("conectar rejeitado: desiste com FalhaDoMotorNativo", async () => {
    const { conexao, motor, falhas } = montar();
    conexao.erroAoConectar = new Error("motor desligado");
    await expect(motor.preparar("ditado")).rejects.toThrow("motor desligado");
    expect(falhas[0]).toBeInstanceOf(FalhaDoMotorNativo);
  });
});

describe("motor nativo · tempos", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it(`a porta que não chega em ${TEMPO_PARA_RECEBER_A_PORTA_MS / 1000} s: desiste`, async () => {
    const { conexao, motor, falhas } = montar();
    conexao.entregarAoConectar = false;
    const pedido = motor.transcrever(audio(), { origem: "ditado" });
    const rejeitado = expect(pedido).rejects.toBeInstanceOf(FalhaDoMotorNativo);
    await vi.advanceTimersByTimeAsync(TEMPO_PARA_RECEBER_A_PORTA_MS - 1);
    expect(falhas).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    await rejeitado;
    expect(falhas).toHaveLength(1);
  });

  it("3 min sem uso: manda 'descarregar'; um pedido no meio espera a porta nova; fechar não é queda", async () => {
    const { conexao, motor, falhas } = montar();
    const primeiro = motor.transcrever(audio(1), { origem: "ditado" });
    await microtarefas();
    const antiga = conexao.porta;
    antiga.concluirUltimo("1");
    await primeiro;

    await vi.advanceTimersByTimeAsync(TEMPO_PARA_DESCARREGAR_O_DITADO_MS - 1);
    expect(antiga.tipos).not.toContain("descarregar");
    await vi.advanceTimersByTimeAsync(1);
    expect(antiga.tipos.at(-1)).toBe("descarregar");

    // O utilitário vai ser encerrado: o pedido novo não vai para ele.
    const segundo = motor.transcrever(audio(2), { origem: "ditado" });
    expect(antiga.pedidos).toHaveLength(1);
    antiga.cair();
    await microtarefas();
    const nova = conexao.porta;
    expect(nova).not.toBe(antiga);
    expect(nova.pedidos[0]?.audio[0]).toBe(2);
    nova.concluirUltimo("2");
    await expect(segundo).resolves.toMatchObject({ texto: "2" });

    // Duas descargas seguidas também não contam como queda.
    await vi.advanceTimersByTimeAsync(TEMPO_PARA_DESCARREGAR_O_DITADO_MS);
    nova.cair();
    expect(falhas).toEqual([]);
  });

  it("sem a porta nova depois de 'descarregar', volta a usar a mesma", async () => {
    const { conexao, motor } = montar();
    const primeiro = motor.transcrever(audio(1), { origem: "ditado" });
    await microtarefas();
    conexao.porta.concluirUltimo("1");
    await primeiro;
    await vi.advanceTimersByTimeAsync(TEMPO_PARA_DESCARREGAR_O_DITADO_MS);

    const segundo = motor.transcrever(audio(2), { origem: "ditado" });
    await vi.advanceTimersByTimeAsync(TEMPO_PARA_TROCAR_A_PORTA_DESCARREGADA_MS - 1);
    expect(conexao.porta.pedidos).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(conexao.porta.pedidos).toHaveLength(2);
    conexao.porta.concluirUltimo("2");
    await expect(segundo).resolves.toMatchObject({ texto: "2" });
  });
});

describe("conexão pela janela", () => {
  /** Uma janela falsa: guarda o ouvinte de `message` para o teste disparar. */
  function janelaFalsa() {
    const ouvintes = new Set<(evento: MessageEvent) => void>();
    const janela = {
      addEventListener: (_tipo: string, ouvinte: (evento: MessageEvent) => void) => ouvintes.add(ouvinte),
      removeEventListener: (_tipo: string, ouvinte: (evento: MessageEvent) => void) => ouvintes.delete(ouvinte),
    };
    const disparar = (evento: { source: unknown; data: unknown; ports: PortaDaTranscricao[] }) => {
      for (const ouvinte of ouvintes) ouvinte(evento as unknown as MessageEvent);
    };
    return { janela: janela as unknown as Window, disparar, ouvintes };
  }

  it("a porta chega pelo 'message' da própria janela, com o tipo da mensagem da porta", () => {
    const { janela, disparar, ouvintes } = janelaFalsa();
    const recebidas: PortaDaTranscricao[] = [];
    const parar = conexaoPelaJanela(janela).aoReceberPorta((porta) => recebidas.push(porta));
    const porta = new PortaFalsa();

    disparar({ source: {}, data: { tipo: TIPO_DA_MENSAGEM_DA_PORTA }, ports: [porta] });
    disparar({ source: janela, data: { tipo: "outra-coisa" }, ports: [porta] });
    disparar({ source: janela, data: { tipo: TIPO_DA_MENSAGEM_DA_PORTA }, ports: [] });
    expect(recebidas).toEqual([]);

    disparar({ source: janela, data: { tipo: TIPO_DA_MENSAGEM_DA_PORTA }, ports: [porta] });
    expect(recebidas).toEqual([porta]);

    parar();
    expect(ouvintes.size).toBe(0);
  });

  it("o motor nativo adota a porta que chega pela janela", async () => {
    const { janela, disparar } = janelaFalsa();
    const base = conexaoPelaJanela(janela);
    const porta = new PortaFalsa();
    const conexao: ConexaoDaTranscricaoNativa = {
      conectar: () => {
        queueMicrotask(() => disparar({ source: janela, data: { tipo: TIPO_DA_MENSAGEM_DA_PORTA }, ports: [porta] }));
        return Promise.resolve();
      },
      aoReceberPorta: (ouvinte) => base.aoReceberPorta(ouvinte),
    };
    const motor = criarMotorNativo(conexao);
    const pedido = motor.transcrever(audio(), { origem: "ditado" });
    await microtarefas();
    expect(porta.pedidos).toHaveLength(1);
    porta.concluirUltimo("pela janela");
    await expect(pedido).resolves.toMatchObject({ texto: "pela janela" });
  });
});

describe("mensagens do utilitário", () => {
  it("ignora o que não é do protocolo e completa o que falta", () => {
    expect(lerMensagemDoUtilitario(null)).toBeNull();
    expect(lerMensagemDoUtilitario({ tipo: "desconhecido" })).toBeNull();
    expect(lerMensagemDoUtilitario({ tipo: "motor", origem: "escuta", motor: { dispositivo: "tpu" } })).toBeNull();
    expect(lerMensagemDoUtilitario({ tipo: "pronto", origem: "outra" })).toBeNull();
    expect(lerMensagemDoUtilitario({ tipo: "resultado", id: 1, texto: "oi", segmentos: [{ texto: "x" }] })).toEqual({
      tipo: "resultado",
      id: 1,
      resultado: { texto: "oi", segmentos: [], idioma: "pt", duracaoDaPassadaMs: 0 },
    });
    expect(lerMensagemDoUtilitario({ tipo: "erro", id: null, mensagem: "x", descartado: true })).toEqual({
      tipo: "erro",
      id: null,
      mensagem: "x",
      descartado: true,
      indisponivel: false,
    });
  });
});
