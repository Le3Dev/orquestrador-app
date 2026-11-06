import { fireEvent, render, screen } from "@testing-library/react";

import type { JanelaDaCota, LeituraDeMemoria } from "../../shared/api/tipos";
import { BarraDoCanvas, ErroDoCanvas, StatusDoCanvas } from "./PaineisDoCanvas";

const janelaComPonte = window as unknown as { electron?: unknown };

/** A ponte do app desktop: janela própria e os Ajustes. */
function ponteDoDesktop(abrirAjustes = vi.fn().mockResolvedValue(undefined)) {
  return {
    desktop: true,
    janela: { minimizar: vi.fn(), maximizar: vi.fn(), fechar: vi.fn(), estaMaximizada: vi.fn() },
    configuracao: { obter: vi.fn(), abrirAjustes },
  };
}

/** Os botões nossos da barra (Prévia, Subagentes, Instruções gerais), sem efeito nos testes do "+ Novo ▾". */
const extrasDaBarra = {
  aoCriarPrevia: vi.fn(),
  aoAlternarPainel: vi.fn(),
  painelAberto: null,
  quantidadeDeSubagentes: null,
} as const;

const botaoDoNovo = () => screen.getByRole("button", { name: "Novo" });
const itensDoMenu = () => screen.getAllByRole("menuitem");

