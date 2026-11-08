import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";

import { api } from "../../shared/api/cliente";
import { CHAVE_DAS_PREFERENCIAS_DA_TELA, usePreferenciasDaTela } from "../../shared/hooks/usePreferenciasDaTela";
import { BotaoDeArquivos } from "./BotaoDeArquivos";

vi.mock("../../shared/destaqueComShiki", () => ({
  prepararDestacador: vi.fn(async () => ({})),
  destacar: vi.fn(async () => []),
}));

beforeEach(() => {
  vi.spyOn(api, "listarArquivos").mockResolvedValue({ caminho: "", entradas: [], truncada: false });
});

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("BotaoDeArquivos", () => {
  it("não aparece com o visualizador de código desligado (o padrão)", () => {
    render(<BotaoDeArquivos orquestradorId="o1" nomeDoOrquestrador="Painel" />);

    expect(screen.queryByRole("button", { name: "Arquivos" })).toBeNull();
  });

  it("aparece com a preferência ligada e abre o visualizador", async () => {
    localStorage.setItem(CHAVE_DAS_PREFERENCIAS_DA_TELA, JSON.stringify({ visualizadorDeCodigo: true }));
    render(<BotaoDeArquivos orquestradorId="o1" nomeDoOrquestrador="Painel" />);
    const botao = screen.getByRole("button", { name: "Arquivos" });

    fireEvent.click(botao);

    expect(screen.getByRole("dialog", { name: "Arquivos" })).toBeInTheDocument();
    expect(botao).toHaveAttribute("aria-expanded", "true");
    expect(await screen.findByText("pasta vazia")).toBeInTheDocument();
    expect(api.listarArquivos).toHaveBeenCalledWith("o1", "");

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("some e volta na hora quando a preferência muda", () => {
    render(<BotaoDeArquivos orquestradorId="o1" />);
    const { result } = renderHook(() => usePreferenciasDaTela());

    act(() => result.current.mudarPreferencias({ visualizadorDeCodigo: true }));
    expect(screen.getByRole("button", { name: "Arquivos" })).toBeInTheDocument();

    act(() => result.current.mudarPreferencias({ visualizadorDeCodigo: false }));
    expect(screen.queryByRole("button", { name: "Arquivos" })).toBeNull();
  });
});
