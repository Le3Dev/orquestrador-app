import { fireEvent, render, screen } from "@testing-library/react";

import type { LeituraDeMemoria } from "../../shared/api/tipos";
import { BarraDoCanvas, ErroDoCanvas, StatusDoCanvas } from "./PaineisDoCanvas";

describe("BarraDoCanvas", () => {
  it("o \"+ notas\" fica ao lado do \"novo orquestrador\" e cria uma nota a cada clique", () => {
    const aoCriar = vi.fn();
    const aoCriarNota = vi.fn();
    render(
      <BarraDoCanvas
        aoCriar={aoCriar}
        aoCriarNota={aoCriarNota}
        aoOrganizar={vi.fn()}
        podeOrganizar={false}
        aoAlternarPreferencias={vi.fn()}
        preferenciasAbertas={false}
      />,
    );
    const botao = screen.getByRole("button", { name: "+ notas" });

    expect(botao).toHaveClass("btn", "btn-sm", "btn-cta");
    expect(screen.getByRole("button", { name: "+ Novo orquestrador" }).nextElementSibling).toBe(botao);
    fireEvent.click(botao);
    fireEvent.click(botao);

    expect(aoCriarNota).toHaveBeenCalledTimes(2);
    expect(aoCriar).not.toHaveBeenCalled();
  });
});

describe("BarraDoCanvas no app desktop", () => {
  const janela = {
    minimizar: vi.fn(),
    maximizar: vi.fn(),
    fechar: vi.fn(),
    estaMaximizada: vi.fn().mockResolvedValue(false),
  };

  afterEach(() => {
    delete (window as unknown as { electron?: unknown }).electron;
  });

  function abrirNo(plataforma: string) {
    (window as unknown as { electron: unknown }).electron = { desktop: true, plataforma, janela };
    return render(
      <BarraDoCanvas
        aoCriar={vi.fn()}
        aoCriarNota={vi.fn()}
        aoOrganizar={vi.fn()}
        podeOrganizar={false}
        aoAlternarPreferencias={vi.fn()}
        preferenciasAbertas={false}
      />,
    );
  }

  it("no Mac, deixa as bolinhas nativas e não desenha os botões de janela", async () => {
    const { container } = abrirNo("darwin");

    expect(container.firstChild).toHaveClass("barra-arrastavel", "barra-com-semaforo");
    expect(screen.queryByRole("button", { name: "Minimizar" })).not.toBeInTheDocument();
  });

  it("no Windows, segue com os botões de janela desenhados", async () => {
    const { container } = abrirNo("win32");

    expect(container.firstChild).not.toHaveClass("barra-com-semaforo");
    expect(await screen.findByRole("button", { name: "Minimizar" })).toBeInTheDocument();
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
