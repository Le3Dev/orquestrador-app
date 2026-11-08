import { act, renderHook, waitFor } from "@testing-library/react";
import { useState } from "react";

import { api, ErroDaApi } from "../api/cliente";
import type { OndeDoPrompt, PromptMelhorado } from "../api/tipos";
import { useMelhorarPrompt } from "./useMelhorarPrompt";

const RESPOSTA: PromptMelhorado = {
  texto: "Liste os arquivos de teste da pasta src e diga quais falham.",
  uso: { entrada: 1200, criacaoDeCache: 0, leituraDeCache: 0, saida: 80 },
  indiceDeCusto: 19_800,
  duracaoMs: 2100,
};

/** O hook junto de um campo de verdade (o texto mora no "componente"). */
function useCampo(inicial: string, onde: OndeDoPrompt, pasta?: string) {
  const [texto, setTexto] = useState(inicial);
  const melhoria = useMelhorarPrompt({ texto, aoTrocarTexto: setTexto, onde, ...(pasta ? { pasta } : {}) });
  return { texto, setTexto, melhoria };
}

function renderizar(inicial = "ve os testes ai", onde: OndeDoPrompt = "chat", pasta?: string) {
  return renderHook(() => useCampo(inicial, onde, pasta));
}

/** Uma promessa que o teste resolve ou rejeita quando quiser. */
function adiada<Valor>() {
  let resolver: (valor: Valor) => void = () => undefined;
  let rejeitar: (erro: unknown) => void = () => undefined;
  const promessa = new Promise<Valor>((resolve, reject) => {
    resolver = resolve;
    rejeitar = reject;
  });
  return { promessa, resolver, rejeitar };
}

describe("useMelhorarPrompt", () => {
  afterEach(() => vi.restoreAllMocks());

  it("sucesso: troca o texto do campo e guarda o original e o índice", async () => {
    const melhorar = vi.spyOn(api, "melhorarPrompt").mockResolvedValue(RESPOSTA);
    const { result } = renderizar("ve os testes ai", "orquestrador", "painel-app");

    act(() => result.current.melhoria.melhorar());
    expect(result.current.melhoria.estado).toEqual({ fase: "melhorando" });
    expect(result.current.melhoria.melhorando).toBe(true);
    expect(melhorar).toHaveBeenCalledWith(
      { texto: "ve os testes ai", onde: "orquestrador", pasta: "painel-app" },
      expect.any(AbortSignal),
    );

    await waitFor(() => expect(result.current.texto).toBe(RESPOSTA.texto));
    expect(result.current.melhoria.estado).toEqual({
      fase: "melhorado",
      original: "ve os testes ai",
      melhorado: RESPOSTA.texto,
      indiceDeCusto: 19_800,
    });
  });

  it("no chat não manda pasta", () => {
    const melhorar = vi.spyOn(api, "melhorarPrompt").mockReturnValue(new Promise(() => undefined));
    const { result } = renderizar("oi");

    act(() => result.current.melhoria.melhorar());
    expect(melhorar).toHaveBeenCalledWith({ texto: "oi", onde: "chat" }, expect.any(AbortSignal));
  });

  it("desfazer volta o texto original", async () => {
    vi.spyOn(api, "melhorarPrompt").mockResolvedValue(RESPOSTA);
    const { result } = renderizar();

    act(() => result.current.melhoria.melhorar());
    await waitFor(() => expect(result.current.melhoria.estado.fase).toBe("melhorado"));

    act(() => result.current.melhoria.desfazer());
    expect(result.current.texto).toBe("ve os testes ai");
    expect(result.current.melhoria.estado).toEqual({ fase: "ocioso" });
  });

  it("editar o texto depois da melhoria tira o desfazer", async () => {
    vi.spyOn(api, "melhorarPrompt").mockResolvedValue(RESPOSTA);
    const { result } = renderizar();

    act(() => result.current.melhoria.melhorar());
    await waitFor(() => expect(result.current.melhoria.estado.fase).toBe("melhorado"));

    act(() => result.current.setTexto(`${RESPOSTA.texto} Use o vitest.`));
    expect(result.current.melhoria.estado).toEqual({ fase: "ocioso" });
    act(() => result.current.melhoria.desfazer());
    expect(result.current.texto).toBe(`${RESPOSTA.texto} Use o vitest.`);
  });

  it("cancelar aborta o pedido e deixa o texto como estava", async () => {
    const pendente = adiada<PromptMelhorado>();
    let sinal: AbortSignal | undefined;
    vi.spyOn(api, "melhorarPrompt").mockImplementation((_dados, recebido) => {
      sinal = recebido;
      return pendente.promessa;
    });
    const { result } = renderizar();

    act(() => result.current.melhoria.melhorar());
    expect(sinal?.aborted).toBe(false);

    act(() => result.current.melhoria.cancelar());
    expect(sinal?.aborted).toBe(true);
    expect(result.current.melhoria.estado).toEqual({ fase: "ocioso" });

    // A resposta que chegar depois do cancelamento não troca nada.
    await act(async () => pendente.resolver(RESPOSTA));
    expect(result.current.texto).toBe("ve os testes ai");
    expect(result.current.melhoria.estado).toEqual({ fase: "ocioso" });
  });

  it("erro: mostra a mensagem e o texto original fica intacto; editar tira a mensagem", async () => {
    vi.spyOn(api, "melhorarPrompt").mockRejectedValue(new ErroDaApi("O Claude Code não respondeu.", 502));
    const { result } = renderizar();

    act(() => result.current.melhoria.melhorar());
    await waitFor(() => expect(result.current.melhoria.estado.fase).toBe("erro"));
    expect(result.current.melhoria.estado).toMatchObject({
      mensagem: "Não foi possível melhorar o pedido: O Claude Code não respondeu.",
    });
    expect(result.current.texto).toBe("ve os testes ai");

    act(() => result.current.setTexto("ve os testes ai agora"));
    expect(result.current.melhoria.estado).toEqual({ fase: "ocioso" });
  });

  it("campo vazio não chama o servidor", () => {
    const melhorar = vi.spyOn(api, "melhorarPrompt");
    const { result } = renderizar("   ");

    act(() => result.current.melhoria.melhorar());
    expect(melhorar).not.toHaveBeenCalled();
    expect(result.current.melhoria.estado).toEqual({ fase: "ocioso" });
  });
});
