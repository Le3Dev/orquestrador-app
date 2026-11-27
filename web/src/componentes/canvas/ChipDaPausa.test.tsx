import { act, render, screen } from "@testing-library/react";

import { ChipDaPausa } from "./ChipDaPausa";

const DESDE = "2026-11-22T12:00:00Z";

describe("ChipDaPausa · pausa longa", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // 1 min 50 s de pausa: ainda curta.
    vi.setSystemTime(new Date("2026-11-22T12:01:50Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("congelado: antes de 2 min, só o tempo; passados 2 min, o aviso entra sozinho no chip e no tooltip", async () => {
    render(<ChipDaPausa desde={DESDE} modo="congelado" />);

    const chip = screen.getByText("⏸ pausado há 1 min");
    expect(chip).toHaveAttribute("title", expect.stringContaining("segue exatamente de onde parou") as string);
    expect(chip).not.toHaveAttribute("data-pausa-longa");

    // Exatamente 2 min ainda não é "mais de 2 min".
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(screen.queryByText(/o passo atual pode ser refeito/)).not.toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    const longo = screen.getByText("⏸ pausado há 2 min · ao continuar, o passo atual pode ser refeito");
    expect(longo).toHaveAttribute("data-pausa-longa");
    expect(longo).toHaveAttribute("title", expect.stringContaining("congelado há mais de 2 min") as string);
    expect(longo).toHaveAttribute("title", expect.stringContaining("o passo atual pode ser refeito") as string);
  });

  it("retomada: mesmo passados 2 min, sem aviso (o processo já foi encerrado)", async () => {
    vi.setSystemTime(new Date("2026-11-22T12:06:10Z"));
    render(<ChipDaPausa desde={DESDE} modo="retomada" />);

    const chip = screen.getByText("⏸ pausado há 6 min");
    expect(chip).not.toHaveAttribute("data-pausa-longa");
    expect(chip).toHaveAttribute("title", expect.stringContaining("o Continuar segue pela conversa") as string);
    expect(screen.queryByText(/o passo atual pode ser refeito/)).not.toBeInTheDocument();
  });

  it("uma pausa nova (outro desde) volta a contar do zero", async () => {
    vi.setSystemTime(new Date("2026-11-22T12:05:00Z"));
    const { rerender } = render(<ChipDaPausa desde={DESDE} modo="congelado" />);
    expect(screen.getByText(/o passo atual pode ser refeito/)).toBeInTheDocument();

    rerender(<ChipDaPausa desde="2026-11-22T12:04:30Z" modo="congelado" />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText("⏸ pausado agora")).toBeInTheDocument();
  });
});
