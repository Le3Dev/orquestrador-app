import { render, screen } from "@testing-library/react";

import type { JanelaDaCota } from "../../shared/api/tipos";
import { AbaDaConta } from "./AbaDaConta";
import { nomeLegivelDaCota } from "./usoDoSistema";

const agora = new Date(2026, 10, 10, 12, 0, 0);
const emHoras = (horas: number) => new Date(agora.getTime() + horas * 3_600_000).toISOString();

describe("AbaDaConta", () => {
  it("dá nomes legíveis às janelas que o Claude manda", () => {
    expect(nomeLegivelDaCota("5 horas")).toBe("Cota da sessão");
    expect(nomeLegivelDaCota("7 dias")).toBe("Cota da semana");
    expect(nomeLegivelDaCota("7 dias (Opus)")).toBe("Cota da semana (Opus)");
    expect(nomeLegivelDaCota("Créditos extras")).toBe("Cota de Créditos extras");
  });

  it("lista cada janela com barra, percentual usado e quando renova", () => {
    const cota: JanelaDaCota[] = [
      { nome: "5 horas", utilizacao: 0.42, renovaEm: emHoras(3), situacao: "allowed" },
      { nome: "7 dias", utilizacao: 0.61, renovaEm: emHoras(1.5), situacao: "allowed" },
    ];
    render(<AbaDaConta cota={cota} agora={agora} />);

    const sessao = screen.getByRole("meter", { name: "Cota da sessão" });
    expect(sessao).toHaveAttribute("aria-valuenow", "42");
    expect(sessao).toHaveAttribute("aria-valuetext", "42% usada");
    expect(screen.getByText("42% usada · renova em 3 h")).toBeInTheDocument();
    expect(screen.getByRole("meter", { name: "Cota da semana" })).toHaveAttribute("aria-valuenow", "61");
    expect(screen.getByText("61% usada · renova em 1 h 30 min")).toBeInTheDocument();
  });

  it("janela alta fica vermelha e a rejeitada avisa que está no limite", () => {
    const cota: JanelaDaCota[] = [{ nome: "7 dias", utilizacao: 1, renovaEm: null, situacao: "rejected" }];
    render(<AbaDaConta cota={cota} agora={agora} />);
    expect(screen.getByRole("meter", { name: "Cota da semana" })).toHaveClass("cfgapp-barra-alta");
    expect(screen.getByText("no limite ·")).toBeInTheDocument();
    expect(screen.getByText(/sem horário de renovação/)).toBeInTheDocument();
  });

  it("sem cota (nula ou vazia), diz que o uso aparece depois do primeiro pedido", () => {
    const { rerender } = render(<AbaDaConta cota={null} />);
    expect(screen.getByText("O uso aparece depois do primeiro pedido.")).toBeInTheDocument();
    rerender(<AbaDaConta cota={[]} />);
    expect(screen.getByText("O uso aparece depois do primeiro pedido.")).toBeInTheDocument();
    expect(screen.queryByRole("meter")).not.toBeInTheDocument();
  });

  it("não oferece e-mail, plano nem troca de conta (o app não tem esses dados)", () => {
    render(<AbaDaConta cota={null} />);
    expect(screen.queryByRole("button", { name: "Trocar" })).not.toBeInTheDocument();
    expect(screen.queryByText(/plano/i)).not.toBeInTheDocument();
  });
});
