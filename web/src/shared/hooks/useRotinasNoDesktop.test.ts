import { renderHook } from "@testing-library/react";
import type { Mock } from "vitest";

import type { DadosDaExecucao } from "../api/rotinas";
import type { AprovacaoPendente } from "./useRotinas";
import { ponteDasRotinas, type PonteDasRotinas, useRotinasNoDesktop } from "./useRotinasNoDesktop";

type JanelaComPonte = { electron?: { desktop?: boolean; rotinas?: PonteDasRotinas } };

function pendente(id: string, rotina: string): AprovacaoPendente {
  return {
    rotinaNome: rotina,
    execucao: {
      id,
      rotinaId: `r-${id}`,
      rotinaNome: rotina,
      situacao: "aguardando_aprovacao",
    } as DadosDaExecucao,
  };
}

describe("useRotinasNoDesktop", () => {
  let informarSituacao: Mock<PonteDasRotinas["informarSituacao"]>;
  let cancelar: Mock<() => void>;
  let pedirPainel: () => void;

  beforeEach(() => {
    informarSituacao = vi.fn<PonteDasRotinas["informarSituacao"]>(() => Promise.resolve());
    cancelar = vi.fn<() => void>();
    pedirPainel = () => undefined;
    (window as unknown as JanelaComPonte).electron = {
      desktop: true,
      rotinas: {
        informarSituacao,
        aoPedirPainel: (callback) => {
          pedirPainel = callback;
          return cancelar;
        },
      },
    };
  });

  afterEach(() => {
    delete (window as unknown as JanelaComPonte).electron;
    vi.restoreAllMocks();
  });

  it("informa ao app quantas rotinas estão ativas e quais execuções aguardam aprovação", () => {
    renderHook(() =>
      useRotinasNoDesktop({
        carregada: true,
        ativas: 3,
        aprovacoesPendentes: [pendente("e1", "Relatório"), pendente("e2", "Testes")],
        aoPedirPainel: vi.fn(),
      }),
    );

    expect(informarSituacao).toHaveBeenCalledTimes(1);
    expect(informarSituacao).toHaveBeenCalledWith({
      ativas: 3,
      aguardandoAprovacao: 2,
      pendentes: [
        { id: "e1", rotina: "Relatório" },
        { id: "e2", rotina: "Testes" },
      ],
    });
  });

  it("não informa nada antes de a lista carregar (zero rotinas seria mentira)", () => {
    renderHook(() => useRotinasNoDesktop({ carregada: false, ativas: 0, aprovacoesPendentes: [], aoPedirPainel: vi.fn() }));

    expect(informarSituacao).not.toHaveBeenCalled();
  });

  it("só reenvia quando algo muda", () => {
    const aoPedirPainel = vi.fn();
    const { rerender } = renderHook(
      ({ ativas, pendentes }: { ativas: number; pendentes: AprovacaoPendente[] }) =>
        useRotinasNoDesktop({ carregada: true, ativas, aprovacoesPendentes: pendentes, aoPedirPainel }),
      { initialProps: { ativas: 1, pendentes: [] as AprovacaoPendente[] } },
    );

    // Uma lista nova com o mesmo conteúdo (um evento de etapa) não é mudança.
    rerender({ ativas: 1, pendentes: [] });
    expect(informarSituacao).toHaveBeenCalledTimes(1);

    rerender({ ativas: 2, pendentes: [] });
    expect(informarSituacao).toHaveBeenCalledTimes(2);

    rerender({ ativas: 2, pendentes: [pendente("e1", "Relatório")] });
    expect(informarSituacao).toHaveBeenCalledTimes(3);
    expect(informarSituacao).toHaveBeenLastCalledWith({
      ativas: 2,
      aguardandoAprovacao: 1,
      pendentes: [{ id: "e1", rotina: "Relatório" }],
    });
  });

  it("repassa o pedido do app para abrir o painel e cancela a inscrição ao sair", () => {
    const aoPedirPainel = vi.fn();
    const { unmount } = renderHook(() =>
      useRotinasNoDesktop({ carregada: true, ativas: 1, aprovacoesPendentes: [], aoPedirPainel }),
    );

    pedirPainel();
    expect(aoPedirPainel).toHaveBeenCalledTimes(1);

    unmount();
    expect(cancelar).toHaveBeenCalledTimes(1);
  });

  it("uma falha ao avisar o app vai para o console e não quebra a tela", async () => {
    const erro = vi.spyOn(console, "error").mockImplementation(() => undefined);
    informarSituacao.mockRejectedValue(new Error("canal fechado"));

    renderHook(() => useRotinasNoDesktop({ carregada: true, ativas: 1, aprovacoesPendentes: [], aoPedirPainel: vi.fn() }));
    await Promise.resolve();
    await Promise.resolve();

    expect(erro).toHaveBeenCalled();
  });

  it("fora do app desktop (navegador) não faz nada", () => {
    delete (window as unknown as JanelaComPonte).electron;

    expect(ponteDasRotinas()).toBeNull();
    expect(() =>
      renderHook(() => useRotinasNoDesktop({ carregada: true, ativas: 1, aprovacoesPendentes: [], aoPedirPainel: vi.fn() })),
    ).not.toThrow();
    expect(informarSituacao).not.toHaveBeenCalled();
  });

  it("um app sem a ponte das rotinas (versão antiga) também é ignorado", () => {
    (window as unknown as JanelaComPonte).electron = { desktop: true };

    expect(ponteDasRotinas()).toBeNull();
  });
});
