import { fireEvent, render, screen, within } from "@testing-library/react";

import type { PluginInstalado } from "../../shared/api/tipos";
import { ConfirmacaoDeHook } from "./ConfirmacaoDeHook";

function plugin(inventario: Partial<PluginInstalado["inventario"]> = {}): PluginInstalado {
  return {
    id: "apollo-skills@claude-plugins-official",
    nome: "apollo-skills",
    marketplace: "claude-plugins-official",
    oficial: true,
    versao: null,
    ligado: false,
    instaladoEm: null,
    inventario: {
      skills: Array.from({ length: 9 }, (_, indice) => ({ nome: `skill-${indice}`, descricao: "" })),
      subagentes: 0,
      servidoresMcp: 1,
      hooks: 1,
      verificado: true,
      temBin: false,
      ...inventario,
    },
  };
}

function montar(extras: Partial<Parameters<typeof ConfirmacaoDeHook>[0]> = {}) {
  const chamadas = { aoLigar: vi.fn(), aoManterDesligado: vi.fn() };
  render(
    <ConfirmacaoDeHook
      plugin={plugin()}
      fonte="github.com/apollographql/skills"
      recemInstalado
      ocupado={false}
      erro={null}
      {...chamadas}
      {...extras}
    />,
  );
  return chamadas;
}

describe("ConfirmacaoDeHook", () => {
  it("é um diálogo modal calmo: título, o motivo (hook), os números do que veio e as duas saídas", () => {
    montar();

    const dialogo = screen.getByRole("dialog", { name: "apollo-skills foi instalado e está desligado" });
    expect(dialogo).toHaveAttribute("aria-modal", "true");
    expect(dialogo).toHaveAccessibleDescription("Ele espera o seu ok antes de rodar.");
    const tiles = within(screen.getByRole("group", { name: "O que vem dentro" }));
    expect(tiles.getByText("9")).toBeInTheDocument();
    expect(tiles.getByText("skills")).toBeInTheDocument();
    expect(tiles.getByText("subagentes")).toBeInTheDocument();
    expect(tiles.getByText("servidor MCP")).toBeInTheDocument();
    expect(tiles.getByText("hook")).toBeInTheDocument();
    const motivos = within(screen.getByRole("list", { name: "Motivos para confirmar" }));
    expect(motivos.getAllByRole("listitem")).toHaveLength(1);
    expect(motivos.getByText("Roda comandos sozinho ao abrir sessões (1 hook)")).toBeInTheDocument();
    expect(screen.getByText("Ligue se você confia em quem publicou.")).toBeInTheDocument();
    expect(screen.getByText("As 9 skills valem nos orquestradores com nível de edição.")).toBeInTheDocument();
    expect(screen.getByText("O servidor MCP só funciona no terminal. Os orquestradores do app não o usam.")).toBeInTheDocument();
    expect(screen.getByText("Você pode ligar ou desligar quando quiser, em Instaladas.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Manter desligado" })).toHaveFocus();
    expect(screen.getByRole("button", { name: "Ligar o plugin" })).toBeInTheDocument();
  });

  it("ajusta os plurais e some com as notas que não valem (sem skills, sem servidor MCP)", () => {
    montar({ plugin: plugin({ skills: [{ nome: "uma", descricao: "" }], servidoresMcp: 0, hooks: 2 }) });

    expect(screen.getByText("A skill vale nos orquestradores com nível de edição.")).toBeInTheDocument();
    expect(screen.queryByText(/servidor MCP só funciona/)).not.toBeInTheDocument();
    expect(screen.getByText("hooks")).toBeInTheDocument();
    expect(screen.getByText("Roda comandos sozinho ao abrir sessões (2 hooks)")).toBeInTheDocument();
  });

  it("pasta bin sozinha: o motivo é o dos programas próprios, sem falar de hook", () => {
    montar({ plugin: plugin({ hooks: 0, temBin: true }) });

    const motivos = within(screen.getByRole("list", { name: "Motivos para confirmar" }));
    expect(motivos.getAllByRole("listitem")).toHaveLength(1);
    expect(motivos.getByText("Traz programas próprios que o terminal dos agentes pode chamar (pasta bin)")).toBeInTheDocument();
    expect(screen.queryByText(/Roda comandos sozinho/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Não conseguimos ler/)).not.toBeInTheDocument();
  });

  it("inventário não verificado sozinho: o motivo é que não deu para ler tudo", () => {
    montar({ plugin: plugin({ hooks: 0, verificado: false }) });

    const motivos = within(screen.getByRole("list", { name: "Motivos para confirmar" }));
    expect(motivos.getAllByRole("listitem")).toHaveLength(1);
    expect(motivos.getByText("Não conseguimos ler tudo o que vem nele")).toBeInTheDocument();
    expect(screen.queryByText(/Roda comandos sozinho/)).not.toBeInTheDocument();
    expect(screen.queryByText(/pasta bin/)).not.toBeInTheDocument();
  });

  it("os três motivos juntos aparecem na ordem: hooks, bin, não verificado", () => {
    montar({ plugin: plugin({ hooks: 2, temBin: true, verificado: false }) });

    const itens = within(screen.getByRole("list", { name: "Motivos para confirmar" })).getAllByRole("listitem");
    expect(itens).toHaveLength(3);
    expect(itens[0]).toHaveTextContent("Roda comandos sozinho ao abrir sessões (2 hooks)");
    expect(itens[1]).toHaveTextContent("Traz programas próprios que o terminal dos agentes pode chamar (pasta bin)");
    expect(itens[2]).toHaveTextContent("Não conseguimos ler tudo o que vem nele");
  });

  it("os botões chamam o que dizem, e o Esc equivale a manter desligado", () => {
    const { aoLigar, aoManterDesligado } = montar();

    fireEvent.click(screen.getByRole("button", { name: "Ligar o plugin" }));
    expect(aoLigar).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Manter desligado" }));
    expect(aoManterDesligado).toHaveBeenCalledTimes(1);
    const naoPropagou = fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(naoPropagou).toBe(false);
    expect(aoManterDesligado).toHaveBeenCalledTimes(2);
  });

  it("ligando, os botões esperam; o Esc não dispensa no meio", () => {
    const { aoManterDesligado } = montar({ ocupado: true });

    expect(screen.getByRole("button", { name: "Ligando…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Manter desligado" })).toBeDisabled();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(aoManterDesligado).not.toHaveBeenCalled();
  });

  it("o Tab fica dentro do diálogo: do último volta ao primeiro, do primeiro com Shift vai ao último", () => {
    montar();
    const ver = screen.getByRole("link", { name: /Ver o código/ });
    const ligar = screen.getByRole("button", { name: "Ligar o plugin" });

    ligar.focus();
    fireEvent.keyDown(ligar, { key: "Tab" });
    expect(ver).toHaveFocus();

    fireEvent.keyDown(ver, { key: "Tab", shiftKey: true });
    expect(ligar).toHaveFocus();
  });

  it("sem fonte conhecida, não há Ver o código; com erro, ele aparece no diálogo", () => {
    montar({ fonte: null, erro: "O Claude Code falhou." });

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("O Claude Code falhou.");
  });
});
