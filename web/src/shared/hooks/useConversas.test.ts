import { act, renderHook } from "@testing-library/react";

import type { FonteDeEventos } from "../api/ConexoesDeEventos";
import type { DadosDaConfiguracao, EventoDeOrquestracao, EventoRegistrado, SinalDeVida } from "../api/tipos";
import { aplicarEvento, ESTADO_INICIAL } from "../estado/aplicarEvento";
import { RESERVA_DA_DESCARGA_MS, useConversas } from "./useConversas";

class FonteFalsa implements FonteDeEventos {
  static criadas: FonteFalsa[] = [];
  readyState = 0;
  onopen: FonteDeEventos["onopen"] = null;
  onerror: FonteDeEventos["onerror"] = null;
  onmessage: FonteDeEventos["onmessage"] = null;
  private readonly ouvintesDeSinal: ((evento: MessageEvent<string>) => void)[] = [];

  constructor(public readonly endereco: string) {
    FonteFalsa.criadas.push(this);
  }

  addEventListener(_tipo: "sinal", ouvinte: (evento: MessageEvent<string>) => void): void {
    this.ouvintesDeSinal.push(ouvinte);
  }

  close(): void {
    this.readyState = 2;
  }

  receber(orquestradorId: string, evento: EventoRegistrado): void {
    this.onmessage?.(new MessageEvent("message", { data: JSON.stringify({ orquestradorId, evento }) }));
  }

  sinalizar(orquestradorId: string, sinal: SinalDeVida): void {
    for (const ouvinte of this.ouvintesDeSinal) {
      ouvinte(new MessageEvent("sinal", { data: JSON.stringify({ orquestradorId, sinal }) }));
    }
  }
}

const configuracao: DadosDaConfiguracao = {
  modeloDoOrquestrador: "opus",
  esforcoDoOrquestrador: "padrao",
  modeloDosSubagentes: "sonnet",
  esforcoDosSubagentes: "padrao",
  quantidadeDeSubagentes: { modo: "automatica", limite: 3 },
  nivelDePermissao: "leitura",
  permitirCommitEPush: false,
  permitirArtefatosOnline: false,
  instrucoesPersonalizadas: "",
};

function registrar(eventos: EventoDeOrquestracao[], primeira = 1): EventoRegistrado[] {
  return eventos.map((evento, indice) => ({ ...evento, sequencia: primeira + indice, em: "2026-10-28T12:00:00Z" }));
}

const historico = (turnoId: string): EventoRegistrado[] =>
  registrar([
    { tipo: "turno_iniciado", turnoId, texto: "analise", configuracao },
    { tipo: "texto_do_orquestrador", turnoId, texto: "primeiro" },
    { tipo: "subagente_iniciado", turnoId, subagenteId: "a", descricao: "A", tarefa: "a" },
    { tipo: "texto_do_orquestrador", turnoId, texto: "segundo" },
    { tipo: "subagente_concluido", turnoId, subagenteId: "a", situacao: "concluido", resumo: "ok", tokens: 1, duracaoMs: 1 },
    { tipo: "texto_do_orquestrador", turnoId, texto: "terceiro" },
  ]);

const sinal = (tokensPensando: number): SinalDeVida => ({ turnoId: "t1", em: "2026-10-28T12:00:00Z", tokensPensando });

