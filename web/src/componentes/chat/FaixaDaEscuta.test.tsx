import { fireEvent, render, screen } from "@testing-library/react";

import type { EscutaNaTela } from "../../shared/escuta/useEscuta";
import { FaixaDaEscuta } from "./FaixaDaEscuta";

type PropsDaFaixa = Parameters<typeof FaixaDaEscuta>[0];

function props(alteracoes: Partial<EscutaNaTela> = {}): PropsDaFaixa {
  return {
    situacao: "escutando",
    progressoDoDownload: null,
    automatico: true,
    alternarAutomatico: vi.fn(),
    erro: null,
    descartarErro: vi.fn(),
    ultimaPergunta: null,
    ...alteracoes,
  };
}

describe("FaixaDaEscuta", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(["indisponivel", "desligada", "aguardando-aviso"] as const)("não aparece em %s", (situacao) => {
    render(<FaixaDaEscuta {...props({ situacao })} />);
    expect(screen.queryByTestId("faixa-da-escuta")).not.toBeInTheDocument();
  });

  it("não mostra mais as linhas da transcrição (elas vão para a conversa)", () => {
    render(<FaixaDaEscuta {...props({ linhas: ["primeira linha"] })} />);
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(screen.queryByText("primeira linha")).not.toBeInTheDocument();
  });

  it("a chave Automático reflete o estado e alterna", () => {
    const alternarAutomatico = vi.fn();
    const { rerender } = render(<FaixaDaEscuta {...props({ alternarAutomatico })} />);

    const chave = screen.getByRole("switch", { name: "Automático" });
    expect(chave).toHaveAttribute("aria-checked", "true");
    fireEvent.click(chave);
    expect(alternarAutomatico).toHaveBeenCalledTimes(1);

    rerender(<FaixaDaEscuta {...props({ alternarAutomatico, automatico: false })} />);
    expect(screen.getByRole("switch", { name: "Automático" })).toHaveAttribute("aria-checked", "false");
  });

  it("baixando o modelo: barra de progresso com o valor", () => {
    render(<FaixaDaEscuta {...props({ situacao: "baixando-modelo", progressoDoDownload: 42 })} />);

    const barra = screen.getByRole("progressbar", { name: "Download do modelo de transcrição" });
    expect(barra).toHaveAttribute("aria-valuenow", "42");
    expect(screen.getByText("baixando o modelo de transcrição 42%")).toBeInTheDocument();
  });

  it("o erro aparece e o fechar o descarta", () => {
    const descartarErro = vi.fn();
    render(<FaixaDaEscuta {...props({ situacao: "erro", erro: "a captura do áudio parou", descartarErro })} />);

    expect(screen.getByRole("alert")).toHaveTextContent("a captura do áudio parou");
    fireEvent.click(screen.getByRole("button", { name: "fechar" }));
    expect(descartarErro).toHaveBeenCalledTimes(1);
  });

  it("mostra a última pergunta detectada", () => {
    render(<FaixaDaEscuta {...props({ ultimaPergunta: "Como inverter uma lista ligada?" })} />);
    expect(screen.getByText("Como inverter uma lista ligada?", { exact: false })).toHaveAttribute(
      "title",
      "Como inverter uma lista ligada?",
    );
  });
});
