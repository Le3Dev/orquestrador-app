import { act, fireEvent, render, screen } from "@testing-library/react";

import { apiDasRotinas, type ResumoDaRotina } from "../../shared/api/rotinas";
import type { RotinasAoVivo } from "../../shared/hooks/useRotinas";
import { definirIdioma } from "../../shared/idioma/idioma";
import { PainelDeRotinas } from "./PainelDeRotinas";
import { descreverGatilho, descreverMomento, descreverProximaExecucao } from "./textos";

function rotina(): ResumoDaRotina {
  return {
    id: "r1",
    nome: "Morning report",
    ativa: true,
    gatilho: { tipo: "semanal", dias: [1], hora: "09:00" },
    etapas: [{ tipo: "pedido", orquestradorId: "o1", texto: "Run the tests", modo: "execucao" }],
    aoPerder: "pular",
    criadaEm: "2026-11-05T12:00:00Z",
    ultimaExecucaoEm: null,
    proximaExecucaoEm: null,
    execucaoAtiva: null,
  };
}

function rotinasFalsas(lista: ResumoDaRotina[]): RotinasAoVivo {
  return {
    lista,
    carregada: true,
    erro: null,
    indisponivel: false,
    conexao: "conectado",
    ativas: lista.length,
    aprovacoesPendentes: [],
    recarregar: vi.fn(),
    criar: vi.fn(),
    alterar: vi.fn(),
    apagar: vi.fn(),
    executarAgora: vi.fn(),
    aprovar: vi.fn(),
    recusar: vi.fn(),
    cancelar: vi.fn(),
  };
}

describe("Rotinas: inglês", () => {
  beforeEach(() => {
    definirIdioma("en");
    vi.spyOn(apiDasRotinas, "listarExecucoes").mockResolvedValue([]);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    definirIdioma("pt-BR");
  });

  it("descreve o gatilho e a próxima execução em inglês", () => {
    expect(descreverGatilho({ tipo: "semanal", dias: [1], hora: "09:00" })).toBe("Every Monday at 09:00");
    expect(descreverGatilho({ tipo: "semanal", dias: [5, 3, 1], hora: "09:00" })).toBe("Monday, Wednesday and Friday at 09:00");
    expect(descreverGatilho({ tipo: "semanal", dias: [1, 2, 3, 4, 5], hora: "09:00" })).toBe("Monday to Friday at 09:00");
    expect(descreverGatilho({ tipo: "intervalo", minutos: 90 })).toBe("Every 1 h 30 min");
    expect(descreverGatilho({ tipo: "intervalo", minutos: 120 })).toBe("Every 2 hours");
    const agora = new Date(2026, 10, 17, 10, 0);
    expect(descreverMomento(new Date(2026, 10, 18, 9, 0).toISOString(), agora)).toBe("tomorrow at 09:00");
    expect(descreverProximaExecucao({ ativa: false, proximaExecucaoEm: null }, agora)).toBe("Disabled: does not run on its own");
  });

  it("o painel, o detalhe e o editor aparecem em inglês", async () => {
    await act(async () => {
      render(<PainelDeRotinas rotinas={rotinasFalsas([rotina()])} orquestradores={[{ id: "o1", nome: "Backend" }]} aoFechar={vi.fn()} />);
    });

    expect(screen.getByRole("heading", { name: "Routines" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close routines" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run now" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(screen.getByText("Next run")).toBeInTheDocument();
    expect(screen.getByText("This routine has not run yet.")).toBeInTheDocument();
    expect(screen.queryByText("Rotinas")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByRole("alertdialog", { name: "Confirm routine deletion" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByRole("form", { name: "Edit routine" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+ Approval" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Move step 1 up" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove step 1" }));
    expect(screen.getByText("To save, add at least one step.")).toBeInTheDocument();
  });
});
