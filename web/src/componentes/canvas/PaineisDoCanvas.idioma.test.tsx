import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { api } from "../../shared/api/cliente";
import type { PluginInstalado } from "../../shared/api/tipos";
import { definirIdioma } from "../../shared/idioma/idioma";
import { ConfirmacaoDeHook } from "./ConfirmacaoDeHook";
import { PainelDeSubagentes } from "./PainelDeSubagentes";

describe("Painéis do canvas: inglês", () => {
  beforeEach(() => {
    definirIdioma("en");
  });
  afterEach(() => {
    vi.restoreAllMocks();
    definirIdioma("pt-BR");
  });

  it("PainelDeSubagentes: lista, campos e problemas em inglês", async () => {
    vi.spyOn(api, "lerPreferencias").mockResolvedValue({
      instrucoesPadrao: "",
      subagentesProntos: [{ nome: "reviewer", descricao: "Reviews code.", prompt: "Find bugs.", modelo: "herdar" }],
    });
    render(<PainelDeSubagentes aoFechar={vi.fn()} aoSalvar={vi.fn()} />);

    expect(await screen.findByRole("heading", { name: "Ready-made subagents" })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("loading…")).not.toBeInTheDocument());
    expect(screen.getByRole("list", { name: "List of subagents" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Model" })).toHaveDisplayValue("Inherit from orchestrator");
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "" } });
    expect(screen.getAllByText("To save, give it a name.").length).toBeGreaterThan(0);
    expect(screen.queryByText("Subagentes prontos")).not.toBeInTheDocument();
  });

  it("ConfirmacaoDeHook: título, motivos e botões em inglês", () => {
    const plugin: PluginInstalado = {
      id: "apollo-skills@claude-plugins-official",
      nome: "apollo-skills",
      marketplace: "claude-plugins-official",
      oficial: true,
      versao: null,
      ligado: false,
      instaladoEm: null,
      inventario: { skills: [{ nome: "a", descricao: "" }], subagentes: 0, servidoresMcp: 1, hooks: 2, verificado: true, temBin: false },
    };
    render(
      <ConfirmacaoDeHook plugin={plugin} fonte={null} recemInstalado ocupado={false} erro={null} aoLigar={vi.fn()} aoManterDesligado={vi.fn()} />,
    );

    expect(screen.getByRole("dialog", { name: "apollo-skills was installed and is off" })).toBeInTheDocument();
    expect(screen.getByText("Why it waits for your go-ahead")).toBeInTheDocument();
    expect(screen.getByText("Runs commands on its own when sessions start (2 hooks)")).toBeInTheDocument();
    expect(screen.getByText("The skill applies in orchestrators at an editing level.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Keep off" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Turn on the plugin" })).toBeInTheDocument();
  });
});
