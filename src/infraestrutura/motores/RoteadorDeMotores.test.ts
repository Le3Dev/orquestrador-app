import { rmSync } from "node:fs";

import { afterAll, describe, expect, it, vi } from "vitest";

import { EventoDoMotor } from "../../orquestracao/EventoDeOrquestracao";
import { Motor } from "../../orquestracao/Motor";
import { MotorDeAgentes, PedidoDeTurno, ResultadoDoTurno } from "../../orquestracao/MotorDeAgentes";
import { criarPastasDeTeste, pedidoDeTeste } from "./fixtures/pedidoDeTeste";
import { RegistroDeTurnosDoApp } from "./RegistroDeTurnosDoApp";
import { RoteadorDeMotores } from "./RoteadorDeMotores";

const SUCESSO: ResultadoDoTurno = {
  sucesso: true,
  resposta: "ok",
  uso: { duracaoMs: 1, tokensDeEntrada: 0, tokensDeSaida: 0, subagentesLancados: 0 },
};

function motorFalso(resultado: ResultadoDoTurno = SUCESSO): MotorDeAgentes & { executarTurno: ReturnType<typeof vi.fn> } {
  return { executarTurno: vi.fn(async () => resultado) };
}

describe("RoteadorDeMotores", () => {
  const pastas = criarPastasDeTeste();
  afterAll(() => rmSync(pastas.raiz, { recursive: true, force: true }));
  const pedidoPara = (motor: Motor): PedidoDeTurno => pedidoDeTeste(pastas, motor);

  it("manda o turno ao motor que o pedido pede, com tudo o que recebeu", async () => {
    const claude = motorFalso();
    const codex = motorFalso();
    const copilot = motorFalso();
    const roteador = new RoteadorDeMotores({
      motores: { "claude-code": claude, codex, copilot },
      turnos: new RegistroDeTurnosDoApp(),
    });
    const aoObservar = vi.fn();
    const aoReceberLinha = vi.fn();
    const sinal = new AbortController().signal;
    const pedido = pedidoPara("codex");

    const resultado = await roteador.executarTurno(pedido, aoObservar, sinal, aoReceberLinha);

    expect(resultado).toBe(SUCESSO);
    expect(codex.executarTurno).toHaveBeenCalledWith(pedido, aoObservar, sinal, aoReceberLinha);
    expect(claude.executarTurno).not.toHaveBeenCalled();
    expect(copilot.executarTurno).not.toHaveBeenCalled();
  });

  it("roteia cada um dos três motores", async () => {
    const motores = { "claude-code": motorFalso(), codex: motorFalso(), copilot: motorFalso() };
    const roteador = new RoteadorDeMotores({ motores, turnos: new RegistroDeTurnosDoApp() });

    for (const motor of ["claude-code", "copilot", "codex"] as const) {
      await roteador.executarTurno(pedidoPara(motor), () => undefined, new AbortController().signal);
      expect(motores[motor].executarTurno).toHaveBeenCalledTimes(1);
    }
  });

  it("recusa, com o nome do motor, um motor que não foi ligado", async () => {
    const roteador = new RoteadorDeMotores({ motores: { "claude-code": motorFalso() }, turnos: new RegistroDeTurnosDoApp() });

    const resultado = await roteador.executarTurno(pedidoPara("codex"), () => undefined, new AbortController().signal);

    expect(resultado).toMatchObject({ sucesso: false });
    expect(resultado.sucesso === false && resultado.motivo).toContain("Codex");
  });

  it("registra o turno enquanto o motor roda e o libera no fim, mesmo com falha", async () => {
    const turnos = new RegistroDeTurnosDoApp();
    let visto: ReturnType<RegistroDeTurnosDoApp["obter"]>;
    const motor: MotorDeAgentes = {
      executarTurno: async (pedido, aoObservar) => {
        visto = turnos.obter(pedido.orquestradorId);
        aoObservar({ tipo: "sinal_de_vida", tokensPensando: 1 });
        throw new Error("o motor quebrou");
      },
    };
    const roteador = new RoteadorDeMotores({ motores: { copilot: motor }, turnos });
    const eventos: EventoDoMotor[] = [];
    const pedido = pedidoPara("copilot");
    const sinal = new AbortController().signal;

    await expect(roteador.executarTurno(pedido, (evento) => eventos.push(evento), sinal)).rejects.toThrow("o motor quebrou");

    expect(visto).toMatchObject({ pedido, sinal });
    // O `aoObservar` registrado é o mesmo que o motor recebe: é por ele que a delegação publica os subagentes.
    visto?.aoObservar({ tipo: "sinal_de_vida", tokensPensando: 2 });
    expect(eventos).toHaveLength(2);
    expect(turnos.obter(pedido.orquestradorId)).toBeUndefined();
  });

  it("um turno novo do mesmo Orquestrador (a reserva) não é apagado por um turno antigo que termina depois", () => {
    const turnos = new RegistroDeTurnosDoApp();
    const pedido = pedidoPara("copilot");
    const sinal = new AbortController().signal;

    const antigo = turnos.registrar(pedido, () => undefined, sinal);
    const novo = turnos.registrar(pedido, () => undefined, sinal);
    antigo.liberar();

    expect(turnos.obter(pedido.orquestradorId)).toBe(novo.turno);
    novo.liberar();
    expect(turnos.obter(pedido.orquestradorId)).toBeUndefined();
  });
});
