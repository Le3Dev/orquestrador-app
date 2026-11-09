import { fireEvent, render, screen, within } from "@testing-library/react";

import { api } from "../../shared/api/cliente";
import type { ConsumoDoOrquestrador, JanelaDaCota } from "../../shared/api/tipos";
import { descreverRenovacao } from "../../shared/formatacao";
import { StatusDoCanvas } from "./PaineisDoCanvas";

const AGORA = new Date("2026-11-08T12:00:00Z");

const cota: JanelaDaCota[] = [
  { nome: "5 horas", utilizacao: 0.42, renovaEm: "2026-11-08T15:20:00Z", situacao: "allowed" },
  { nome: "7 dias", utilizacao: 0.85, renovaEm: null, situacao: "allowed" },
  { nome: "7 dias (Opus)", utilizacao: 1, renovaEm: null, situacao: "rejected" },
];

const uso = (entrada: number) => ({ entrada, criacaoDeCache: 0, leituraDeCache: 0, saida: 0 });

const consumos: ConsumoDoOrquestrador[] = [
  { id: "o2", nome: "Backend", turnosMedidos: 3, parcial: false, uso: uso(3000), indiceDeCusto: 3000 },
  { id: "o1", nome: "Painel", turnosMedidos: 1, parcial: true, uso: uso(1000), indiceDeCusto: 1000 },
];

function renderizar(janelas: JanelaDaCota[] | null = cota) {
  return render(
    <>
      <p>fora</p>
      <StatusDoCanvas trabalhando={0} bixinhosAtivos={0} cota={janelas} memoria={null} />
    </>,
  );
}

const popover = () => screen.queryByRole("dialog", { name: "Uso da assinatura" });

describe("PopoverDoUso", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("abre no medidor da cota com cada janela, a barra, a renovação e as por modelo", async () => {
    vi.useFakeTimers({ now: AGORA, toFake: ["Date"] });
    vi.spyOn(api, "lerConsumoDosOrquestradores").mockResolvedValue([]);
    renderizar();
    const medidor = screen.getByRole("button", { name: "Cota de 5 horas: 42%" });
    expect(medidor).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(medidor);

    const aberto = popover();
    expect(aberto).toBeInTheDocument();
    expect(medidor).toHaveAttribute("aria-expanded", "true");
    expect(medidor).toHaveAttribute("aria-controls", aberto?.id);
    expect(aberto).toHaveFocus();
    const cotas = within(aberto!).getByRole("region", { name: "Cotas da assinatura" });
    expect(within(cotas).getByRole("progressbar", { name: "Limite de 5 horas" })).toHaveAttribute("aria-valuenow", "42");
    expect(cotas).toHaveTextContent("renova em 3 h 20 min");
    expect(cotas).toHaveTextContent("Limite de 7 dias85%");
    expect(cotas).toHaveTextContent("sem horário de renovação");
    expect(cotas).toHaveTextContent("por modelo");
    expect(cotas).toHaveTextContent("Limite de 7 dias (Opus)100%");
    expect(cotas).toHaveTextContent("no limite");
    // O nome do plano não vem nos dados do Claude Code: não aparece.
    expect(aberto).not.toHaveTextContent(/\bMax\b|\bPro\b/);
    expect(await within(aberto!).findByText("Nenhum pedido medido ainda nas conversas atuais.")).toBeInTheDocument();
  });

  it("mostra o consumo de cada orquestrador na conversa atual, com a parte do total", async () => {
    const ler = vi.spyOn(api, "lerConsumoDosOrquestradores").mockResolvedValue(consumos);
    renderizar();

    fireEvent.click(screen.getByRole("button", { name: "Cota de 7 dias: 85%" }));

    const secao = within(popover()!).getByRole("region", { name: "Consumo por orquestrador" });
    expect(secao).toHaveTextContent("carregando…");
    expect(await within(secao).findByText("Backend")).toBeInTheDocument();
    expect(ler).toHaveBeenCalledTimes(1);
    expect(secao).toHaveTextContent("índice 3 mil");
    expect(secao).toHaveTextContent("3 pedidos medidos · 75% do total");
    expect(secao).toHaveTextContent("1 pedido medido · 25% do total · parcial");
    expect(secao).toHaveTextContent("não é preço nem % da cota");
  });

  it("mostra a falha da leitura do consumo sem esconder a cota", async () => {
    vi.spyOn(api, "lerConsumoDosOrquestradores").mockRejectedValue(new Error("Servidor fora."));
    renderizar();

    fireEvent.click(screen.getByRole("button", { name: "Cota de 5 horas: 42%" }));

    expect(await within(popover()!).findByRole("alert")).toHaveTextContent("Servidor fora.");
    expect(popover()).toHaveTextContent("Limite de 5 horas");
  });

  it("fecha com Esc (o foco volta ao medidor), com clique fora e no próprio medidor", () => {
    vi.spyOn(api, "lerConsumoDosOrquestradores").mockResolvedValue([]);
    renderizar();
    const medidor = screen.getByRole("button", { name: "Cota de 5 horas: 42%" });

    fireEvent.click(medidor);
    fireEvent.keyDown(popover()!, { key: "Escape" });
    expect(popover()).not.toBeInTheDocument();
    expect(medidor).toHaveFocus();
    expect(medidor).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(medidor);
    fireEvent.mouseDown(screen.getByText("fora"));
    expect(popover()).not.toBeInTheDocument();

    fireEvent.click(medidor);
    // Clicar dentro não fecha.
    fireEvent.mouseDown(popover()!);
    expect(popover()).toBeInTheDocument();
    fireEvent.mouseDown(medidor);
    fireEvent.click(medidor);
    expect(popover()).not.toBeInTheDocument();
  });

  it("o resumo (janela estreita) abre o mesmo popover", async () => {
    vi.spyOn(api, "lerConsumoDosOrquestradores").mockResolvedValue([]);
    renderizar();
    const resumo = screen.getByTestId("resumo-do-status");

    fireEvent.click(resumo);

    expect(resumo).toHaveAttribute("aria-expanded", "true");
    expect(popover()).toHaveTextContent("Limite de 7 dias");
    expect(await within(popover()!).findByText(/Nenhum pedido medido/)).toBeInTheDocument();
  });

  it("sem dados de cota, um \"cota —\" abre o popover, que explica quando a cota aparece", async () => {
    vi.spyOn(api, "lerConsumoDosOrquestradores").mockResolvedValue([]);
    renderizar(null);

    fireEvent.click(screen.getByRole("button", { name: "Cota: ainda sem dados" }));

    expect(popover()).toHaveTextContent("A cota aparece depois do primeiro pedido");
    expect(within(popover()!).queryByRole("progressbar")).not.toBeInTheDocument();
    expect(await within(popover()!).findByText(/Nenhum pedido medido/)).toBeInTheDocument();
  });
});

describe("descreverRenovacao", () => {
  it("diz em quanto tempo renova, em minutos, horas ou pela data", () => {
    expect(descreverRenovacao("2026-11-08T12:45:00Z", AGORA)).toBe("renova em 45 min");
    expect(descreverRenovacao("2026-11-08T14:00:00Z", AGORA)).toBe("renova em 2 h");
    expect(descreverRenovacao("2026-11-08T15:20:00Z", AGORA)).toBe("renova em 3 h 20 min");
    expect(descreverRenovacao("2026-11-12T15:00:00Z", AGORA)).toMatch(/^renova em 12\/11/);
    expect(descreverRenovacao("2026-11-08T11:00:00Z", AGORA)).toBe("já renovou: o uso atualiza no próximo pedido");
  });
});
