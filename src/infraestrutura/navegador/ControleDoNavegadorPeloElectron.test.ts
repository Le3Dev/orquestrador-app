import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ComandoDoNavegador } from "../../navegador/ComandoDoNavegador";
import { ErroDoNavegador } from "../../navegador/ErroDoNavegador";
import {
  ControleDoNavegadorPeloElectron,
  PortaParaOProcessoPai,
  TEMPO_LIMITE_DO_COMANDO_EM_MS,
} from "./ControleDoNavegadorPeloElectron";

/** A `parentPort` falsa: guarda o que o servidor manda e deixa o teste responder como o app. */
class PortaFalsa implements PortaParaOProcessoPai {
  readonly enviadas: Array<Record<string, unknown>> = [];
  private readonly ouvintes: Array<(mensagem: { data: unknown }) => void> = [];
  falhaAoEnviar: Error | null = null;

  on(_evento: "message", ouvinte: (mensagem: { data: unknown }) => void): void {
    this.ouvintes.push(ouvinte);
  }

  postMessage(mensagem: unknown): void {
    if (this.falhaAoEnviar) throw this.falhaAoEnviar;
    this.enviadas.push(mensagem as Record<string, unknown>);
  }

  /** O app respondendo (ou mandando qualquer outra coisa). */
  receber(dados: unknown): void {
    for (const ouvinte of this.ouvintes) ouvinte({ data: dados });
  }

  get comandos(): Array<Record<string, unknown>> {
    return this.enviadas.filter((mensagem) => mensagem["tipo"] === "navegador:comando");
  }
}

const ABRIR: ComandoDoNavegador = { tipo: "abrir", url: "https://exemplo.com/" };
const RESULTADO = { url: "https://exemplo.com/", titulo: "Exemplo", mensagem: "Página aberta." };

