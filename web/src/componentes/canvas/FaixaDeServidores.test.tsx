import { act, fireEvent, render, screen } from "@testing-library/react";
import type { MockInstance } from "vitest";

import { api } from "../../shared/api/cliente";
import type { SituacaoDoServidorLocal } from "../../shared/api/tipos";
import { lerServidoresTirados } from "../../shared/canvas/layout";
import { FaixaDeServidores } from "./FaixaDeServidores";

const A = "http://localhost:3100";
const B = "http://localhost:5173";
const C = "http://localhost:4000";
const D = "http://localhost:4500";
const E = "http://localhost:4600";

type Situacoes = Record<string, boolean>;

/** A resposta simulada da rota: o que não está em `situacoes` responde "no ar". */
let situacoes: Situacoes;
let consulta: MockInstance<typeof api.lerSituacaoDosServidores>;

function sequenciasDe(...urls: string[]): Record<string, number> {
  return Object.fromEntries(urls.map((url, indice) => [url, indice + 1]));
}

function desenharSemEsperar(
  enderecos: readonly string[],
  extras: { sequencias?: Record<string, number>; aoAbrir?: (url: string) => void } = {},
) {
  const propriedades = {
    orquestradorId: "o1",
    enderecos,
    sequencias: extras.sequencias ?? sequenciasDe(...enderecos),
    aoAbrir: extras.aoAbrir ?? (() => undefined),
  };
  const resultado = render(<FaixaDeServidores {...propriedades} />);
  return {
    ...resultado,
    atualizar: (novas: Partial<typeof propriedades>) =>
      resultado.rerender(<FaixaDeServidores {...propriedades} {...novas} />),
  };
}

/** Deixa a consulta pendente terminar e a tela atualizar. */
async function esperarConsulta() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

/** Monta a faixa e espera a primeira consulta terminar. */
async function desenhar(...argumentos: Parameters<typeof desenharSemEsperar>) {
  const resultado = desenharSemEsperar(...argumentos);
  await esperarConsulta();
  return resultado;
}

