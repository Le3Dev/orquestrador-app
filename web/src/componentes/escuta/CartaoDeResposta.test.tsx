import { render, screen, within } from "@testing-library/react";

import { CartaoDeResposta } from "./CartaoDeResposta";

const PERGUNTA = "Como você priorizaria as tarefas de um sprint com prazo apertado e equipe reduzida?";

describe("CartaoDeResposta", () => {
  it("vazio: orienta onde as respostas aparecem", () => {
    render(<CartaoDeResposta resposta={null} />);

    const cartao = screen.getByRole("region", { name: "Resposta da escuta" });
    expect(cartao).toHaveTextContent("As respostas às perguntas detectadas aparecem aqui.");
    expect(cartao).toHaveAttribute("aria-busy", "false");
  });

  it("carregando: a pergunta no topo e a espera discreta", () => {
    render(<CartaoDeResposta resposta={{ pergunta: PERGUNTA, texto: null, carregando: true }} />);

    const cartao = screen.getByRole("region", { name: "Resposta da escuta" });
    expect(cartao).toHaveAttribute("aria-busy", "true");
    expect(within(cartao).getByRole("status")).toHaveTextContent("preparando a resposta…");
    expect(screen.queryByText("As respostas às perguntas detectadas aparecem aqui.")).not.toBeInTheDocument();
  });

  it("a pergunta fica numa linha, com o texto inteiro no title", () => {
    render(<CartaoDeResposta resposta={{ pergunta: PERGUNTA, texto: null, carregando: true }} />);

    const pergunta = screen.getByText(PERGUNTA);
    expect(pergunta).toHaveClass("texto-da-pergunta-do-cartao");
    expect(pergunta).toHaveAttribute("title", PERGUNTA);
  });

  it("com a resposta: os tópicos em Markdown, sem a espera", () => {
    render(
      <CartaoDeResposta
        resposta={{
          pergunta: PERGUNTA,
          texto: "- **Impacto** primeiro\n- Cortar o escopo\n- Alinhar com o time",
          carregando: false,
        }}
      />,
    );

    const cartao = screen.getByRole("region", { name: "Resposta da escuta" });
    const itens = within(cartao).getAllByRole("listitem");
    expect(itens).toHaveLength(3);
    expect(itens[0]).toHaveTextContent("Impacto primeiro");
    expect(within(cartao).getByText("Impacto").tagName).toBe("STRONG");
    expect(within(cartao).queryByRole("status")).not.toBeInTheDocument();
  });

  it("a resposta chegando aos poucos mostra o texto e a espera juntos", () => {
    render(<CartaoDeResposta resposta={{ pergunta: PERGUNTA, texto: "- Primeiro ponto", carregando: true }} />);

    expect(screen.getByRole("listitem")).toHaveTextContent("Primeiro ponto");
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("sem resposta e sem espera: avisa", () => {
    render(<CartaoDeResposta resposta={{ pergunta: PERGUNTA, texto: null, carregando: false }} />);
    expect(screen.getByText("Sem resposta para esta pergunta.")).toBeInTheDocument();
  });
});
