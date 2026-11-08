import type { EventoRegistrado, SinalDeVida } from "./tipos";
import { ConexoesDeEventos, ESPERA_PARA_REABRIR_MS, type FonteDeEventos, type SituacaoDaConexao } from "./ConexoesDeEventos";

class FonteFalsa implements FonteDeEventos {
  readyState = 0;
  onopen: FonteDeEventos["onopen"] = null;
  onerror: FonteDeEventos["onerror"] = null;
  onmessage: FonteDeEventos["onmessage"] = null;
  private readonly ouvintesDeSinal: ((evento: MessageEvent<string>) => void)[] = [];

  constructor(public readonly endereco: string) {}

  addEventListener(_tipo: "sinal", ouvinte: (evento: MessageEvent<string>) => void): void {
    this.ouvintesDeSinal.push(ouvinte);
  }

  sinalizar(orquestradorId: string, sinal: SinalDeVida): void {
    for (const ouvinte of this.ouvintesDeSinal) {
      ouvinte(new MessageEvent("sinal", { data: JSON.stringify({ orquestradorId, sinal }) }));
    }
  }

  close(): void {
    this.readyState = 2;
  }

  abrir(): void {
    this.readyState = 1;
    this.onopen?.(new Event("open"));
  }

  cair(): void {
    this.readyState = 0;
    this.onerror?.(new Event("error"));
  }

  receber(orquestradorId: string, evento: EventoRegistrado): void {
    this.onmessage?.(new MessageEvent("message", { data: JSON.stringify({ orquestradorId, evento }) }));
  }
}

const BASE = "/api/eventos-dos-orquestradores?orquestradores=";

function montar(ultimaSequencia: (id: string) => number = () => 0) {
  const fontes: FonteFalsa[] = [];
  const recebidos: [string, EventoRegistrado][] = [];
  const situacoes: [string, SituacaoDaConexao | null][] = [];
  const sinais: [string, SinalDeVida][] = [];
  const conexoes = new ConexoesDeEventos(
    {
      aoReceber: (id, evento) => recebidos.push([id, evento]),
      aoSinal: (id, sinal) => sinais.push([id, sinal]),
      aoMudarSituacao: (id, situacao) => situacoes.push([id, situacao]),
      ultimaSequencia,
    },
    (endereco) => {
      const fonte = new FonteFalsa(endereco);
      fontes.push(fonte);
      return fonte;
    },
  );
  const abertas = () => fontes.filter((fonte) => fonte.readyState !== 2);
  return { conexoes, fontes, abertas, recebidos, situacoes, sinais };
}

const evento = (sequencia: number): EventoRegistrado => ({
  tipo: "turno_cancelado",
  turnoId: "t1",
  sequencia,
  em: "agora",
});

describe("ConexoesDeEventos", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("usa uma conexão só para todos os terminais, mesmo com 20 abertos", () => {
    const { conexoes, abertas } = montar();
    const ids = Array.from({ length: 20 }, (_, indice) => `o${indice + 1}`);

    conexoes.sincronizar(new Set(ids));

    expect(abertas()).toHaveLength(1);
    expect(abertas()[0]?.endereco).toBe(`${BASE}${ids.map((id) => `${id}:0`).join(",")}`);
  });

  it("recria a conexão quando um terminal entra ou sai, retomando cada um do seu último evento", () => {
    const sequencias: Record<string, number> = { o1: 12, o2: 0 };
    const { conexoes, fontes, abertas, situacoes } = montar((id) => sequencias[id] ?? 0);

    conexoes.sincronizar(new Set(["o1"]));
    conexoes.sincronizar(new Set(["o1", "o2"]));
    sequencias.o2 = 7;
    conexoes.sincronizar(new Set(["o2"]));

    expect(fontes.map((fonte) => fonte.endereco)).toEqual([`${BASE}o1:12`, `${BASE}o1:12,o2:0`, `${BASE}o2:7`]);
    expect(abertas()).toHaveLength(1);
    expect(situacoes).toContainEqual(["o1", null]);
  });

  it("não mexe na conexão quando o conjunto de terminais não mudou", () => {
    const { conexoes, fontes } = montar();

    conexoes.sincronizar(new Set(["o1", "o2"]));
    conexoes.sincronizar(new Set(["o2", "o1"]));

    expect(fontes).toHaveLength(1);
  });

  it("entrega cada evento ao orquestrador certo", () => {
    const { conexoes, fontes, recebidos, situacoes } = montar();
    conexoes.sincronizar(new Set(["o1", "o2"]));

    fontes[0]?.abrir();
    fontes[0]?.receber("o2", evento(7));
    fontes[0]?.receber("o1", evento(3));

    expect(situacoes).toContainEqual(["o1", "conectado"]);
    expect(situacoes).toContainEqual(["o2", "conectado"]);
    expect(recebidos).toEqual([
      ["o2", evento(7)],
      ["o1", evento(3)],
    ]);
  });

  it("ignora eventos de um terminal que já saiu do canvas", () => {
    const { conexoes, fontes, recebidos } = montar();
    conexoes.sincronizar(new Set(["o1", "o2"]));
    conexoes.sincronizar(new Set(["o1"]));

    fontes[1]?.receber("o2", evento(1));
    fontes[0]?.receber("o1", evento(1));

    expect(recebidos).toEqual([]);
  });

  it("quando cai, fecha e reabre sozinho a partir do último evento de cada terminal", () => {
    const { conexoes, fontes, abertas, situacoes } = montar(() => 42);
    conexoes.sincronizar(new Set(["o1", "o2"]));

    fontes[0]?.cair();
    expect(situacoes.slice(-2)).toEqual([
      ["o1", "reconectando"],
      ["o2", "reconectando"],
    ]);
    expect(abertas()).toHaveLength(0);
    vi.advanceTimersByTime(ESPERA_PARA_REABRIR_MS);

    expect(fontes.map((fonte) => fonte.endereco)).toEqual([`${BASE}o1:42,o2:42`, `${BASE}o1:42,o2:42`]);
    expect(abertas()).toHaveLength(1);
  });

  it("quando o servidor volta, reabre na hora a conexão que caiu, uma vez só", () => {
    const { conexoes, fontes } = montar(() => 5);
    conexoes.sincronizar(new Set(["o1"]));
    fontes[0]?.cair();

    conexoes.reabrirAbandonadas();
    vi.advanceTimersByTime(ESPERA_PARA_REABRIR_MS);

    expect(fontes).toHaveLength(2);
  });

  it("não reabre uma conexão que está de pé", () => {
    const { conexoes, fontes } = montar();
    conexoes.sincronizar(new Set(["o1"]));
    fontes[0]?.abrir();

    conexoes.reabrirAbandonadas();

    expect(fontes).toHaveLength(1);
  });

  it("entrega os sinais de vida separados dos eventos do histórico", () => {
    const { conexoes, fontes, recebidos, sinais } = montar();
    conexoes.sincronizar(new Set(["o1"]));

    fontes[0]?.sinalizar("o1", { turnoId: "t1", em: "agora", tokensPensando: 300 });

    expect(sinais).toEqual([["o1", { turnoId: "t1", em: "agora", tokensPensando: 300 }]]);
    expect(recebidos).toEqual([]);
  });

  it("não reabre depois que todos os terminais fecharam", () => {
    const { conexoes, fontes } = montar();
    conexoes.sincronizar(new Set(["o1"]));

    fontes[0]?.cair();
    conexoes.sincronizar(new Set());
    vi.advanceTimersByTime(ESPERA_PARA_REABRIR_MS);

    expect(fontes).toHaveLength(1);
  });
});
