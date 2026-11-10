import { fireEvent, render, screen, within } from "@testing-library/react";

import type { DadosDoSubagentePronto, ResumoDoOrquestrador } from "../../shared/api/tipos";
import { MenuNovo, type PropsDoMenuNovo } from "./MenuNovo";

function orquestrador(id: string, situacao: "trabalhando" | "ocioso", nome = `Orquestrador ${id}`): ResumoDoOrquestrador {
  return {
    id,
    nome,
    pastaDeTrabalho: `/projetos/${id}`,
    nomeDaPasta: `pasta-${id}`,
    situacao,
    configuracao: {
      modeloDoOrquestrador: "opus",
      esforcoDoOrquestrador: "padrao",
      modeloDosSubagentes: "haiku",
      esforcoDosSubagentes: "padrao",
      quantidadeDeSubagentes: { modo: "fixa", limite: 2 },
      nivelDePermissao: "leitura",
      permitirCommitEPush: false,
      instrucoesPersonalizadas: "",
    },
    instrucoesAtivas: null,
    criadoEm: "2026-10-28T12:00:00Z",
    totalDeTurnos: 1,
    ultimoTurno: null,
    worktree: null,
  } as ResumoDoOrquestrador;
}

const SUBAGENTES: DadosDoSubagentePronto[] = [
  { nome: "revisor-de-codigo", descricao: "Revisa um diff e aponta riscos.", prompt: "…", modelo: "sonnet" },
  { nome: "redator", descricao: "Escreve textos curtos.", prompt: "…", modelo: "haiku" },
];

function acoes() {
  return {
    aoCriar: vi.fn(),
    aoCriarNota: vi.fn(),
    aoCriarPrevia: vi.fn(),
    aoCriarShell: vi.fn(),
    aoAbrirModelos: vi.fn(),
    aoBuscar: vi.fn(),
    aoAbrirConfiguracoes: vi.fn(),
    aoEscolherOrquestrador: vi.fn(),
    aoAbrirSubagentes: vi.fn(),
  };
}

function montar(extras: Partial<PropsDoMenuNovo> = {}) {
  const chamadas = acoes();
  const propriedades: PropsDoMenuNovo = {
    ...chamadas,
    orquestradores: [orquestrador("o1", "trabalhando", "Site da padaria"), orquestrador("o2", "ocioso", "API")],
    erroDosOrquestradores: null,
    noCanvas: new Set(["o1"]),
    subagentes: SUBAGENTES,
    ...extras,
  };
  render(
    <>
      <input aria-label="Campo de fora" />
      <MenuNovo {...propriedades} />
    </>,
  );
  return chamadas;
}

const botao = () => screen.getByRole("button", { name: "Novo" });
const menu = () => screen.getByRole("menu", { name: "Novo" });
const item = (nome: string | RegExp) => within(menu()).getByRole("menuitem", { name: nome });

