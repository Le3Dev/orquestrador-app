import { act, fireEvent, render, screen } from "@testing-library/react";

import { api } from "../../shared/api/cliente";
import type { AjustesDoAplicativo } from "../../shared/hooks/useAjustesDoAplicativo";
import { esquecerAutorrecuperacao } from "../../shared/hooks/useAutorrecuperacao";
import { definirIdioma } from "../../shared/idioma/idioma";
import { ConfiguracoesDoApp } from "./ConfiguracoesDoApp";

const ajustes: AjustesDoAplicativo = { disponivel: true, abrir: vi.fn().mockResolvedValue(undefined), erro: null, descartarErro: vi.fn() };

describe("ConfiguracoesDoApp: idioma", () => {
  beforeEach(() => {
    localStorage.clear();
    definirIdioma("pt-BR");
    esquecerAutorrecuperacao();
    vi.spyOn(api, "lerPreferencias").mockResolvedValue({
      instrucoesPadrao: "",
      subagentesProntos: [],
      autorrecuperacao: true,
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    definirIdioma("pt-BR");
    localStorage.clear();
  });

  it("na aba Aparência, escolher English deixa o painel em inglês na hora", async () => {
    render(<ConfiguracoesDoApp ajustes={ajustes} aberto aoFechar={vi.fn()} abaInicial="aparencia" />);
    await act(async () => undefined);
    expect(screen.getByRole("heading", { name: "Configurações" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Português" })).toHaveAttribute("aria-checked", "true");

    fireEvent.click(screen.getByRole("radio", { name: "English" }));

    expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Appearance" })).toBeInTheDocument();
    expect(screen.getByText("Language")).toBeInTheDocument();
    expect(screen.getByText("Chat position")).toBeInTheDocument();
    expect(screen.queryByText("Posição do chat")).not.toBeInTheDocument();
    expect(document.documentElement.lang).toBe("en");

    fireEvent.click(screen.getByRole("radio", { name: "Português" }));
    expect(screen.getByRole("heading", { name: "Configurações" })).toBeInTheDocument();
  });
});
