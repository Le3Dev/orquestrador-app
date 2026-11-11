import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { api, ErroDaApi } from "../../shared/api/cliente";
import type { PluginInstalado } from "../../shared/api/tipos";
import { LinhaDoPluginInstalado } from "./PluginInstalado";

function plugin(extras: Partial<PluginInstalado> = {}): PluginInstalado {
  return {
    id: "logo-design@claude-plugins-official",
    nome: "logo-design",
    marketplace: "claude-plugins-official",
    oficial: true,
    versao: "1.2.0",
    ligado: true,
    instaladoEm: null,
    inventario: {
      skills: [
        { nome: "criar-logo", descricao: "Cria logotipos com variações" },
        { nome: "justificar", descricao: "" },
      ],
      subagentes: 1,
      servidoresMcp: 0,
      hooks: 0,
      verificado: true,
      temBin: false,
    },
    ...extras,
  };
}

function montar(dados: PluginInstalado = plugin()) {
  const chamadas = { aoAlterar: vi.fn(), aoRemovido: vi.fn(), aoPedirConfirmacao: vi.fn() };
  render(<LinhaDoPluginInstalado plugin={dados} {...chamadas} />);
  return chamadas;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("LinhaDoPluginInstalado", () => {
  it("mostra o nome, o resumo do que há dentro, o interruptor ligado e a lixeira", () => {
    montar();

    expect(screen.getByRole("button", { name: "logo-design" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("2 skills · 1 subagente")).toBeInTheDocument();
    const interruptor = screen.getByRole("switch", { name: "Desligar logo-design" });
    expect(interruptor).toHaveAttribute("aria-checked", "true");
    expect(interruptor).toHaveTextContent("Ligado");
    expect(screen.getByRole("button", { name: "Remover logo-design" })).toBeInTheDocument();
    expect(screen.queryByText(/hook/)).not.toBeInTheDocument();
  });

  it("o resumo cita os servidores MCP quando há, e o selo conta os hooks", () => {
    montar(plugin({ inventario: { skills: [], subagentes: 0, servidoresMcp: 2, hooks: 1, verificado: true, temBin: false } }));

    expect(screen.getByText("0 skills · 0 subagentes · 2 servidores MCP")).toBeInTheDocument();
    expect(screen.getByText("1 hook")).toBeInTheDocument();
  });

  it("clicar no nome abre as skills do plugin e clicar de novo esconde", () => {
    montar();
    expect(screen.queryByRole("list", { name: "Skills de logo-design" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "logo-design" }));

    const lista = screen.getByRole("list", { name: "Skills de logo-design" });
    expect(screen.getByRole("button", { name: "logo-design" })).toHaveAttribute("aria-expanded", "true");
    expect(within(lista).getByText("criar-logo")).toBeInTheDocument();
    expect(within(lista).getByText("Cria logotipos com variações")).toBeInTheDocument();
    expect(within(lista).getByText("Sem descrição.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "logo-design" }));
    expect(screen.queryByRole("list", { name: "Skills de logo-design" })).not.toBeInTheDocument();
  });

  it("um plugin sem skills diz isso ao abrir", () => {
    montar(plugin({ inventario: { skills: [], subagentes: 1, servidoresMcp: 0, hooks: 0, verificado: true, temBin: false } }));

    fireEvent.click(screen.getByRole("button", { name: "logo-design" }));

    expect(screen.getByText("Este plugin não traz skills.")).toBeInTheDocument();
  });

  it("desligar chama a API e devolve o plugin atualizado", async () => {
    const desligado = plugin({ ligado: false });
    const desligar = vi.spyOn(api, "desligarPlugin").mockResolvedValue({ plugin: desligado });
    const chamadas = montar();

    fireEvent.click(screen.getByRole("switch", { name: "Desligar logo-design" }));

    await waitFor(() => expect(chamadas.aoAlterar).toHaveBeenCalledWith(desligado));
    expect(desligar).toHaveBeenCalledWith("logo-design@claude-plugins-official");
  });

  it("ligar um plugin sem hook chama a API direto, sem confirmação", async () => {
    const ligado = plugin({ ligado: true });
    const ligar = vi.spyOn(api, "ligarPlugin").mockResolvedValue({ plugin: ligado });
    const chamadas = montar(plugin({ ligado: false }));
    const interruptor = screen.getByRole("switch", { name: "Ligar logo-design" });
    expect(interruptor).toHaveAttribute("aria-checked", "false");
    expect(interruptor).toHaveTextContent("Desligado");

    fireEvent.click(interruptor);

    await waitFor(() => expect(chamadas.aoAlterar).toHaveBeenCalledWith(ligado));
    expect(ligar).toHaveBeenCalledWith("logo-design@claude-plugins-official");
    expect(chamadas.aoPedirConfirmacao).not.toHaveBeenCalled();
  });

  it("plugin com hook desligado pede confirmação: o interruptor dá lugar a Revisar e ligar, sem ligar sozinho", () => {
    const ligar = vi.spyOn(api, "ligarPlugin");
    const comHook = plugin({
      nome: "apollo-skills",
      id: "apollo-skills@claude-plugins-official",
      ligado: false,
      inventario: { skills: [], subagentes: 0, servidoresMcp: 1, hooks: 1, verificado: true, temBin: false },
    });
    const chamadas = montar(comHook);

    expect(screen.getByText("Pede sua confirmação")).toBeInTheDocument();
    expect(screen.getByText("1 hook")).toBeInTheDocument();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Revisar e ligar" }));

    expect(chamadas.aoPedirConfirmacao).toHaveBeenCalledWith(comHook);
    expect(ligar).not.toHaveBeenCalled();
  });

  it.each([
    ["pasta bin", { hooks: 0, temBin: true, verificado: true }, "Traz programas próprios que o terminal dos agentes pode chamar (pasta bin)"],
    ["inventário não verificado", { hooks: 0, temBin: false, verificado: false }, "Não conseguimos ler tudo o que vem nele"],
  ])("plugin desligado com %s também pede confirmação, sem ligar sozinho", (_nome, extras, motivo) => {
    const ligar = vi.spyOn(api, "ligarPlugin");
    const dados = plugin({ ligado: false, inventario: { ...plugin().inventario, ...extras } });
    const chamadas = montar(dados);

    expect(screen.getByText("Pede sua confirmação")).toBeInTheDocument();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Revisar e ligar" }));

    expect(chamadas.aoPedirConfirmacao).toHaveBeenCalledWith(dados);
    expect(ligar).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "logo-design" }));
    expect(within(screen.getByRole("list", { name: "Por que logo-design pede confirmação" })).getByText(motivo)).toBeInTheDocument();
  });

  it("o selo Não verificado aparece só quando a leitura não foi completa, e o detalhe lista os três motivos", () => {
    const { unmount } = render(
      <LinhaDoPluginInstalado plugin={plugin()} aoAlterar={vi.fn()} aoRemovido={vi.fn()} aoPedirConfirmacao={vi.fn()} />,
    );
    expect(screen.queryByText("Não verificado")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "logo-design" }));
    expect(screen.queryByRole("list", { name: "Por que logo-design pede confirmação" })).not.toBeInTheDocument();
    unmount();

    montar(plugin({ inventario: { ...plugin().inventario, hooks: 2, temBin: true, verificado: false } }));
    expect(screen.getByText("Não verificado")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "logo-design" }));
    const itens = within(screen.getByRole("list", { name: "Por que logo-design pede confirmação" })).getAllByRole("listitem");
    expect(itens.map((item) => item.getAttribute("data-motivo"))).toEqual(["hooks", "bin", "naoVerificado"]);
  });

  it("plugin com hook ligado tem o interruptor, e desligar é direto", async () => {
    const comHook = plugin({ inventario: { skills: [], subagentes: 0, servidoresMcp: 0, hooks: 2, verificado: true, temBin: false } });
    const desligar = vi.spyOn(api, "desligarPlugin").mockResolvedValue({ plugin: { ...comHook, ligado: false } });
    const chamadas = montar(comHook);

    expect(screen.getByText("2 hooks")).toBeInTheDocument();
    expect(screen.queryByText("Pede sua confirmação")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch", { name: "Desligar logo-design" }));

    await waitFor(() => expect(chamadas.aoAlterar).toHaveBeenCalledTimes(1));
    expect(desligar).toHaveBeenCalledTimes(1);
  });

  it("mostra a mensagem do servidor quando ligar ou desligar falha, e o interruptor volta a responder", async () => {
    vi.spyOn(api, "desligarPlugin").mockRejectedValue(new ErroDaApi("O Claude Code não respondeu.", 502));
    const chamadas = montar();

    fireEvent.click(screen.getByRole("switch", { name: "Desligar logo-design" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("O Claude Code não respondeu.");
    expect(chamadas.aoAlterar).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole("switch")).toHaveAttribute("aria-disabled", "false"));
  });

  it("remover pede confirmação na própria linha, com o foco em Cancelar, e cancelar devolve a linha e o foco à lixeira", () => {
    const remover = vi.spyOn(api, "removerPlugin");
    montar();

    fireEvent.click(screen.getByRole("button", { name: "Remover logo-design" }));

    const pergunta = screen.getByRole("alertdialog", { name: "Remover logo-design" });
    expect(within(pergunta).getByText("Remover logo-design?")).toBeInTheDocument();
    expect(within(pergunta).getByText("Ele sai também do seu terminal. Dá para instalar de novo depois.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancelar" })).toHaveFocus();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Desligar logo-design" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remover logo-design" })).toHaveFocus();
    expect(remover).not.toHaveBeenCalled();
  });

  it("confirmar a remoção chama a API e avisa quem manda na lista", async () => {
    const remover = vi.spyOn(api, "removerPlugin").mockResolvedValue(null);
    const chamadas = montar();

    fireEvent.click(screen.getByRole("button", { name: "Remover logo-design" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Remover" }));

    await waitFor(() => expect(chamadas.aoRemovido).toHaveBeenCalledWith("logo-design@claude-plugins-official"));
    expect(remover).toHaveBeenCalledWith("logo-design@claude-plugins-official");
  });

  it("se a remoção falha, a pergunta segue na tela com o erro", async () => {
    vi.spyOn(api, "removerPlugin").mockRejectedValue(new ErroDaApi("Outra instalação está em andamento.", 409));
    const chamadas = montar();

    fireEvent.click(screen.getByRole("button", { name: "Remover logo-design" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Remover" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Outra instalação está em andamento.");
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(chamadas.aoRemovido).not.toHaveBeenCalled();
    expect(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Remover" })).toBeEnabled();
  });
});
