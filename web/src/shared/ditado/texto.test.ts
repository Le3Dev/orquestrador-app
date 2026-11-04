import { juntarDitado, mensagemDoErroDeDitado } from "./texto";

describe("juntarDitado", () => {
  it("campo vazio recebe só o ditado, sem espaços sobrando", () => {
    expect(juntarDitado("", "  crie um teste  ")).toBe("crie um teste");
    expect(juntarDitado("   ", "oi")).toBe("oi");
  });

  it("separa do texto anterior com um espaço, sem duplicar", () => {
    expect(juntarDitado("revise o módulo.", "Depois rode os testes.")).toBe("revise o módulo. Depois rode os testes.");
    expect(juntarDitado("linha um\n", "linha dois")).toBe("linha um\nlinha dois");
  });

  it("ditado vazio não mexe no campo", () => {
    expect(juntarDitado("já escrito", "   ")).toBe("já escrito");
  });
});

describe("mensagemDoErroDeDitado", () => {
  it("explica microfone negado, ausente e ocupado", () => {
    expect(mensagemDoErroDeDitado(new DOMException("x", "NotAllowedError"))).toMatch(/negado/);
    expect(mensagemDoErroDeDitado(new DOMException("x", "NotFoundError"))).toBe("Nenhum microfone encontrado.");
    expect(mensagemDoErroDeDitado(new DOMException("x", "NotReadableError"))).toMatch(/ocupado/);
  });

  it("falha de rede vira o aviso do download do modelo", () => {
    expect(mensagemDoErroDeDitado(new TypeError("Failed to fetch"))).toMatch(/baixar o modelo/);
  });

  it("outros erros mostram a mensagem original", () => {
    expect(mensagemDoErroDeDitado(new Error("deu ruim"))).toBe("O ditado falhou: deu ruim");
  });
});
