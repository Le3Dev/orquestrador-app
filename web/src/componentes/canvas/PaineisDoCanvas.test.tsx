import { fireEvent, render, screen } from "@testing-library/react";

import type { JanelaDaCota, LeituraDeMemoria } from "../../shared/api/tipos";
import { BarraDoCanvas, ErroDoCanvas, StatusDoCanvas } from "./PaineisDoCanvas";

describe("BarraDoCanvas", () => {
  it("o \"+ notas\" fica ao lado do \"novo orquestrador\" e cria uma nota a cada clique", () => {
    const aoCriar = vi.fn();
    const aoCriarNota = vi.fn();
    render(<BarraDoCanvas aoCriar={aoCriar} aoCriarNota={aoCriarNota} aoOrganizar={vi.fn()} podeOrganizar={false} />);
    const botao = screen.getByRole("button", { name: "+ notas" });

    expect(botao).toHaveClass("btn", "btn-sm", "btn-cta");
    expect(screen.getByRole("button", { name: "+ Novo orquestrador" }).nextElementSibling).toBe(botao);
    fireEvent.click(botao);
    fireEvent.click(botao);

    expect(aoCriarNota).toHaveBeenCalledTimes(2);
    expect(aoCriar).not.toHaveBeenCalled();
  });

  describe("botão ⚙ Pastas", () => {
    const janelaComPonte = window as unknown as { electron?: unknown };

    afterEach(() => {
      delete janelaComPonte.electron;
    });

    const renderizarBarra = () =>
      render(<BarraDoCanvas aoCriar={vi.fn()} aoCriarNota={vi.fn()} aoOrganizar={vi.fn()} podeOrganizar={false} />);

    it("não aparece sem a ponte do aplicativo (navegador)", () => {
      renderizarBarra();

      expect(screen.queryByRole("button", { name: "⚙ Pastas" })).not.toBeInTheDocument();
    });

    it("com a ponte, aparece e reabre os ajustes da primeira abertura", () => {
      const abrirAjustes = vi.fn().mockResolvedValue(undefined);
      janelaComPonte.electron = { configuracao: { obter: vi.fn(), abrirAjustes } };
      renderizarBarra();
      const botao = screen.getByRole("button", { name: "⚙ Pastas" });

      expect(botao).toHaveAttribute("title", "Pasta dos projetos e Claude Code");
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
});

describe("BarraDoCanvas · rótulos e desktop", () => {
  const janelaComPonte = window as unknown as { electron?: unknown };

  afterEach(() => {
    delete janelaComPonte.electron;
  });

  it("cada botão traz os três tamanhos de rótulo (o CSS escolhe pela largura) e a dica", () => {
    render(<BarraDoCanvas aoCriar={vi.fn()} aoCriarNota={vi.fn()} aoOrganizar={vi.fn()} podeOrganizar />);
    const novo = screen.getByRole("button", { name: "+ Novo orquestrador" });

    expect(novo).toHaveAttribute("title", "Novo orquestrador");
    expect(novo.querySelector(".rotulo-completo")).toHaveTextContent("+ Novo orquestrador");
    expect(novo.querySelector(".rotulo-curto")).toHaveTextContent("+ Novo");
    expect(novo.querySelector(".rotulo-icone")).toHaveTextContent("+");
    expect(screen.getByRole("button", { name: "+ notas" }).querySelector(".rotulo-curto")).toHaveTextContent("+ Nota");
    expect(screen.getByRole("heading", { name: "Orquestrador de agentes" })).toBeInTheDocument();
  });

  it("\"Buscar\" só aparece com a paleta; tem os três rótulos, o atalho e abre a paleta", () => {
    const { unmount } = render(
      <BarraDoCanvas aoCriar={vi.fn()} aoCriarNota={vi.fn()} aoOrganizar={vi.fn()} podeOrganizar />,
    );
    expect(screen.queryByRole("button", { name: "Buscar (Ctrl+K)" })).not.toBeInTheDocument();
    unmount();

    const aoBuscar = vi.fn();
    render(
      <BarraDoCanvas aoCriar={vi.fn()} aoCriarNota={vi.fn()} aoOrganizar={vi.fn()} podeOrganizar aoBuscar={aoBuscar} />,
    );
    const buscar = screen.getByRole("button", { name: "Buscar (Ctrl+K)" });

    expect(buscar).toHaveAttribute("aria-keyshortcuts", "Control+K");
    expect(buscar.querySelector(".rotulo-completo")).toHaveTextContent("Buscar (Ctrl+K)");
    expect(buscar.querySelector(".rotulo-curto")).toHaveTextContent("Buscar");
    expect(buscar.querySelector(".rotulo-icone")).toHaveTextContent("⌕");
    fireEvent.click(buscar);
    expect(aoBuscar).toHaveBeenCalledTimes(1);
  });

  it("no desktop, não repete o título do app nem desenha botões de janela", () => {
    janelaComPonte.electron = {
      desktop: true,
      janela: { minimizar: vi.fn(), maximizar: vi.fn(), fechar: vi.fn(), estaMaximizada: vi.fn() },
      configuracao: { obter: vi.fn(), abrirAjustes: vi.fn() },
    };
    render(<BarraDoCanvas aoCriar={vi.fn()} aoCriarNota={vi.fn()} aoOrganizar={vi.fn()} podeOrganizar />);

    expect(screen.queryByRole("heading", { name: "Orquestrador de agentes" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Minimizar|Maximizar|Fechar/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "⚙ Pastas" }).querySelector(".rotulo-curto")).toHaveTextContent("⚙");
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
    fireEvent.click(screen.getByRole("button", { name: "✕" }));
    expect(aoFechar).toHaveBeenCalledTimes(1);
  });
});
