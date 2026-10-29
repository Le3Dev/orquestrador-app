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

  sinalizar(sinal: SinalDeVida): void {
    for (const ouvinte of this.ouvintesDeSinal) {
      ouvinte(new MessageEvent("sinal", { data: JSON.stringify(sinal) }));
    }
  }

  close(): void {
    this.readyState = 2;
  }

  abrir(): void {
    this.readyState = 1;
    this.onopen?.(new Event("open"));
  }

  /** `abandonou`: o navegador desistiu (resposta de erro); senão, ele mesmo tenta de novo. */
  cair(abandonou: boolean): void {
    this.readyState = abandonou ? 2 : 0;
    this.onerror?.(new Event("error"));
  }

  receber(evento: EventoRegistrado): void {
    this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(evento) }));
  }
}

function montar(ultimaSequencia = 0) {
  const fontes: FonteFalsa[] = [];
  const recebidos: [string, EventoRegistrado][] = [];
  const situacoes: [string, SituacaoDaConexao | null][] = [];
  const sinais: [string, SinalDeVida][] = [];
  const conexoes = new ConexoesDeEventos(
    {
      aoReceber: (id, evento) => recebidos.push([id, evento]),
      aoSinal: (id, sinal) => sinais.push([id, sinal]),
      aoMudarSituacao: (id, situacao) => situacoes.push([id, situacao]),
      ultimaSequencia: () => ultimaSequencia,
    },
    (endereco) => {
      const fonte = new FonteFalsa(endereco);
      fontes.push(fonte);
      return fonte;
    },
  );
  return { conexoes, fontes, recebidos, situacoes, sinais };
}

describe("ConexoesDeEventos", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("abre uma conexão por terminal e fecha a de quem saiu do canvas", () => {
    const { conexoes, fontes, situacoes } = montar();

    conexoes.sincronizar(new Set(["o1", "o2"]));
    conexoes.sincronizar(new Set(["o2"]));

    expect(fontes.map((fonte) => fonte.endereco)).toEqual([
      "/api/orquestradores/o1/eventos",
      "/api/orquestradores/o2/eventos",
    ]);
    expect(fontes[0]?.readyState).toBe(2);
    expect(situacoes).toContainEqual(["o1", null]);
  });

  it("entrega os eventos recebidos com o id do orquestrador", () => {
    const { conexoes, fontes, recebidos, situacoes } = montar();
    conexoes.sincronizar(new Set(["o1"]));

    fontes[0]?.abrir();
    fontes[0]?.receber({ tipo: "turno_cancelado", turnoId: "t1", sequencia: 7, em: "agora" });

    expect(situacoes.at(-1)).toEqual(["o1", "conectado"]);
    expect(recebidos).toEqual([["o1", { tipo: "turno_cancelado", turnoId: "t1", sequencia: 7, em: "agora" }]]);
  });

  it("deixa o navegador reconectar sozinho quando a queda é temporária", () => {
    const { conexoes, fontes } = montar();
    conexoes.sincronizar(new Set(["o1"]));

    fontes[0]?.cair(false);
    vi.advanceTimersByTime(ESPERA_PARA_REABRIR_MS * 3);

    expect(fontes).toHaveLength(1);
  });

  it("reabre sozinho, a partir do último evento, quando o navegador desiste", () => {
    const { conexoes, fontes, situacoes } = montar(42);
    conexoes.sincronizar(new Set(["o1"]));

    fontes[0]?.cair(true);
    expect(situacoes.at(-1)).toEqual(["o1", "reconectando"]);
    vi.advanceTimersByTime(ESPERA_PARA_REABRIR_MS);

    expect(fontes.map((fonte) => fonte.endereco)).toEqual([
      "/api/orquestradores/o1/eventos?desde=42",
      "/api/orquestradores/o1/eventos?desde=42",
    ]);
  });

  it("quando o servidor volta, reabre na hora só as conexões abandonadas", () => {
    const { conexoes, fontes } = montar(5);
    conexoes.sincronizar(new Set(["o1", "o2"]));
    fontes[0]?.cair(true);
    fontes[1]?.abrir();

    conexoes.reabrirAbandonadas();
    vi.advanceTimersByTime(ESPERA_PARA_REABRIR_MS);

    // Só o o1 foi reaberto, e uma vez só: a reabertura agendada foi cancelada.
    expect(fontes.map((fonte) => fonte.endereco)).toEqual([
      "/api/orquestradores/o1/eventos?desde=5",
      "/api/orquestradores/o2/eventos?desde=5",
      "/api/orquestradores/o1/eventos?desde=5",
    ]);
  });

  it("entrega os sinais de vida separados dos eventos do histórico", () => {
    const { conexoes, fontes, recebidos, sinais } = montar();
    conexoes.sincronizar(new Set(["o1"]));

    fontes[0]?.sinalizar({ turnoId: "t1", em: "agora", tokensPensando: 300 });

    expect(sinais).toEqual([["o1", { turnoId: "t1", em: "agora", tokensPensando: 300 }]]);
    expect(recebidos).toEqual([]);
  });

  it("não reabre um terminal que foi fechado enquanto esperava", () => {
    const { conexoes, fontes } = montar();
    conexoes.sincronizar(new Set(["o1"]));

    fontes[0]?.cair(true);
    conexoes.sincronizar(new Set());
    vi.advanceTimersByTime(ESPERA_PARA_REABRIR_MS);

    expect(fontes).toHaveLength(1);
  });
});
