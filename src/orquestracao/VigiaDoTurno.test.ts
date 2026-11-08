import { beforeEach, describe, expect, it } from "vitest";

import { AlvoDoDiagnostico, DiagnosticadorDoClaude, DiagnosticoDoClaude } from "./DiagnosticoDoClaude";
import { AgendadorDeTarefas, LeituraDaVigia, VigiaDoTurno } from "./VigiaDoTurno";

const SEGUNDO = 1_000;
const MINUTO = 60 * SEGUNDO;

const esvaziar = (): Promise<void> => new Promise((resolver) => setImmediate(resolver));

/** Relógio e agendador falsos: o tempo só anda com `avancar`, rodando as tarefas na ordem. */
class RelogioFalso implements AgendadorDeTarefas {
  agoraMs = Date.parse("2026-11-08T12:00:00Z");
  private tarefas: Array<{ em: number; tarefa: () => void }> = [];

  agora = (): Date => new Date(this.agoraMs);

  agendar(ms: number, tarefa: () => void): () => void {
    const item = { em: this.agoraMs + ms, tarefa };
    this.tarefas.push(item);
    return () => {
      this.tarefas = this.tarefas.filter((outro) => outro !== item);
    };
  }

  get pendentes(): number {
    return this.tarefas.length;
  }

  async avancar(ms: number): Promise<void> {
    const alvo = this.agoraMs + ms;
    for (;;) {
      this.tarefas.sort((a, b) => a.em - b.em);
      const proxima = this.tarefas[0];
      if (proxima === undefined || proxima.em > alvo) {
        break;
      }
      this.tarefas.shift();
      this.agoraMs = proxima.em;
      proxima.tarefa();
      await esvaziar();
    }
    this.agoraMs = alvo;
  }
}

const parado: DiagnosticoDoClaude = {
  processoVivo: true,
  cpuDoClaude: 0,
  filhos: [],
  transcricoesCrescendo: false,
  ultimaEscritaEm: null,
};

class DiagnosticadorFalso implements DiagnosticadorDoClaude {
  diagnostico: DiagnosticoDoClaude = parado;
  readonly alvos: AlvoDoDiagnostico[] = [];
  readonly esquecidos: string[] = [];

  async diagnosticar(alvo: AlvoDoDiagnostico): Promise<DiagnosticoDoClaude> {
    this.alvos.push(alvo);
    return this.diagnostico;
  }
  esquecer(orquestradorId: string): void {
    this.esquecidos.push(orquestradorId);
  }
}