async function passar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function mudarVisibilidade(estado: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => estado });
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  situacoes = {};
  consulta = vi.spyOn(api, "lerSituacaoDosServidores").mockImplementation((urls) =>
    Promise.resolve({
      situacoes: urls.map((url): SituacaoDoServidorLocal => ({ url, noAr: situacoes[url] ?? true })),
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  mudarVisibilidade("visible");
});

describe("FaixaDeServidores", () => {
  it("sem servidores, a faixa some e nada é consultado", async () => {
    const { container } = await desenhar([]);
    await esperarConsulta();

    expect(container).toBeEmptyDOMElement();
    expect(consulta).not.toHaveBeenCalled();
  });

  it("mostra o rótulo e um chip por servidor, o mais recente primeiro, com o endereço curto e o título inteiro", async () => {
    await desenhar([A, B]);
    await esperarConsulta();

    expect(screen.getByText("Servidores")).toBeInTheDocument();
    const chips = screen.getAllByRole("button", { name: /^Abrir prévia de / });
    expect(chips.map((chip) => chip.getAttribute("aria-label"))).toEqual([`Abrir prévia de ${B}`, `Abrir prévia de ${A}`]);
    expect(screen.getByText("localhost:5173")).toHaveAttribute("title", B);
  });

  it("antes da primeira resposta o ponto é neutro e a ação é abrir; clicar no chip abre a prévia", async () => {
    const aoAbrir = vi.fn();
    desenharSemEsperar([A], { aoAbrir });

    const chip = screen.getByRole("button", { name: `Abrir prévia de ${A}` });
    expect(chip.parentElement).toHaveAttribute("data-situacao", "desconhecida");
    expect(chip).toHaveTextContent("abrir");

    fireEvent.click(chip);
    expect(aoAbrir).toHaveBeenCalledWith(A);
    await esperarConsulta();
  });

  it("consulta a rota ao montar e marca no ar e parado; o parado mostra \"parado\" e ainda abre a prévia", async () => {
    situacoes = { [B]: false };
    const aoAbrir = vi.fn();
    await desenhar([A, B], { aoAbrir });
    await esperarConsulta();

    expect(consulta).toHaveBeenCalledTimes(1);
    expect(consulta).toHaveBeenCalledWith([B, A]);
    const noAr = screen.getByRole("button", { name: `Abrir prévia de ${A}` });
    const parado = screen.getByRole("button", { name: `Abrir prévia de ${B} (servidor parado)` });
    expect(noAr.parentElement).toHaveAttribute("data-situacao", "no-ar");
    expect(noAr).toHaveTextContent("abrir");
    expect(parado.parentElement).toHaveAttribute("data-situacao", "parado");
    expect(parado).toHaveTextContent("parado");

    fireEvent.click(parado);
    expect(aoAbrir).toHaveBeenCalledWith(B);
  });

  it("repete a consulta a cada 15 segundos e acompanha a mudança de situação", async () => {
    await desenhar([A]);
    await esperarConsulta();
    expect(screen.getByRole("button", { name: `Abrir prévia de ${A}` }).parentElement).toHaveAttribute("data-situacao", "no-ar");

    situacoes = { [A]: false };
    await passar(14_000);
    expect(consulta).toHaveBeenCalledTimes(1);
    await passar(1_000);

    expect(consulta).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button", { name: `Abrir prévia de ${A} (servidor parado)` })).toBeInTheDocument();
  });

  it("erro de rede mantém o último estado", async () => {
    situacoes = { [A]: false };
    await desenhar([A]);
    await esperarConsulta();

    consulta.mockRejectedValue(new Error("sem rede"));
    await passar(15_000);

    expect(consulta).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button", { name: `Abrir prévia de ${A} (servidor parado)` })).toBeInTheDocument();
  });

  it("não consulta com a página escondida e consulta logo que ela volta", async () => {
    mudarVisibilidade("hidden");
    await desenhar([A]);
    await passar(45_000);
    expect(consulta).not.toHaveBeenCalled();

    mudarVisibilidade("visible");
    await esperarConsulta();
    expect(consulta).toHaveBeenCalledTimes(1);
  });

  it("para de consultar ao desmontar", async () => {
    const { unmount } = await desenhar([A]);
    await esperarConsulta();
    unmount();
    await passar(60_000);

    expect(consulta).toHaveBeenCalledTimes(1);
  });

  it("consulta de novo, logo, quando a lista muda", async () => {
    const { atualizar } = await desenhar([A]);
    await esperarConsulta();

    atualizar({ enderecos: [A, B], sequencias: sequenciasDe(A, B) });
    await esperarConsulta();

    expect(consulta).toHaveBeenCalledTimes(2);
    expect(consulta).toHaveBeenLastCalledWith([B, A]);
  });

  it("o × tira só aquele servidor, guarda por Orquestrador e a faixa some quando não sobra nenhum", async () => {
    const { container } = await desenhar([A, B]);
    await esperarConsulta();

    fireEvent.click(screen.getByRole("button", { name: `Tirar ${B} da lista` }));
    expect(screen.queryByRole("button", { name: `Abrir prévia de ${B}` })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: `Abrir prévia de ${A}` })).toBeInTheDocument();
    expect(lerServidoresTirados("o1")).toEqual({ [B]: 2 });

    fireEvent.click(screen.getByRole("button", { name: `Tirar ${A} da lista` }));
    expect(container).toBeEmptyDOMElement();
  });

  it("o × tem o título \"Tirar da lista\"", async () => {
    await desenhar([A]);
    await esperarConsulta();

    expect(screen.getByRole("button", { name: `Tirar ${A} da lista` })).toHaveAttribute("title", "Tirar da lista");
  });

  it("\"Limpar\" tira todos, inclusive os do +N", async () => {
    const { container } = await desenhar([A, B, C, D, E]);

    fireEvent.click(screen.getByRole("button", { name: "Tirar todos os servidores da lista" }));

    expect(container).toBeEmptyDOMElement();
    expect(Object.keys(lerServidoresTirados("o1")).sort()).toEqual([A, B, C, D, E].sort());
  });

  it("mostra três chips e um +N; ao clicar, mostra os demais e dá para recolher", async () => {
    await desenhar([A, B, C, D, E]);

    expect(screen.getAllByRole("button", { name: /^Abrir prévia de / })).toHaveLength(3);
    const mais = screen.getByRole("button", { name: "Mostrar mais 2 servidores" });
    expect(mais).toHaveTextContent("+2");
    expect(mais).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(mais);
    expect(screen.getAllByRole("button", { name: /^Abrir prévia de / })).toHaveLength(5);
    const menos = screen.getByRole("button", { name: "Mostrar menos servidores" });
    expect(menos).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(menos);
    expect(screen.getAllByRole("button", { name: /^Abrir prévia de / })).toHaveLength(3);
  });

  it("um chip do +N também se tira, e o +N some quando já cabem todos", async () => {
    await desenhar([A, B, C, D]);
    fireEvent.click(screen.getByRole("button", { name: "Mostrar mais 1 servidores" }));

    fireEvent.click(screen.getByRole("button", { name: `Tirar ${A} da lista` }));

    expect(screen.queryByRole("button", { name: /Mostrar (mais|menos)/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Abrir prévia de / })).toHaveLength(3);
    await esperarConsulta();
  });

  it("ignora endereços com $, { ou } (lixo de código de históricos antigos)", async () => {
    await desenhar([A, "http://localhost:4391/ilha-teste-tmp.html?v=${v", "http://localhost:3101/{id}"]);

    expect(screen.getAllByRole("button", { name: /^Abrir prévia de / })).toHaveLength(1);
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
  });

  it("não lista a própria tela", async () => {
    await desenhar([A, window.location.origin]);

    expect(screen.getAllByRole("button", { name: /^Abrir prévia de / })).toHaveLength(1);
  });

  it("servidor parado por mais de 5 minutos seguidos sai sozinho da faixa", async () => {
    situacoes = { [A]: false };
    await desenhar([A, B]);
    await esperarConsulta();

    await passar(4 * 60_000 + 45_000);
    expect(screen.getByRole("button", { name: `Abrir prévia de ${A} (servidor parado)` })).toBeInTheDocument();

    await passar(30_000);
    expect(screen.queryByRole("button", { name: /Abrir prévia de http:\/\/localhost:3100/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: `Abrir prévia de ${B}` })).toBeInTheDocument();
    expect(lerServidoresTirados("o1")).toEqual({ [A]: 1 });
  });

  it("voltar a responder zera a contagem dos 5 minutos", async () => {
    situacoes = { [A]: false };
    await desenhar([A]);
    await esperarConsulta();
    await passar(4 * 60_000);

    situacoes = {};
    await passar(15_000);
    situacoes = { [A]: false };
    await passar(4 * 60_000);

    expect(screen.getByRole("button", { name: `Abrir prévia de ${A} (servidor parado)` })).toBeInTheDocument();
  });

  it("o servidor que saiu sozinho volta com um novo anúncio, e o tirado pelo usuário também", async () => {
    situacoes = { [A]: false };
    const { atualizar } = await desenhar([A, B]);
    await esperarConsulta();
    fireEvent.click(screen.getByRole("button", { name: `Tirar ${B} da lista` }));
    await passar(5 * 60_000 + 30_000);
    expect(screen.queryByRole("button", { name: /Abrir prévia/ })).not.toBeInTheDocument();

    // O mesmo anúncio relido (mesma sequência): continua fora.
    atualizar({ enderecos: [A, B], sequencias: sequenciasDe(A, B) });
    expect(screen.queryByRole("button", { name: /Abrir prévia/ })).not.toBeInTheDocument();

    // Anunciados de novo, com sequência maior: voltam.
    situacoes = {};
    atualizar({ enderecos: [B, A], sequencias: { [B]: 10, [A]: 11 } });
    await esperarConsulta();
    expect(screen.getByRole("button", { name: `Abrir prévia de ${A}` })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: `Abrir prévia de ${B}` })).toBeInTheDocument();
  });

  it("lembra o que foi tirado ao montar de novo, só no Orquestrador certo", async () => {
    const primeira = await desenhar([A, B]);
    fireEvent.click(screen.getByRole("button", { name: `Tirar ${A} da lista` }));
    primeira.unmount();

    await desenhar([A, B]);
    expect(screen.queryByRole("button", { name: `Abrir prévia de ${A}` })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: `Abrir prévia de ${B}` })).toBeInTheDocument();
    expect(lerServidoresTirados("outro")).toEqual({});
  });
});
