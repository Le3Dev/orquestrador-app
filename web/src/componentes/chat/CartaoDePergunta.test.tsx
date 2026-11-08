import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import type { PerguntaDoApp } from "../../shared/api/tipos";
import { CartaoDePergunta } from "./CartaoDePergunta";

const BANCO: PerguntaDoApp = {
  pergunta: "Qual banco usar?",
  opcoes: [
    { rotulo: "PostgreSQL", descricao: "Relacional, já usado no projeto" },
    { rotulo: "SQLite", descricao: null },
  ],
  multipla: false,
};

const RECURSOS: PerguntaDoApp = {
  pergunta: "Quais recursos incluir?",
  opcoes: [
    { rotulo: "Login", descricao: null },
    { rotulo: "Busca", descricao: null },
    { rotulo: "Relatórios", descricao: null },
  ],
  multipla: true,
};

function renderizar(
  perguntas: PerguntaDoApp[],
  { respondida = false, desabilitado = false }: { respondida?: boolean; desabilitado?: boolean } = {},
) {
  const aoResponder = vi.fn<(texto: string) => Promise<void>>().mockResolvedValue(undefined);
  const resultado = render(
    <CartaoDePergunta perguntas={perguntas} respondida={respondida} desabilitado={desabilitado} aoResponder={aoResponder} />,
  );
  return { ...resultado, aoResponder };
}

