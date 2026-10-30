import { act, render } from "@testing-library/react";

import { ESTADO_INICIAL } from "../estado/aplicarEvento";
import type { EstadoDoServidor } from "../hooks/useServidor";
import {
  ProvedorDoCanvas,
  servidorParaOsNos,
  useCanvas,
  useConversaDoCanvas,
  type ValorDoCanvas,
} from "./contexto";

const servidor: EstadoDoServidor = { conectado: true, caiuEm: null, voltouEm: null, reiniciou: false, memoria: null };

function valorDoCanvas(alteracoes: Partial<ValorDoCanvas> = {}): ValorDoCanvas {
  return {
    orquestradores: new Map(),
    conversas: new Map([
      ["o1", ESTADO_INICIAL],
      ["o2", ESTADO_INICIAL],
    ]),
    conexoes: new Map(),
    sinais: new Map(),
    bixinhosLimpos: new Map(),
    servidor,
    acoes: {
      abrirTerminal: vi.fn(),
      fecharTerminal: vi.fn(),
      limparBixinhos: vi.fn(),
      orquestradorCriado: vi.fn(),
      descartarRascunho: vi.fn(),
      recarregar: vi.fn(async () => undefined),
    },
    ...alteracoes,
  };
}

describe("ProvedorDoCanvas", () => {
  it("quem lê só a própria conversa não re-renderiza com eventos de outra", () => {
    const renderizacoes = { o1: 0, todos: 0 };
    function LeitorDaConversa() {
      useConversaDoCanvas("o1");
      renderizacoes.o1 += 1;
      return null;
    }
    function LeitorDeTudo() {
      useCanvas();
      renderizacoes.todos += 1;
      return null;
    }
    const lista = (
      <>
        <LeitorDaConversa />
        <LeitorDeTudo />
      </>
    );
    const inicial = valorDoCanvas();
    const { rerender } = render(<ProvedorDoCanvas valor={inicial}>{lista}</ProvedorDoCanvas>);
    expect(renderizacoes).toEqual({ o1: 1, todos: 1 });

    // Um evento na conversa de o2: o1 continua o mesmo objeto.
    const outroEvento = { ...inicial, conversas: new Map(inicial.conversas).set("o2", { ...ESTADO_INICIAL }) };
    act(() => rerender(<ProvedorDoCanvas valor={outroEvento}>{lista}</ProvedorDoCanvas>));
    expect(renderizacoes).toEqual({ o1: 1, todos: 2 });

    const eventoDeO1 = { ...outroEvento, conversas: new Map(outroEvento.conversas).set("o1", { ...ESTADO_INICIAL }) };
    act(() => rerender(<ProvedorDoCanvas valor={eventoDeO1}>{lista}</ProvedorDoCanvas>));
    expect(renderizacoes.o1).toBe(2);
  });
});

describe("servidorParaOsNos", () => {
  const leitura = (livreBytes: number, porOrquestrador: Record<string, number>) => ({
    totalBytes: 16,
    livreBytes,
    servidorBytes: 1,
    agentesBytes: 0,
    porOrquestrador,
    lidaEm: `leitura-${livreBytes}`,
  });

  it("a memória livre do computador mudando sozinha não troca o estado que os nós leem", () => {
    const anterior = { ...servidor, memoria: leitura(8, {}) };

    expect(servidorParaOsNos(anterior, { ...servidor, memoria: leitura(7, {}) })).toBe(anterior);
  });

  it("troca quando muda a memória de um Orquestrador ou a conexão", () => {
    const anterior = { ...servidor, memoria: leitura(8, { o1: 100 }) };
    const outraMemoria = { ...servidor, memoria: leitura(8, { o1: 200 }) };
    const caiu = { ...anterior, conectado: false, caiuEm: new Date() };

    expect(servidorParaOsNos(anterior, outraMemoria)).toBe(outraMemoria);
    expect(servidorParaOsNos(anterior, caiu)).toBe(caiu);
    expect(servidorParaOsNos(anterior, { ...servidor, memoria: null })).not.toBe(anterior);
  });
});