describe("VigiaDoTurno", () => {
  let relogio: RelogioFalso;
  let diagnosticador: DiagnosticadorFalso;
  let leituras: LeituraDaVigia[];
  let travamentos: string[];
  let podeAgir: boolean;
  let vigia: VigiaDoTurno;

  beforeEach(() => {
    relogio = new RelogioFalso();
    diagnosticador = new DiagnosticadorFalso();
    leituras = [];
    travamentos = [];
    podeAgir = true;
    vigia = new VigiaDoTurno({
      alvo: { orquestradorId: "o1", sessaoId: "s1", pastaDoTurno: "/w" },
      diagnosticador,
      agendador: relogio,
      agora: relogio.agora,
      podeAgir: () => podeAgir,
      aoDiagnosticar: (leitura) => leituras.push(leitura),
      aoTravar: (resumo) => travamentos.push(resumo),
    });
  });

  it("só diagnostica depois de 90 s sem linha, e cada linha recomeça a contagem", async () => {
    vigia.ligar();
    await relogio.avancar(60 * SEGUNDO);
    vigia.registrarLinha();
    await relogio.avancar(89 * SEGUNDO);
    expect(diagnosticador.alvos).toHaveLength(0);

    await relogio.avancar(1 * SEGUNDO);
    expect(diagnosticador.alvos).toEqual([{ orquestradorId: "o1", sessaoId: "s1", pastaDoTurno: "/w" }]);
    expect(leituras).toEqual([{ situacao: "suspeito", resumo: "sem saída há 1 min, sem CPU" }]);

    // Depois, a cada 30 s.
    await relogio.avancar(30 * SEGUNDO);
    expect(diagnosticador.alvos).toHaveLength(2);
  });

  it("comando com CPU é trabalho: mostra o comando e nunca trava", async () => {
    diagnosticador.diagnostico = {
      ...parado,
      filhos: [{ pid: 9, comando: "npm test", cpu: 85, haMs: 6 * MINUTO }],
    };
    vigia.ligar();
    await relogio.avancar(20 * MINUTO);

    expect(leituras.at(-1)).toEqual({ situacao: "trabalhando", resumo: "rodando `npm test` há 6 min" });
    expect(leituras.every((leitura) => leitura.situacao === "trabalhando")).toBe(true);
    expect(travamentos).toEqual([]);
  });

  it("transcrições crescendo e CPU do Claude também são trabalho", async () => {
    diagnosticador.diagnostico = { ...parado, transcricoesCrescendo: true };
    vigia.ligar();
    await relogio.avancar(90 * SEGUNDO);
    expect(leituras.at(-1)).toEqual({ situacao: "trabalhando", resumo: "subagentes escrevendo" });

    diagnosticador.diagnostico = { ...parado, cpuDoClaude: 40 };
    await relogio.avancar(30 * SEGUNDO);
    expect(leituras.at(-1)).toEqual({ situacao: "trabalhando", resumo: "Claude processando" });

    await relogio.avancar(20 * MINUTO);
    expect(travamentos).toEqual([]);
  });

  it("trava com 5 min sem linha e 3 diagnósticos seguidos sem sinal de trabalho, e se desliga", async () => {
    vigia.ligar();
    await relogio.avancar(5 * MINUTO - 1);
    expect(travamentos).toEqual([]);

    await relogio.avancar(1);
    expect(travamentos).toEqual(["sem saída há 5 min, sem CPU e sem transcrição crescendo"]);
    expect(relogio.pendentes).toBe(0);
    await relogio.avancar(10 * MINUTO);
    expect(travamentos).toHaveLength(1);
  });

  it("um sinal de trabalho no meio zera a contagem dos diagnósticos parados", async () => {
    vigia.ligar();
    await relogio.avancar(4 * MINUTO + 30 * SEGUNDO);
    diagnosticador.diagnostico = { ...parado, transcricoesCrescendo: true };
    await relogio.avancar(30 * SEGUNDO); // 5 min: trabalhando
    diagnosticador.diagnostico = parado;
    await relogio.avancar(60 * SEGUNDO); // 5,5 e 6 min: 2 parados
    expect(travamentos).toEqual([]);

    await relogio.avancar(30 * SEGUNDO); // 6,5 min: 3 parados
    expect(travamentos).toEqual(["sem saída há 6 min, sem CPU e sem transcrição crescendo"]);
  });

  it("com um comando aberto sem CPU, tolera até 15 min", async () => {
    diagnosticador.diagnostico = {
      ...parado,
      filhos: [{ pid: 9, comando: "npx playwright test", cpu: 0, haMs: 2 * MINUTO }],
    };
    vigia.ligar();
    await relogio.avancar(14 * MINUTO + 59 * SEGUNDO);
    expect(travamentos).toEqual([]);
    expect(leituras.at(-1)?.situacao).toBe("suspeito");
    expect(leituras.at(-1)?.resumo).toContain("`npx playwright test` aberto há 2 min, parado");

    await relogio.avancar(1 * SEGUNDO);
    expect(travamentos).toEqual(["sem saída há 15 min; `npx playwright test` aberto há 2 min, sem CPU"]);
  });

  it("processo do Claude morto em 2 diagnósticos seguidos trava logo", async () => {
    diagnosticador.diagnostico = { ...parado, processoVivo: false };
    vigia.ligar();
    await relogio.avancar(90 * SEGUNDO);
    expect(travamentos).toEqual([]);

    await relogio.avancar(30 * SEGUNDO);
    expect(travamentos).toEqual(["sem saída há 2 min; o processo do Claude terminou sem fechar o turno"]);
  });

  it("com a autorrecuperação desligada, só diagnostica: não trava", async () => {
    podeAgir = false;
    vigia.ligar();
    await relogio.avancar(20 * MINUTO);

    expect(travamentos).toEqual([]);
    expect(leituras.at(-1)).toEqual({ situacao: "suspeito", resumo: "sem saída há 20 min, sem CPU" });
  });

  it("desligada, não diagnostica mais nem deixa nada marcado", async () => {
    vigia.ligar();
    vigia.desligar();
    await relogio.avancar(10 * MINUTO);

    expect(diagnosticador.alvos).toEqual([]);
    expect(relogio.pendentes).toBe(0);
  });
});