describe("CartaoDePergunta", () => {
  it("uma pergunta só, de escolha única: o clique já responde, no formato pergunta → escolha", async () => {
    const { aoResponder } = renderizar([BANCO]);

    expect(screen.getByRole("group", { name: "Qual banco usar?" })).toBeInTheDocument();
    expect(screen.getByText("Relacional, já usado no projeto")).toHaveClass("descricao-da-opcao");
    expect(screen.queryByRole("button", { name: "Responder" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "PostgreSQL" }));

    expect(aoResponder).toHaveBeenCalledWith("Qual banco usar? → PostgreSQL");
    // Trava na hora: um segundo clique não envia de novo.
    fireEvent.click(screen.getByRole("button", { name: "SQLite" }));
    expect(aoResponder).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByText(/· respondida/)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "PostgreSQL" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "PostgreSQL" })).toHaveClass("opcao-marcada");
  });

  it("escolha múltipla: marca e desmarca, e o Responder envia as escolhas na ordem das opções", async () => {
    const { aoResponder } = renderizar([RECURSOS]);
    const responder = screen.getByRole("button", { name: "Responder" });
    expect(responder).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Relatórios" }));
    fireEvent.click(screen.getByRole("button", { name: "Busca" }));
    fireEvent.click(screen.getByRole("button", { name: "Login" }));
    fireEvent.click(screen.getByRole("button", { name: "Busca" }));
    expect(aoResponder).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Login" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Busca" })).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(responder);

    expect(aoResponder).toHaveBeenCalledWith("Quais recursos incluir? → Login, Relatórios");
    await waitFor(() => expect(screen.queryByRole("button", { name: "Responder" })).not.toBeInTheDocument());
  });

  it("várias perguntas: o Responder só libera com todas respondidas e envia uma linha por pergunta", async () => {
    const { aoResponder } = renderizar([BANCO, RECURSOS]);
    const responder = screen.getByRole("button", { name: "Responder" });

    fireEvent.click(screen.getByRole("button", { name: "SQLite" }));
    expect(aoResponder).not.toHaveBeenCalled();
    expect(responder).toBeDisabled();

    // Na escolha única, outra opção substitui a anterior.
    fireEvent.click(screen.getByRole("button", { name: "PostgreSQL" }));
    fireEvent.click(screen.getByRole("button", { name: "Busca" }));
    expect(responder).toBeEnabled();

    fireEvent.click(responder);
    expect(aoResponder).toHaveBeenCalledWith("Qual banco usar? → PostgreSQL\nQuais recursos incluir? → Busca");
    await waitFor(() => expect(screen.getByText(/· respondida/)).toBeInTheDocument());
  });

  it("Outro… com Enter responde na hora numa pergunta só", async () => {
    const { aoResponder } = renderizar([BANCO]);
    const outro = screen.getByRole("textbox", { name: "Outra resposta para: Qual banco usar?" });

    fireEvent.keyDown(outro, { key: "Enter" });
    expect(aoResponder).not.toHaveBeenCalled();

    fireEvent.change(outro, { target: { value: "  MongoDB  " } });
    fireEvent.keyDown(outro, { key: "Enter" });

    expect(aoResponder).toHaveBeenCalledWith("Qual banco usar? → MongoDB");
    await waitFor(() => expect(screen.getByText(/· respondida/)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Outro: MongoDB" })).toBeDisabled();
  });

  it("Outro… em várias perguntas vira a resposta daquela pergunta (somado às marcadas, na múltipla)", async () => {
    const { aoResponder } = renderizar([BANCO, RECURSOS]);

    fireEvent.click(screen.getByRole("button", { name: "SQLite" }));
    const outroDoBanco = screen.getByRole("textbox", { name: "Outra resposta para: Qual banco usar?" });
    fireEvent.change(outroDoBanco, { target: { value: "MySQL" } });
    fireEvent.keyDown(outroDoBanco, { key: "Enter" });
    // Na escolha única, o texto substitui a opção marcada.
    expect(screen.getByRole("button", { name: "SQLite" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Outro: MySQL" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: "Login" }));
    const outroDosRecursos = screen.getByRole("textbox", { name: "Outra resposta para: Quais recursos incluir?" });
    fireEvent.change(outroDosRecursos, { target: { value: "Exportar CSV" } });
    fireEvent.click(screen.getAllByRole("button", { name: "usar" })[1] as HTMLElement);

    fireEvent.click(screen.getByRole("button", { name: "Responder" }));
    expect(aoResponder).toHaveBeenCalledWith(
      "Qual banco usar? → MySQL\nQuais recursos incluir? → Login, Exportar CSV",
    );
    await waitFor(() => expect(screen.getByText(/· respondida/)).toBeInTheDocument());
  });

  it("com uma mensagem depois, fica travado como respondido", () => {
    const { aoResponder } = renderizar([BANCO], { respondida: true });

    expect(screen.getByText(/· respondida/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "PostgreSQL" })).toBeDisabled();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "PostgreSQL" }));
    expect(aoResponder).not.toHaveBeenCalled();
  });

  it("desabilitado enquanto o Claude responde, e volta quando ele termina", () => {
    const { aoResponder, rerender } = renderizar([BANCO, RECURSOS], { desabilitado: true });

    expect(screen.getByRole("button", { name: "PostgreSQL" })).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "Outra resposta para: Qual banco usar?" })).toBeDisabled();
    expect(screen.queryByText(/· respondida/)).not.toBeInTheDocument();

    rerender(<CartaoDePergunta perguntas={[BANCO, RECURSOS]} respondida={false} desabilitado={false} aoResponder={aoResponder} />);
    expect(screen.getByRole("button", { name: "PostgreSQL" })).toBeEnabled();
  });

  it("se o envio falha, mostra o erro e deixa tentar de novo", async () => {
    const aoResponder = vi
      .fn<(texto: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error("Já existe uma resposta em andamento."))
      .mockResolvedValue(undefined);
    render(<CartaoDePergunta perguntas={[BANCO]} respondida={false} desabilitado={false} aoResponder={aoResponder} />);

    fireEvent.click(screen.getByRole("button", { name: "SQLite" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Já existe uma resposta em andamento.");

    fireEvent.click(screen.getByRole("button", { name: "SQLite" }));
    expect(aoResponder).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(screen.getByText(/· respondida/)).toBeInTheDocument());
  });
});
