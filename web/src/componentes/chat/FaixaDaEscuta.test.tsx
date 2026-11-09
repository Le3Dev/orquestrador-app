import { fireEvent, render, screen } from "@testing-library/react";

import type { EscutaNaTela } from "../../shared/escuta/useEscuta";
import { CHAVE_DA_FAIXA_DA_ESCUTA_RECOLHIDA, FaixaDaEscuta } from "./FaixaDaEscuta";

type PropsDaFaixa = Parameters<typeof FaixaDaEscuta>[0];

function props(alteracoes: Partial<EscutaNaTela> = {}): PropsDaFaixa {
  return {
    situacao: "escutando",
    progressoDoDownload: null,
    linhas: [],
    automatico: true,
    alternarAutomatico: vi.fn(),
    erro: null,
    descartarErro: vi.fn(),
    ultimaPergunta: null,
    ...alteracoes,
  };
}

const alternador = () => screen.getByRole("button", { name: /transcrição/ });

describe("FaixaDaEscuta", () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it.each(["indisponivel", "desligada", "aguardando-aviso"] as const)("não aparece em %s", (situacao) => {
    render(<FaixaDaEscuta {...props({ situacao })} />);
    expect(screen.queryByTestId("faixa-da-escuta")).not.toBeInTheDocument();
  });

  it("mostra as últimas linhas, com a mais nova por último", () => {
    render(<FaixaDaEscuta {...props({ linhas: ["primeira linha", "segunda linha"] })} />);

    const lista = screen.getByRole("list", { name: "Últimas linhas transcritas" });
    const itens = screen.getAllByRole("listitem");
    expect(lista).toBeInTheDocument();
    expect(itens.map((item) => item.textContent)).toEqual(["primeira linha", "segunda linha"]);
  });

  it("sem linhas, um texto discreto conforme a situação", () => {
    const { rerender } = render(<FaixaDaEscuta {...props()} />);
    expect(screen.getByText("Nada transcrito ainda.")).toBeInTheDocument();

    rerender(<FaixaDaEscuta {...props({ situacao: "pausada" })} />);
    expect(screen.getByText("Escuta pausada.")).toBeInTheDocument();
  });

  it("recolhe e abre pelo cabeçalho e guarda a escolha no localStorage", () => {
    const { unmount } = render(<FaixaDaEscuta {...props({ linhas: ["olá", "qual a complexidade disso?"] })} />);

    expect(alternador()).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("list", { name: "Últimas linhas transcritas" })).toBeVisible();

    fireEvent.click(alternador());
    expect(alternador()).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("list", { name: "Últimas linhas transcritas" })).not.toBeInTheDocument();
    // Recolhida, a última linha aparece resumida no cabeçalho.
    expect(alternador()).toHaveTextContent("qual a complexidade disso?");
    expect(localStorage.getItem(CHAVE_DA_FAIXA_DA_ESCUTA_RECOLHIDA)).toBe("true");

    // Ao montar de novo, continua recolhida.
    unmount();
    render(<FaixaDaEscuta {...props()} />);
    expect(alternador()).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(alternador());
    expect(localStorage.getItem(CHAVE_DA_FAIXA_DA_ESCUTA_RECOLHIDA)).toBe("false");
  });

  it("sem localStorage (bloqueado), abre e recolhe do mesmo jeito", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("bloqueado");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("bloqueado");
    });
    render(<FaixaDaEscuta {...props()} />);

    expect(alternador()).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(alternador());
    expect(alternador()).toHaveAttribute("aria-expanded", "false");
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

  it("o erro aparece mesmo recolhida e o fechar o descarta", () => {
    localStorage.setItem(CHAVE_DA_FAIXA_DA_ESCUTA_RECOLHIDA, "true");
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