describe("BarraDoCanvas · desktop", () => {
  afterEach(() => {
    delete janelaComPonte.electron;
  });

  function renderizar() {
    janelaComPonte.electron = ponteDoDesktop();
    const aoCriar = vi.fn();
    const aoCriarNota = vi.fn();
    render(
      <>
        <input aria-label="Campo de fora" />
        <BarraDoCanvas aoCriar={aoCriar} aoCriarNota={aoCriarNota} aoBuscar={vi.fn()} {...extrasDaBarra} />
      </>,
    );
    return { aoCriar, aoCriarNota };
  }

  it("o \"+ Novo ▾\" e os botões de Prévia, Subagentes e Instruções gerais: sem título, busca, ⚙, notas, organizar nem botões de janela", () => {
    renderizar();

    expect(screen.getAllByRole("button")).toEqual([
      botaoDoNovo(),
      screen.getByRole("button", { name: "Prévia" }),
      screen.getByRole("button", { name: "Subagentes" }),
      screen.getByRole("button", { name: "Instruções gerais" }),
    ]);
    expect(botaoDoNovo()).toHaveClass("btn", "btn-sm", "btn-cta");
    expect(botaoDoNovo()).toHaveAttribute("aria-haspopup", "menu");
    expect(botaoDoNovo()).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("heading", { name: "Orquestrador de agentes" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("os rótulos completo, curto e ícone (o CSS escolhe pela largura) e a dica", () => {
    renderizar();
    const novo = botaoDoNovo();

    expect(novo).toHaveAttribute("title", "Novo orquestrador (Ctrl+N) ou nota (Ctrl+Shift+N)");
    expect(novo.querySelector(".rotulo-completo")).toHaveTextContent("+ Novo ▾");
    expect(novo.querySelector(".rotulo-curto")).toHaveTextContent("+ Novo ▾");
    expect(novo.querySelector(".rotulo-icone")).toHaveTextContent("+");
  });

  it("abre o menu com o foco no primeiro item; ↑/↓ navegam (com volta) e Enter escolhe a nota", () => {
    const { aoCriar, aoCriarNota } = renderizar();

    fireEvent.click(botaoDoNovo());

    const menu = screen.getByRole("menu", { name: "Novo" });
    expect(botaoDoNovo()).toHaveAttribute("aria-expanded", "true");
    expect(botaoDoNovo()).toHaveAttribute("aria-controls", menu.id);
    // O atalho fica à direita de cada item (fora do nome acessível, que tem aria-keyshortcuts).
    expect(itensDoMenu().map((item) => item.querySelector("kbd")?.textContent)).toEqual(["Ctrl+N", "Ctrl+Shift+N"]);
    expect(screen.getByRole("menuitem", { name: "Orquestrador" })).toHaveAttribute("aria-keyshortcuts", "Control+N");
    expect(screen.getByRole("menuitem", { name: "Nota" })).toHaveAttribute("aria-keyshortcuts", "Control+Shift+N");
    expect(itensDoMenu()[0]).toHaveFocus();

    fireEvent.keyDown(itensDoMenu()[0] as HTMLElement, { key: "ArrowDown" });
    expect(itensDoMenu()[1]).toHaveFocus();
    fireEvent.keyDown(itensDoMenu()[1] as HTMLElement, { key: "ArrowDown" });
    expect(itensDoMenu()[0]).toHaveFocus();
    fireEvent.keyDown(itensDoMenu()[0] as HTMLElement, { key: "ArrowUp" });
    expect(itensDoMenu()[1]).toHaveFocus();

    fireEvent.keyDown(itensDoMenu()[1] as HTMLElement, { key: "Enter" });

    expect(aoCriarNota).toHaveBeenCalledTimes(1);
    expect(aoCriar).not.toHaveBeenCalled();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(botaoDoNovo()).toHaveAttribute("aria-expanded", "false");
    expect(botaoDoNovo()).toHaveFocus();
  });

  it("clicar em \"Orquestrador\" chama aoCriar e fecha", () => {
    const { aoCriar, aoCriarNota } = renderizar();

    fireEvent.click(botaoDoNovo());
    fireEvent.click(screen.getByRole("menuitem", { name: "Orquestrador" }));

    expect(aoCriar).toHaveBeenCalledTimes(1);
    expect(aoCriarNota).not.toHaveBeenCalled();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("↓ no botão abre no primeiro item e ↑, no último; clicar no botão de novo fecha", () => {
    renderizar();

    fireEvent.keyDown(botaoDoNovo(), { key: "ArrowDown" });
    expect(itensDoMenu()[0]).toHaveFocus();
    fireEvent.click(botaoDoNovo());
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    fireEvent.keyDown(botaoDoNovo(), { key: "ArrowUp" });
    expect(itensDoMenu()[1]).toHaveFocus();
  });

  it("Esc fecha sem escolher e o foco volta ao botão", () => {
    const { aoCriar, aoCriarNota } = renderizar();
    fireEvent.click(botaoDoNovo());

    fireEvent.keyDown(itensDoMenu()[0] as HTMLElement, { key: "Escape" });

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(botaoDoNovo()).toHaveFocus();
    expect(aoCriar).not.toHaveBeenCalled();
    expect(aoCriarNota).not.toHaveBeenCalled();
  });

  it("clique fora fecha sem escolher, e o foco volta ao botão; clique dentro do menu não fecha", () => {
    const { aoCriar, aoCriarNota } = renderizar();
    fireEvent.click(botaoDoNovo());

    fireEvent.mouseDown(screen.getByRole("menu"));
    expect(screen.getByRole("menu")).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByRole("textbox", { name: "Campo de fora" }));

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(botaoDoNovo()).toHaveFocus();
    expect(aoCriar).not.toHaveBeenCalled();
    expect(aoCriarNota).not.toHaveBeenCalled();
  });
});

describe("BarraDoCanvas · navegador", () => {
  afterEach(() => {
    delete janelaComPonte.electron;
  });

  const renderizarBarra = (aoBuscar?: () => void) =>
    render(<BarraDoCanvas aoCriar={vi.fn()} aoCriarNota={vi.fn()} aoBuscar={aoBuscar} {...extrasDaBarra} />);

  it("mostra o título do app, o \"+ Novo ▾\" e, sem a ponte, nenhum ⚙", () => {
    renderizarBarra(vi.fn());

    expect(screen.getByRole("heading", { name: "Orquestrador de agentes" })).toBeInTheDocument();
    expect(botaoDoNovo()).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Organizar|\+ notas/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "⚙ Pastas" })).not.toBeInTheDocument();
  });

  it("\"Buscar\" só aparece com a paleta; tem os três rótulos, o atalho e abre a paleta", () => {
    const { unmount } = renderizarBarra();
    expect(screen.queryByRole("button", { name: "Buscar (Ctrl+K)" })).not.toBeInTheDocument();
    unmount();

    const aoBuscar = vi.fn();
    renderizarBarra(aoBuscar);
    const buscar = screen.getByRole("button", { name: "Buscar (Ctrl+K)" });

    expect(buscar).toHaveAttribute("aria-keyshortcuts", "Control+K");
    expect(buscar.querySelector(".rotulo-completo")).toHaveTextContent("Buscar (Ctrl+K)");
    expect(buscar.querySelector(".rotulo-curto")).toHaveTextContent("Buscar");
    expect(buscar.querySelector(".rotulo-icone")).toHaveTextContent("⌕");
    fireEvent.click(buscar);
    expect(aoBuscar).toHaveBeenCalledTimes(1);
  });

  it("com a ponte dos Ajustes (sem janela própria), o ⚙ aparece e reabre os ajustes da primeira abertura", () => {
    const abrirAjustes = vi.fn().mockResolvedValue(undefined);
    janelaComPonte.electron = { configuracao: { obter: vi.fn(), abrirAjustes } };
    renderizarBarra(vi.fn());
    const botao = screen.getByRole("button", { name: "⚙ Pastas" });

    expect(botao).toHaveAttribute("title", "Pasta dos projetos e Claude Code");
    expect(botao.querySelector(".rotulo-curto")).toHaveTextContent("⚙");
    fireEvent.click(botao);

    expect(abrirAjustes).toHaveBeenCalledTimes(1);
  });

  it("mostra a mensagem quando os ajustes não abrem", async () => {
    const abrirAjustes = vi.fn().mockRejectedValue(new Error("janela ocupada"));
    janelaComPonte.electron = { configuracao: { obter: vi.fn(), abrirAjustes } };
    renderizarBarra();

    fireEvent.click(screen.getByRole("button", { name: "⚙ Pastas" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Não foi possível abrir os ajustes de pastas: janela ocupada",
    );
  });
});

describe("BarraDoCanvas: Subagentes e Instruções gerais", () => {
  function barra(painelAberto: "subagentes" | "instrucoes" | null, quantidadeDeSubagentes: number | null = 3) {
    const aoAlternarPainel = vi.fn();
    const resultado = render(
      <BarraDoCanvas
        aoCriar={vi.fn()}
        aoCriarNota={vi.fn()}
        aoCriarPrevia={vi.fn()}
        aoAlternarPainel={aoAlternarPainel}
        painelAberto={painelAberto}
        quantidadeDeSubagentes={quantidadeDeSubagentes}
      />,
    );
    return { aoAlternarPainel, ...resultado };
  }

  it("o botão Prévia abre uma prévia ao vivo, com os três rótulos", () => {
    const aoCriarPrevia = vi.fn();
    render(<BarraDoCanvas aoCriar={vi.fn()} aoCriarNota={vi.fn()} {...extrasDaBarra} aoCriarPrevia={aoCriarPrevia} />);
    const botao = screen.getByRole("button", { name: "Prévia" });

    expect(botao.querySelector(".rotulo-completo")).toHaveTextContent("+ Prévia");
    expect(botao.querySelector(".rotulo-curto")).toHaveTextContent("Prévia");
    expect(botao.querySelector(".rotulo-icone svg")).not.toBeNull();
    fireEvent.click(botao);

    expect(aoCriarPrevia).toHaveBeenCalledTimes(1);
  });

  it("troca o botão Preferências por Subagentes (com a contagem) e Instruções gerais", () => {
    const { aoAlternarPainel } = barra(null);

    expect(screen.queryByRole("button", { name: /Preferências/ })).not.toBeInTheDocument();
    const subagentes = screen.getByRole("button", { name: /Subagentes/ });
    const instrucoes = screen.getByRole("button", { name: "Instruções gerais" });
    expect(subagentes).toHaveAccessibleName("Subagentes (3)");
    expect(subagentes.querySelector(".rotulo-completo")).toHaveTextContent("Subagentes 3");
    expect(subagentes).toHaveClass("btn", "btn-sm", "btn-outline");
    expect(instrucoes).toHaveAttribute(
      "title",
      "Instruções que valem para todo orquestrador sem instruções próprias",
    );

    fireEvent.click(subagentes);
    fireEvent.click(instrucoes);
    expect(aoAlternarPainel.mock.calls).toEqual([["subagentes"], ["instrucoes"]]);
  });

  it("sem a contagem (servidor fora), o botão fica só com o nome", () => {
    barra(null, null);

    const subagentes = screen.getByRole("button", { name: "Subagentes" });
    expect(subagentes.querySelector(".rotulo-completo")).toHaveTextContent(/^Subagentes$/);
  });

  it("aria-expanded marca só o painel aberto", () => {
    const { rerender } = barra("subagentes");
    const subagentes = () => screen.getByRole("button", { name: /Subagentes/ });
    const instrucoes = () => screen.getByRole("button", { name: "Instruções gerais" });

    expect(subagentes()).toHaveAttribute("aria-expanded", "true");
    expect(instrucoes()).toHaveAttribute("aria-expanded", "false");

    rerender(
      <BarraDoCanvas
        aoCriar={vi.fn()}
        aoCriarNota={vi.fn()}
        aoCriarPrevia={vi.fn()}
        aoAlternarPainel={vi.fn()}
        painelAberto="instrucoes"
        quantidadeDeSubagentes={3}
      />,
    );

    expect(subagentes()).toHaveAttribute("aria-expanded", "false");
    expect(instrucoes()).toHaveAttribute("aria-expanded", "true");
  });
});

describe("StatusDoCanvas", () => {
  const GB = 1024 ** 3;
  const cota: JanelaDaCota[] = [
    { nome: "5 horas", utilizacao: 0.42, renovaEm: null, situacao: "allowed" },
    { nome: "7 dias", utilizacao: 0.85, renovaEm: null, situacao: "allowed" },
  ];
  const memoria = (livreGb: number): LeituraDeMemoria => ({
    totalBytes: 32 * GB,
    livreBytes: livreGb * GB,
    servidorBytes: 0,
    agentesBytes: 0,
    porOrquestrador: {},
    lidaEm: "2026-11-04T12:00:00Z",
  });

  it("mostra rótulo completo e curto de cada cota, e o resumo com o resto no balão", () => {
    render(<StatusDoCanvas trabalhando={0} bixinhosAtivos={2} cota={cota} memoria={memoria(16)} />);
    const status = screen.getByTestId("status-do-canvas");

    expect(status).toHaveTextContent("todos ociosos");
    expect([...status.querySelectorAll(".rotulo-curto")].map((rotulo) => rotulo.textContent)).toEqual(["5h", "7d"]);
    const resumo = screen.getByTestId("resumo-do-status");
    // O medidor resumido é o do uso mais alto (7 dias, 85%); o resto vai no balão.
    expect(resumo).toHaveTextContent("7d");
    expect(resumo).toHaveTextContent("85%");
    expect(resumo).toHaveClass("text-error");
    expect(resumo.getAttribute("title")).toContain("2 agentes ativos");
    expect(resumo.getAttribute("title")).toContain("5 horas: 42%");
    expect(resumo.getAttribute("title")).toContain("RAM: Livre");
  });

  it("no painel, o alerta de memória fica abaixo; na barra de título, não", () => {
    const { unmount } = render(<StatusDoCanvas trabalhando={1} bixinhosAtivos={0} cota={null} memoria={memoria(2.5)} />);
    expect(screen.getByRole("status")).toHaveTextContent("Memória baixa");
    unmount();

    render(<StatusDoCanvas naBarraDeTitulo trabalhando={1} bixinhosAtivos={0} cota={null} memoria={memoria(2.5)} />);
    expect(screen.getByTestId("status-do-canvas")).toHaveClass("status-na-barra-de-titulo", "no-drag");
    expect(screen.getByTestId("status-do-canvas")).toHaveTextContent("1 trabalhando");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("sem cota, memória nem agentes ativos, não há resumo", () => {
    render(<StatusDoCanvas trabalhando={0} bixinhosAtivos={0} cota={null} memoria={null} />);
    expect(screen.queryByTestId("resumo-do-status")).not.toBeInTheDocument();
  });
});

describe("ErroDoCanvas", () => {
  it("mostra o erro e fecha", () => {
    const aoFechar = vi.fn();
    render(<ErroDoCanvas erro="Não foi possível criar a nota: servidor fora." aoFechar={aoFechar} />);

    expect(screen.getByRole("alert")).toHaveTextContent("Não foi possível criar a nota: servidor fora.");
    fireEvent.click(screen.getByRole("button", { name: "Fechar aviso" }));
    expect(aoFechar).toHaveBeenCalledTimes(1);
  });
});

describe("StatusDoCanvas: aviso de memória", () => {
  const GB = 1024 ** 3;
  function memoria(livreGb: number): LeituraDeMemoria {
    return {
      totalBytes: 16 * GB,
      livreBytes: livreGb * GB,
      servidorBytes: 0,
      agentesBytes: 0,
      porOrquestrador: {},
      lidaEm: "2026-11-03T12:00:00Z",
    };
  }
  function status(livreGb: number) {
    return <StatusDoCanvas trabalhando={0} bixinhosAtivos={0} cota={null} memoria={memoria(livreGb)} />;
  }
  const fechar = () => fireEvent.click(screen.getByRole("button", { name: "Fechar aviso de memória" }));

  it("fecha no ✕ e o medidor de RAM continua", () => {
    render(status(0.4));
    expect(screen.getByText(/Memória quase esgotada/)).toBeInTheDocument();

    fechar();

    expect(screen.queryByText(/Memória quase esgotada/)).not.toBeInTheDocument();
    expect(screen.getByText(/livres/)).toBeInTheDocument();
  });

  it("fechado no nível baixo, volta se a memória ficar crítica", () => {
    const { rerender } = render(status(1.2));
    fechar();
    expect(screen.queryByText(/Memória baixa/)).not.toBeInTheDocument();

    rerender(status(0.4));

    expect(screen.getByText(/Memória quase esgotada/)).toBeInTheDocument();
  });

  it("fechado no crítico, não reaparece ao melhorar só para baixa", () => {
    const { rerender } = render(status(0.4));
    fechar();

    rerender(status(1.2));

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("depois de normalizar, volta a avisar se apertar de novo", () => {
    const { rerender } = render(status(0.4));
    fechar();

    rerender(status(8));
    rerender(status(0.4));

    expect(screen.getByText(/Memória quase esgotada/)).toBeInTheDocument();
  });
});