describe("MenuNovo", () => {
  it("fechado, só tem o botão; abre com o foco no primeiro item e os três grupos separados", () => {
    montar();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(botao()).toHaveAttribute("aria-haspopup", "menu");
    expect(botao()).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(botao());

    expect(botao()).toHaveAttribute("aria-expanded", "true");
    expect(botao()).toHaveAttribute("aria-controls", menu().id);
    expect(item("Novo orquestrador")).toHaveFocus();
    expect(within(menu()).getAllByRole("separator")).toHaveLength(2);
    // Grupo 1, grupo 2 (submenus) e grupo 3, na ordem.
    const rotulos = within(menu())
      .getAllByRole("menuitem")
      .map((elemento) => elemento.querySelector(".rotulo-do-menu-novo")?.textContent);
    expect(rotulos).toEqual([
      "Novo orquestrador",
      "Nota",
      "Terminal",
      "Prévia",
      "Orquestradores",
      "Subagentes",
      "Modelos de canvas",
      "Buscar",
      "Configurações",
    ]);
    // O atalho aparece à direita, em mono, só onde existe.
    expect([...menu().querySelectorAll("kbd")].map((atalho) => atalho.textContent)).toEqual([
      "Ctrl+N",
      "Ctrl+Shift+N",
      "Ctrl+K",
    ]);
  });

  it("mostra só os atalhos que existem no app e declara-os em aria-keyshortcuts", () => {
    montar();
    fireEvent.click(botao());

    expect(item("Novo orquestrador")).toHaveAttribute("aria-keyshortcuts", "Control+N");
    expect(item("Nota")).toHaveAttribute("aria-keyshortcuts", "Control+Shift+N");
    expect(item("Buscar")).toHaveAttribute("aria-keyshortcuts", "Control+K");
    expect(item("Terminal")).not.toHaveAttribute("aria-keyshortcuts");
    expect(item("Prévia")).not.toHaveAttribute("aria-keyshortcuts");
    expect(item("Configurações")).not.toHaveAttribute("aria-keyshortcuts");
  });

  it("sem aoCriarShell, o item Terminal não aparece", () => {
    montar({ aoCriarShell: undefined });
    fireEvent.click(botao());

    expect(within(menu()).queryByRole("menuitem", { name: "Terminal" })).not.toBeInTheDocument();
  });

  it.each([
    ["Novo orquestrador", "aoCriar"],
    ["Nota", "aoCriarNota"],
    ["Terminal", "aoCriarShell"],
    ["Prévia", "aoCriarPrevia"],
    ["Modelos de canvas", "aoAbrirModelos"],
    ["Buscar", "aoBuscar"],
    ["Configurações", "aoAbrirConfiguracoes"],
  ] as const)("clicar em %s chama %s, fecha o menu e devolve o foco ao botão", (rotulo, acao) => {
    const chamadas = montar();
    fireEvent.click(botao());

    fireEvent.click(item(rotulo));

    expect(chamadas[acao]).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(botao()).toHaveFocus();
  });

  it("↓ no botão abre no primeiro item e ↑, no último", () => {
    montar();
    fireEvent.keyDown(botao(), { key: "ArrowDown" });
    expect(item("Novo orquestrador")).toHaveFocus();
    fireEvent.keyDown(item("Novo orquestrador"), { key: "Escape" });

    fireEvent.keyDown(botao(), { key: "ArrowUp" });
    expect(item("Configurações")).toHaveFocus();
  });

  it("↑/↓ percorrem os itens (com volta), Home e End vão às pontas e Enter escolhe", () => {
    const chamadas = montar();
    fireEvent.click(botao());

    fireEvent.keyDown(item("Novo orquestrador"), { key: "ArrowDown" });
    expect(item("Nota")).toHaveFocus();
    fireEvent.keyDown(item("Nota"), { key: "ArrowUp" });
    fireEvent.keyDown(item("Novo orquestrador"), { key: "ArrowUp" });
    expect(item("Configurações")).toHaveFocus();
    fireEvent.keyDown(item("Configurações"), { key: "ArrowDown" });
    expect(item("Novo orquestrador")).toHaveFocus();
    fireEvent.keyDown(item("Novo orquestrador"), { key: "End" });
    expect(item("Configurações")).toHaveFocus();
    fireEvent.keyDown(item("Configurações"), { key: "Home" });
    fireEvent.keyDown(item("Novo orquestrador"), { key: "ArrowDown" });

    fireEvent.keyDown(item("Nota"), { key: "Enter" });

    expect(chamadas.aoCriarNota).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("Esc fecha sem escolher e o foco volta ao botão; Tab também fecha", () => {
    const chamadas = montar();
    fireEvent.click(botao());
    fireEvent.keyDown(item("Nota"), { key: "Escape" });

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(botao()).toHaveFocus();
    expect(chamadas.aoCriarNota).not.toHaveBeenCalled();

    fireEvent.click(botao());
    fireEvent.keyDown(item("Novo orquestrador"), { key: "Tab" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("clique fora fecha; clique dentro do menu (num separador) não", () => {
    montar();
    fireEvent.click(botao());
    fireEvent.mouseDown(within(menu()).getAllByRole("separator")[0]!);
    expect(screen.getByRole("menu", { name: "Novo" })).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByRole("textbox", { name: "Campo de fora" }));

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  describe("submenu Orquestradores", () => {
    it("passar o mouse abre o segundo painel à direita, com situação, nome, pasta e se está no canvas", () => {
      montar();
      fireEvent.click(botao());
      const pai = item(/^Orquestradores/);
      expect(pai).toHaveAttribute("aria-haspopup", "menu");
      expect(pai).toHaveAttribute("aria-expanded", "false");
      expect(pai).toHaveTextContent("2");

      fireEvent.mouseEnter(pai.parentElement!);

      expect(pai).toHaveAttribute("aria-expanded", "true");
      const submenu = screen.getByRole("menu", { name: "Orquestradores" });
      expect(pai).toHaveAttribute("aria-controls", submenu.id);
      expect(submenu).toHaveTextContent("2 orquestradores, 1 trabalhando");
      const primeiro = within(submenu).getByRole("menuitem", { name: /Site da padaria/ });
      expect(primeiro).toHaveAccessibleName("Site da padaria, trabalhando, pasta pasta-o1, aberto no canvas");
      expect(primeiro).toHaveTextContent("no canvas");
      expect(primeiro).toHaveTextContent("trabalhando");
      expect(primeiro).toHaveTextContent("pasta-o1");
      const segundo = within(submenu).getByRole("menuitem", { name: /^API/ });
      expect(segundo).toHaveAccessibleName("API, parado, pasta pasta-o2, fechado, abre ao escolher");
      expect(segundo).toHaveTextContent("abrir");
    });

    it("passar o mouse por outro item fecha o submenu", () => {
      montar();
      fireEvent.click(botao());
      fireEvent.mouseEnter(item(/^Orquestradores/).parentElement!);
      expect(screen.getByRole("menu", { name: "Orquestradores" })).toBeInTheDocument();

      fireEvent.mouseEnter(item("Nota"));

      expect(screen.queryByRole("menu", { name: "Orquestradores" })).not.toBeInTheDocument();
    });

    it("escolher um orquestrador chama aoEscolherOrquestrador com o id e fecha tudo", () => {
      const chamadas = montar();
      fireEvent.click(botao());
      fireEvent.click(item(/^Orquestradores/));

      fireEvent.click(screen.getByRole("menuitem", { name: /^API/ }));

      expect(chamadas.aoEscolherOrquestrador).toHaveBeenCalledWith("o2");
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    });

    it("→ abre com o foco no primeiro item, ↑/↓ navegam, ← volta ao pai e Esc fecha só o submenu", () => {
      montar();
      fireEvent.click(botao());
      fireEvent.keyDown(item("Novo orquestrador"), { key: "ArrowDown" });
      fireEvent.keyDown(item("Nota"), { key: "ArrowDown" });
      fireEvent.keyDown(item("Terminal"), { key: "ArrowDown" });
      fireEvent.keyDown(item("Prévia"), { key: "ArrowDown" });
      expect(item(/^Orquestradores/)).toHaveFocus();

      fireEvent.keyDown(item(/^Orquestradores/), { key: "ArrowRight" });

      const submenu = screen.getByRole("menu", { name: "Orquestradores" });
      const itens = within(submenu).getAllByRole("menuitem");
      expect(itens[0]).toHaveFocus();
      fireEvent.keyDown(itens[0]!, { key: "ArrowDown" });
      expect(itens[1]).toHaveFocus();
      fireEvent.keyDown(itens[1]!, { key: "ArrowDown" });
      expect(itens[0]).toHaveFocus();

      fireEvent.keyDown(itens[0]!, { key: "ArrowLeft" });
      expect(screen.queryByRole("menu", { name: "Orquestradores" })).not.toBeInTheDocument();
      expect(item(/^Orquestradores/)).toHaveFocus();

      // Esc dentro do submenu fecha só ele; o menu principal continua.
      fireEvent.keyDown(item(/^Orquestradores/), { key: "ArrowRight" });
      fireEvent.keyDown(within(screen.getByRole("menu", { name: "Orquestradores" })).getAllByRole("menuitem")[0]!, {
        key: "Escape",
      });
      expect(screen.queryByRole("menu", { name: "Orquestradores" })).not.toBeInTheDocument();
      expect(screen.getByRole("menu", { name: "Novo" })).toBeInTheDocument();
      expect(item(/^Orquestradores/)).toHaveFocus();
    });

    it("Enter no item pai abre o submenu e Enter num orquestrador o escolhe", () => {
      const chamadas = montar();
      fireEvent.click(botao());
      item(/^Orquestradores/).focus();

      fireEvent.keyDown(item(/^Orquestradores/), { key: "Enter" });
      const primeiro = within(screen.getByRole("menu", { name: "Orquestradores" })).getAllByRole("menuitem")[0]!;
      expect(primeiro).toHaveFocus();
      fireEvent.keyDown(primeiro, { key: "Enter" });

      expect(chamadas.aoEscolherOrquestrador).toHaveBeenCalledWith("o1");
    });

    it("sem orquestradores, mostra o vazio; sem a lista ainda, mostra carregando; o erro aparece", () => {
      montar({ orquestradores: [], erroDosOrquestradores: "falhou" });
      fireEvent.click(botao());
      fireEvent.click(item(/^Orquestradores/));

      expect(screen.getByText("Nenhum orquestrador ainda.")).toBeInTheDocument();
      expect(screen.getByRole("alert")).toHaveTextContent("falhou");
    });

    it("com a lista ainda não carregada, o submenu diz que está carregando", () => {
      montar({ orquestradores: null });
      fireEvent.click(botao());
      fireEvent.click(item(/^Orquestradores/));

      expect(within(screen.getByRole("menu", { name: "Orquestradores" })).getByText("carregando…")).toBeInTheDocument();
    });
  });

  describe("submenu Subagentes", () => {
    it("lista os prontos com nome e descrição e termina com Novo subagente e Gerenciar subagentes", () => {
      montar();
      fireEvent.click(botao());
      fireEvent.click(item(/^Subagentes/));

      const submenu = screen.getByRole("menu", { name: "Subagentes" });
      expect(submenu).toHaveTextContent("2 subagentes prontos");
      expect(within(submenu).getByRole("menuitem", { name: "revisor-de-codigo: Revisa um diff e aponta riscos." })).toBeInTheDocument();
      expect(within(submenu).getByRole("menuitem", { name: "redator: Escreve textos curtos." })).toBeInTheDocument();
      const nomes = within(submenu)
        .getAllByRole("menuitem")
        .map((elemento) => elemento.getAttribute("aria-label") ?? elemento.textContent);
      expect(nomes.slice(-2)).toEqual(["Novo subagente", "Gerenciar subagentes"]);
    });

    it.each(["Novo subagente", "Gerenciar subagentes", "redator: Escreve textos curtos."])(
      "%s abre o painel de subagentes prontos e fecha o menu",
      (rotulo) => {
        const chamadas = montar();
        fireEvent.click(botao());
        fireEvent.click(item(/^Subagentes/));

        fireEvent.click(screen.getByRole("menuitem", { name: rotulo }));

        expect(chamadas.aoAbrirSubagentes).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole("menu")).not.toBeInTheDocument();
      },
    );

    it("sem nenhum pronto, mostra o vazio e mantém as duas ações do fim", () => {
      montar({ subagentes: [] });
      fireEvent.click(botao());
      fireEvent.click(item(/^Subagentes/));

      expect(screen.getByText("Nenhum subagente pronto ainda.")).toBeInTheDocument();
      expect(screen.getByRole("menuitem", { name: "Novo subagente" })).toBeInTheDocument();
      expect(screen.getByRole("menuitem", { name: "Gerenciar subagentes" })).toBeInTheDocument();
    });

    it("→ abre, ↓ chega às ações do fim e ← volta ao pai", () => {
      montar();
      fireEvent.click(botao());
      item(/^Subagentes/).focus();
      fireEvent.keyDown(item(/^Subagentes/), { key: "ArrowRight" });
      const itens = within(screen.getByRole("menu", { name: "Subagentes" })).getAllByRole("menuitem");
      expect(itens).toHaveLength(4);

      fireEvent.keyDown(itens[0]!, { key: "End" });
      expect(itens[3]).toHaveFocus();
      fireEvent.keyDown(itens[3]!, { key: "ArrowLeft" });

      expect(screen.queryByRole("menu", { name: "Subagentes" })).not.toBeInTheDocument();
      expect(item(/^Subagentes/)).toHaveFocus();
    });
  });
});
