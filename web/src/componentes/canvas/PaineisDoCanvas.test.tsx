import { fireEvent, render, screen } from "@testing-library/react";

import type { JanelaDaCota, LeituraDeMemoria } from "../../shared/api/tipos";
import { ErroDoCanvas, StatusDoCanvas } from "./PaineisDoCanvas";

describe("StatusDoCanvas (conteúdo da aba Sistema)", () => {
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

    expect(status).toHaveClass("status-do-sistema");
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

  it("mostra quem trabalha, a RAM livre e não carrega o aviso de memória (que é uma notificação)", () => {
    render(<StatusDoCanvas trabalhando={1} bixinhosAtivos={0} cota={null} memoria={memoria(2.5)} />);

    expect(screen.getByTestId("status-do-canvas")).toHaveTextContent("1 trabalhando");
    expect(screen.getByText(/livres/)).toBeInTheDocument();
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
