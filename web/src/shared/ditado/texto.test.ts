import { anuncioDoDitado, formatarCronometro, juntarDitado, mensagemDoErroDeDitado } from "./texto";

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

  it("navegador sem acesso ao microfone vira aviso em português", () => {
    expect(mensagemDoErroDeDitado(new DOMException("Not supported", "NotSupportedError"))).toBe(
      "O ditado falhou: este navegador não deu acesso ao microfone.",
    );
  });

  it("erros desconhecidos viram mensagem genérica em português, sem o texto cru", () => {
    const generica = "O ditado falhou. Tente de novo ou digite o texto.";
    expect(mensagemDoErroDeDitado(new Error("Not supported"))).toBe(generica);
    expect(mensagemDoErroDeDitado(new DOMException("Unknown", "UnknownError"))).toBe(generica);
    expect(mensagemDoErroDeDitado("qualquer coisa")).toBe(generica);
  });
});

describe("formatarCronometro", () => {
  it("formata em mm:ss", () => {
    expect(formatarCronometro(0)).toBe("00:00");
    expect(formatarCronometro(7.9)).toBe("00:07");
    expect(formatarCronometro(65)).toBe("01:05");
    expect(formatarCronometro(600)).toBe("10:00");
    expect(formatarCronometro(-3)).toBe("00:00");
  });
});

describe("anuncioDoDitado", () => {
  it("anuncia cada fase para o leitor de tela", () => {
    expect(anuncioDoDitado("parado", null, false)).toBe("");
    expect(anuncioDoDitado("pedindo-microfone", null, false)).toMatch(/Permita o acesso ao microfone/);
    expect(anuncioDoDitado("gravando", null, false)).toMatch(/Enter conclui, Esc descarta/);
    expect(anuncioDoDitado("transcrevendo", null, false)).toMatch(/Transcrevendo/);
    expect(anuncioDoDitado("transcrevendo", 30, false)).toMatch(/Baixando o modelo/);
    expect(anuncioDoDitado("parado", null, true)).toMatch(/Texto adicionado/);
  });
});

describe("mensagem de microfone negado", () => {
  it("diz onde liberar no Mac", () => {
    expect(mensagemDoErroDeDitado(new DOMException("x", "NotAllowedError"))).toMatch(
      /Ajustes do Sistema › Privacidade e Segurança › Microfone/,
    );
  });
});