describe("useConversas", () => {
  let quadros: Map<number, FrameRequestCallback>;
  let proximoQuadro: number;

  const rodarQuadro = () => {
    const pendentes = [...quadros.values()];
    quadros.clear();
    for (const quadro of pendentes) {
      quadro(performance.now());
    }
  };

  const montar = (ids: readonly string[]) => {
    let renders = 0;
    const hook = renderHook(
      (props: { ids: readonly string[] }) => {
        renders += 1;
        return useConversas(props.ids, true);
      },
      { initialProps: { ids } },
    );
    const fonte = FonteFalsa.criadas.at(-1);
    if (fonte === undefined) {
      throw new Error("A conexão não abriu.");
    }
    return { ...hook, fonte, renders: () => renders };
  };

  beforeEach(() => {
    FonteFalsa.criadas = [];
    quadros = new Map();
    proximoQuadro = 1;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    vi.stubGlobal("EventSource", FonteFalsa);
    vi.stubGlobal("requestAnimationFrame", (quadro: FrameRequestCallback) => {
      const id = proximoQuadro++;
      quadros.set(id, quadro);
      return id;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => quadros.delete(id));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("aplica os eventos de um quadro num commit só", () => {
    const { result, fonte, renders } = montar(["o1"]);
    const eventos = historico("t1");
    const antes = renders();

    act(() => {
      for (const evento of eventos) {
        fonte.receber("o1", evento);
      }
    });
    expect(renders()).toBe(antes);
    expect(result.current.conversas.has("o1")).toBe(false);

    act(() => rodarQuadro());
    expect(renders()).toBe(antes + 1);
    expect(result.current.conversas.get("o1")).toEqual(eventos.reduce(aplicarEvento, ESTADO_INICIAL));
    expect(quadros.size).toBe(0);
  });

  it("mantém a ordem de chegada por orquestrador com eventos misturados", () => {
    const { result, fonte } = montar(["o1", "o2"]);
    const doO1 = historico("t1");
    const doO2 = historico("t2");

    act(() => {
      doO1.forEach((evento, indice) => {
        fonte.receber("o1", evento);
        const outro = doO2[indice];
        if (outro !== undefined) {
          fonte.receber("o2", outro);
        }
      });
      // Repetido do histórico: ignorado, como antes.
      const repetido = doO1[1];
      if (repetido !== undefined) {
        fonte.receber("o1", repetido);
      }
    });
    act(() => rodarQuadro());

    expect(result.current.conversas.get("o1")).toEqual(doO1.reduce(aplicarEvento, ESTADO_INICIAL));
    expect(result.current.conversas.get("o2")).toEqual(doO2.reduce(aplicarEvento, ESTADO_INICIAL));
    expect(result.current.conversas.get("o1")?.turnos[0]?.log.map((linha) => linha.sequencia)).toEqual(
      doO1.reduce(aplicarEvento, ESTADO_INICIAL).turnos[0]?.log.map((linha) => linha.sequencia),
    );
  });

  it("junta eventos e sinais do mesmo quadro num commit e guarda o último sinal", () => {
    const { result, fonte, renders } = montar(["o1"]);
    const antes = renders();

    act(() => {
      fonte.receber("o1", historico("t1")[0] as EventoRegistrado);
      fonte.sinalizar("o1", sinal(10));
      fonte.sinalizar("o1", sinal(20));
    });
    act(() => rodarQuadro());

    expect(renders()).toBe(antes + 1);
    expect(result.current.sinais.get("o1")).toEqual(sinal(20));
    expect(result.current.conversas.get("o1")?.turnos).toHaveLength(1);
  });

  it("descarrega pelo timer quando o quadro não vem (janela oculta)", () => {
    const { result, fonte } = montar(["o1"]);

    act(() => {
      fonte.receber("o1", historico("t1")[0] as EventoRegistrado);
      fonte.sinalizar("o1", sinal(5));
    });
    act(() => vi.advanceTimersByTime(RESERVA_DA_DESCARGA_MS - 1));
    expect(result.current.conversas.has("o1")).toBe(false);

    act(() => vi.advanceTimersByTime(1));
    expect(result.current.conversas.get("o1")?.ultimaSequencia).toBe(1);
    expect(result.current.sinais.get("o1")).toEqual(sinal(5));
    // O quadro que ficou para trás foi cancelado.
    expect(quadros.size).toBe(0);
  });

  it("esquece na hora quem saiu, depois dos eventos que já tinham chegado dele", () => {
    const { result, fonte, rerender } = montar(["o1", "o2"]);

    act(() => {
      fonte.receber("o1", historico("t1")[0] as EventoRegistrado);
      fonte.receber("o2", historico("t2")[0] as EventoRegistrado);
    });
    rerender({ ids: ["o2"] });

    expect(result.current.conversas.has("o1")).toBe(false);
    expect(result.current.conversas.get("o2")?.ultimaSequencia).toBe(1);
    expect(quadros.size).toBe(0);
  });

  it("reabre a conexão a partir do que ainda espera na fila", () => {
    const { fonte, rerender } = montar(["o1"]);

    act(() => {
      for (const evento of historico("t1")) {
        fonte.receber("o1", evento);
      }
    });
    rerender({ ids: ["o1", "o2"] });

    expect(FonteFalsa.criadas.at(-1)?.endereco).toBe("/api/eventos-dos-orquestradores?orquestradores=o1:6,o2:0");
  });

  it("desmontar limpa a fila e cancela o quadro e o timer", () => {
    const { fonte, unmount } = montar(["o1"]);

    act(() => fonte.receber("o1", historico("t1")[0] as EventoRegistrado));
    expect(quadros.size).toBe(1);
    expect(vi.getTimerCount()).toBe(1);
    unmount();

    expect(quadros.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