describe("ControleDoNavegadorPeloElectron", () => {
  let porta: PortaFalsa;
  let ids: number;
  let controle: ControleDoNavegadorPeloElectron;

  beforeEach(() => {
    vi.useFakeTimers();
    porta = new PortaFalsa();
    ids = 0;
    controle = new ControleDoNavegadorPeloElectron({ porta, gerarId: () => `id-${++ids}` });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("manda o comando pela parentPort e resolve com a resposta de mesmo id", async () => {
    const execucao = controle.executar("orq-1", ABRIR, new AbortController().signal);

    expect(porta.enviadas).toEqual([{ tipo: "navegador:comando", id: "id-1", orquestradorId: "orq-1", comando: ABRIR }]);

    porta.receber({ tipo: "navegador:resposta", id: "id-1", ok: true, resultado: RESULTADO });
    await expect(execucao).resolves.toEqual(RESULTADO);
  });

  it("correlaciona respostas fora de ordem pelo id", async () => {
    const primeiro = controle.executar("orq-1", ABRIR, new AbortController().signal);
    const segundo = controle.executar("orq-2", { tipo: "voltar" }, new AbortController().signal);

    porta.receber({ tipo: "navegador:resposta", id: "id-2", ok: true, resultado: { ...RESULTADO, mensagem: "segundo" } });
    porta.receber({ tipo: "navegador:resposta", id: "id-1", ok: true, resultado: { ...RESULTADO, mensagem: "primeiro" } });

    await expect(segundo).resolves.toMatchObject({ mensagem: "segundo" });
    await expect(primeiro).resolves.toMatchObject({ mensagem: "primeiro" });
  });

  it("converte a resposta de erro em ErroDoNavegador com o motivo", async () => {
    const execucao = controle.executar("orq-1", ABRIR, new AbortController().signal);
    porta.receber({
      tipo: "navegador:resposta",
      id: "id-1",
      ok: false,
      erro: { motivo: "pausado", mensagem: "O usuário assumiu o navegador; tente depois." },
    });

    const erro = await execucao.catch((falha: unknown) => falha);
    expect(erro).toBeInstanceOf(ErroDoNavegador);
    expect(erro).toMatchObject({ motivo: "pausado", message: "O usuário assumiu o navegador; tente depois." });
  });

  it("motivo desconhecido ou erro sem dados viram 'falhou'", async () => {
    const primeiro = controle.executar("orq-1", ABRIR, new AbortController().signal);
    porta.receber({ tipo: "navegador:resposta", id: "id-1", ok: false, erro: { motivo: "explodiu", mensagem: "Boom" } });
    await expect(primeiro).rejects.toMatchObject({ motivo: "falhou", message: "Boom" });

    const segundo = controle.executar("orq-1", ABRIR, new AbortController().signal);
    porta.receber({ tipo: "navegador:resposta", id: "id-2", ok: false });
    await expect(segundo).rejects.toMatchObject({ motivo: "falhou", message: "O navegador falhou." });
  });

  it("resultado inválido vira erro 'falhou'", async () => {
    const execucao = controle.executar("orq-1", ABRIR, new AbortController().signal);
    porta.receber({ tipo: "navegador:resposta", id: "id-1", ok: true, resultado: { url: 123 } });
    await expect(execucao).rejects.toMatchObject({ motivo: "falhou" });
  });

  it("ignora mensagens de outro tipo, de outro id e lixo", async () => {
    const execucao = controle.executar("orq-1", ABRIR, new AbortController().signal);
    porta.receber(null);
    porta.receber("texto");
    porta.receber({ tipo: "desligar" });
    porta.receber({ tipo: "navegador:resposta", id: "outro", ok: true, resultado: RESULTADO });
    porta.receber({ tipo: "navegador:resposta", ok: true, resultado: RESULTADO });

    let resolvido = false;
    void execucao.then(() => {
      resolvido = true;
    });
    await vi.advanceTimersByTimeAsync(10);
    expect(resolvido).toBe(false);

    porta.receber({ tipo: "navegador:resposta", id: "id-1", ok: true, resultado: RESULTADO });
    await expect(execucao).resolves.toEqual(RESULTADO);
  });

  it("estoura o tempo limite, avisa o app para cancelar e ignora a resposta tardia", async () => {
    const execucao = controle.executar("orq-1", ABRIR, new AbortController().signal);
    const rejeicao = expect(execucao).rejects.toMatchObject({ motivo: "tempo_esgotado" });

    await vi.advanceTimersByTimeAsync(TEMPO_LIMITE_DO_COMANDO_EM_MS);
    await rejeicao;
    expect(porta.enviadas.at(-1)).toEqual({ tipo: "navegador:cancelar", id: "id-1" });

    // A resposta que chega depois não faz nada nem estoura.
    porta.receber({ tipo: "navegador:resposta", id: "id-1", ok: true, resultado: RESULTADO });
  });

  it("o tempo limite padrão é de 60 segundos e pode ser trocado", async () => {
    expect(TEMPO_LIMITE_DO_COMANDO_EM_MS).toBe(60_000);
    const curto = new ControleDoNavegadorPeloElectron({ porta, tempoLimiteEmMs: 1_000, gerarId: () => "x" });
    const execucao = curto.executar("orq-1", ABRIR, new AbortController().signal);
    const rejeicao = expect(execucao).rejects.toMatchObject({ motivo: "tempo_esgotado", message: expect.stringContaining("1 segundos") });
    await vi.advanceTimersByTimeAsync(1_000);
    await rejeicao;
  });

  it("cancela pelo sinal: rejeita e manda navegador:cancelar", async () => {
    const abortador = new AbortController();
    const execucao = controle.executar("orq-1", ABRIR, abortador.signal);

    abortador.abort();

    await expect(execucao).rejects.toMatchObject({ motivo: "cancelado" });
    expect(porta.enviadas.at(-1)).toEqual({ tipo: "navegador:cancelar", id: "id-1" });
    // Sem timer pendente depois do cancelamento.
    expect(vi.getTimerCount()).toBe(0);
  });

  it("sinal já abortado: nem manda o comando", async () => {
    const abortador = new AbortController();
    abortador.abort();

    await expect(controle.executar("orq-1", ABRIR, abortador.signal)).rejects.toMatchObject({ motivo: "cancelado" });
    expect(porta.enviadas).toEqual([]);
  });

  it("sem parentPort, responde que só funciona no aplicativo desktop", async () => {
    const semPorta = new ControleDoNavegadorPeloElectron({ porta: null });

    const erro = await semPorta.executar("orq-1", ABRIR, new AbortController().signal).catch((falha: unknown) => falha);

    expect(erro).toBeInstanceOf(ErroDoNavegador);
    expect(erro).toMatchObject({ motivo: "indisponivel", message: "O navegador do agente só funciona no aplicativo desktop." });
  });

  it("falha de envio vira erro 'indisponivel' e não deixa timer", async () => {
    porta.falhaAoEnviar = new Error("canal fechado");

    await expect(controle.executar("orq-1", ABRIR, new AbortController().signal)).rejects.toMatchObject({
      motivo: "indisponivel",
      message: expect.stringContaining("canal fechado"),
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("encerrar cancela os comandos em espera e recusa os novos", async () => {
    const execucao = controle.executar("orq-1", ABRIR, new AbortController().signal);

    controle.encerrar();

    await expect(execucao).rejects.toMatchObject({ motivo: "cancelado" });
    await expect(controle.executar("orq-1", ABRIR, new AbortController().signal)).rejects.toMatchObject({ motivo: "cancelado" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("gera ids únicos por padrão", async () => {
    const real = new ControleDoNavegadorPeloElectron({ porta });
    void real.executar("orq-1", ABRIR, new AbortController().signal).catch(() => undefined);
    void real.executar("orq-1", ABRIR, new AbortController().signal).catch(() => undefined);

    const [a, b] = porta.comandos.map((comando) => comando["id"]);
    expect(typeof a).toBe("string");
    expect(a).not.toBe(b);
    real.encerrar();
  });
});
