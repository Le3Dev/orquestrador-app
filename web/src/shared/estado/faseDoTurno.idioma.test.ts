import type { EventoDeOrquestracao, EventoRegistrado } from "../api/tipos";
import { definirIdioma } from "../idioma/idioma";
import { dicaDeComando, dicaDePedidoGrande } from "../comandosDoPrompt";
import { resumoDaConfiguracao } from "../resumoDaConfiguracao";
import { CONFIGURACAO_PADRAO_DO_ORQUESTRADOR, problemaDoModeloDoMotor, rotuloDoEsforco } from "../modelos";
import { dicaDasVariaveis } from "../instrucoes";
import { aplicarEvento, ESTADO_INICIAL, type TurnoNaTela } from "./aplicarEvento";
import { faseDoTurno } from "./faseDoTurno";

function turnoComEventos(...eventos: EventoDeOrquestracao[]): TurnoNaTela {
  const [turno] = eventos
    .map((evento, indice): EventoRegistrado => ({ ...evento, sequencia: indice + 1, em: "2026-10-28T12:00:00Z" }))
    .reduce(aplicarEvento, ESTADO_INICIAL).turnos;
  if (turno === undefined) {
    throw new Error("O histórico de teste não gerou turno.");
  }
  return turno;
}

describe("textos do estado e dos módulos compartilhados: idioma", () => {
  beforeEach(() => {
    localStorage.clear();
    definirIdioma("en");
  });
  afterEach(() => {
    definirIdioma("pt-BR");
    localStorage.clear();
  });

  it("a fase do turno e o log saem em inglês", () => {
    const turno = turnoComEventos({
      tipo: "turno_iniciado",
      turnoId: "t1",
      texto: "faça",
      configuracao: CONFIGURACAO_PADRAO_DO_ORQUESTRADOR,
      modo: "execucao",
    });

    expect(faseDoTurno(turno).descricao).toBe("Planning the subtasks…");
    expect(turno.log[0]?.texto).toMatch(/^turn started · /);
    expect(turno.log[0]?.texto).toMatch(/agents$/);
  });

  it("as dicas do prompt, o resumo da configuração e os rótulos saem em inglês", () => {
    expect(dicaDeComando("/cl", false)).toBe("/clear — start a new conversation · tab completes");
    expect(dicaDePedidoGrande("a".repeat(500), "execucao")).toBe("big request? shift+tab to plan first");
    expect(rotuloDoEsforco("extra_alto")).toBe("Extra high");
    expect(resumoDaConfiguracao(CONFIGURACAO_PADRAO_DO_ORQUESTRADOR)).toBe(
      "Read-only, Sonnet (medium effort) with up to 3 Sonnet (medium effort) subagents.",
    );
    expect(dicaDasVariaveis()).toContain("orchestrator's folder and name");
    expect(
      problemaDoModeloDoMotor({
        ...CONFIGURACAO_PADRAO_DO_ORQUESTRADOR,
        motorDoOrquestrador: "codex",
        modeloDoOrquestrador: "",
      }),
    ).toBe("Enter the orchestrator model (or pick the CLI default).");
  });
});
