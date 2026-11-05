import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { api } from "../../shared/api/cliente";
import type { AutorizacaoPendente } from "../../shared/api/tipos";
import { CartaoDeAutorizacao, PERGUNTA_APOS_AUTORIZAR } from "./CartaoDeAutorizacao";

const RODAR: AutorizacaoPendente = { acao: "rodar_comando", detalhe: "npm test" };
const EDITAR: AutorizacaoPendente = { acao: "editar", detalhe: "src/x.ts" };
const AUTORIZAR = "Autorizar até o /clear e continuar";

function renderizar({
  autorizacao = RODAR,
  autorizado = false,
  desabilitado = false,
  aoEnviarPergunta = vi.fn<(pergunta: string) => Promise<void>>().mockResolvedValue(undefined),
}: {
  autorizacao?: AutorizacaoPendente;
  autorizado?: boolean;
  desabilitado?: boolean;
  aoEnviarPergunta?: (pergunta: string) => Promise<void>;
} = {}) {
  const resultado = render(
    <CartaoDeAutorizacao
      autorizacao={autorizacao}
      autorizado={autorizado}
      desabilitado={desabilitado}
      aoEnviarPergunta={aoEnviarPergunta}
    />,
  );
  return { ...resultado, aoEnviarPergunta };
}

const cartao = () => screen.queryByRole("group", { name: "Pedido de autorização do chat" });

describe("CartaoDeAutorizacao", () => {
  afterEach(() => vi.restoreAllMocks());

  it("rodar comando: mostra o comando e explica que vale até o /clear", () => {
    renderizar();

    expect(cartao()).toHaveTextContent("O chat quer rodar npm test");
    expect(screen.getByText("npm test").tagName).toBe("CODE");
    expect(
      screen.getByText(
        "Autorizando, ele poderá editar arquivos e rodar comandos nos projetos sem perguntar de novo, até o próximo /clear.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: AUTORIZAR })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Agora não" })).toBeEnabled();
  });

  it("editar: mostra o arquivo", () => {
    renderizar({ autorizacao: EDITAR });
    expect(cartao()).toHaveTextContent("O chat quer editar src/x.ts");
  });

  it("Autorizar chama o PATCH e depois envia a pergunta de continuar, nessa ordem", async () => {
    const autorizar = vi.spyOn(api, "autorizarAlteracoesDoChat").mockResolvedValue({ autorizado: true });
    const { aoEnviarPergunta } = renderizar();

    fireEvent.click(screen.getByRole("button", { name: AUTORIZAR }));

    await waitFor(() => expect(aoEnviarPergunta).toHaveBeenCalledWith(PERGUNTA_APOS_AUTORIZAR));
    expect(PERGUNTA_APOS_AUTORIZAR).toBe("Autorizado. Continue de onde parou.");
    expect(autorizar).toHaveBeenCalledWith(true);
    const ordemDoPatch = autorizar.mock.invocationCallOrder[0] ?? Infinity;
    const ordemDoEnvio = vi.mocked(aoEnviarPergunta).mock.invocationCallOrder[0] ?? -Infinity;
    expect(ordemDoPatch).toBeLessThan(ordemDoEnvio);
    // Feito: o cartão some.
    await waitFor(() => expect(cartao()).not.toBeInTheDocument());
  });

  it("erro no PATCH mostra a mensagem, não envia nada e permite tentar de novo", async () => {
    const autorizar = vi
      .spyOn(api, "autorizarAlteracoesDoChat")
      .mockRejectedValueOnce(new Error("Não foi possível falar com o servidor."))
      .mockResolvedValueOnce({ autorizado: true });
    const { aoEnviarPergunta } = renderizar();

    fireEvent.click(screen.getByRole("button", { name: AUTORIZAR }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível falar com o servidor.");
    expect(aoEnviarPergunta).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "tentar de novo" }));
    await waitFor(() => expect(aoEnviarPergunta).toHaveBeenCalledTimes(1));
    expect(autorizar).toHaveBeenCalledTimes(2);
  });

  it("erro no envio depois de autorizado continua visível, mesmo com o chat já autorizado", async () => {
    vi.spyOn(api, "autorizarAlteracoesDoChat").mockResolvedValue({ autorizado: true });
    const aoEnviarPergunta = vi
      .fn<(pergunta: string) => Promise<void>>()
      .mockRejectedValue(new Error("Já há uma resposta em andamento."));
    const { rerender } = renderizar({ aoEnviarPergunta });

    fireEvent.click(screen.getByRole("button", { name: AUTORIZAR }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Já há uma resposta em andamento.");

    // O evento `alteracoes_autorizadas` chegou: o erro não some junto com o cartão.
    rerender(
      <CartaoDeAutorizacao autorizacao={RODAR} autorizado desabilitado={false} aoEnviarPergunta={aoEnviarPergunta} />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Já há uma resposta em andamento.");
    expect(screen.getByRole("button", { name: "tentar de novo" })).toBeEnabled();
  });

  it("Agora não só esconde o cartão, sem chamar o servidor nem enviar", () => {
    const autorizar = vi.spyOn(api, "autorizarAlteracoesDoChat");
    const { aoEnviarPergunta } = renderizar();

    fireEvent.click(screen.getByRole("button", { name: "Agora não" }));

    expect(cartao()).not.toBeInTheDocument();
    expect(autorizar).not.toHaveBeenCalled();
    expect(aoEnviarPergunta).not.toHaveBeenCalled();
  });

  it("desabilitado (resposta em andamento ou servidor fora): não autoriza", () => {
    const autorizar = vi.spyOn(api, "autorizarAlteracoesDoChat");
    renderizar({ desabilitado: true });

    const botao = screen.getByRole("button", { name: AUTORIZAR });
    expect(botao).toBeDisabled();
    fireEvent.click(botao);
    expect(autorizar).not.toHaveBeenCalled();
  });

  it("já autorizado, o cartão não aparece", () => {
    renderizar({ autorizado: true });
    expect(cartao()).not.toBeInTheDocument();
  });
});
