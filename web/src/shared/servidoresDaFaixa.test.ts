import { LIMITE_DE_ENDERECOS } from "./enderecosLocais";
import { enderecoSemLixo, servidoresDaFaixa, tirarServidores } from "./servidoresDaFaixa";

const TELA = "http://localhost:4173";

describe("enderecoSemLixo", () => {
  it.each([
    ["http://localhost:5173", true],
    ["http://localhost:5173/app?x=1", true],
    ["http://localhost:4391/ilha-teste-tmp.html?v=${v", false],
    ["http://localhost:3000/{id}", false],
    ["http://localhost:3000/a}", false],
    ["http://localhost:3000/$1", false],
  ])("%s: %s", (endereco, esperado) => {
    expect(enderecoSemLixo(endereco)).toBe(esperado);
  });
});

describe("servidoresDaFaixa", () => {
  it("lista o mais recente primeiro, sem os da própria tela e sem lixo de código", () => {
    const lista = servidoresDaFaixa(
      ["http://localhost:3000", "http://localhost:4391/x?v=${v", TELA, "http://localhost:5173"],
      {},
      {},
      TELA,
    );

    expect(lista).toEqual(["http://localhost:5173", "http://localhost:3000"]);
  });

  it("guarda até o limite de endereços da conversa", () => {
    const todos = Array.from({ length: LIMITE_DE_ENDERECOS + 2 }, (_, indice) => `http://localhost:${5000 + indice}`);

    expect(servidoresDaFaixa(todos, {}, {}, TELA)).toHaveLength(LIMITE_DE_ENDERECOS);
  });

  it("esconde o que o usuário tirou, e o traz de volta com um anúncio de sequência maior", () => {
    const enderecos = ["http://localhost:3000", "http://localhost:5173"];
    const tirados = { "http://localhost:5173": 7 };

    expect(servidoresDaFaixa(enderecos, { "http://localhost:3000": 2, "http://localhost:5173": 7 }, tirados, TELA)).toEqual([
      "http://localhost:3000",
    ]);
    // Anunciado de novo (sequência 9 > 7): volta.
    expect(servidoresDaFaixa(enderecos, { "http://localhost:3000": 2, "http://localhost:5173": 9 }, tirados, TELA)).toEqual([
      "http://localhost:5173",
      "http://localhost:3000",
    ]);
  });
});

describe("tirarServidores", () => {
  it("soma os endereços tirados com a sequência do último anúncio de cada um", () => {
    const tirados = tirarServidores(
      { "http://localhost:3000": 2 },
      ["http://localhost:5173", "http://localhost:4000"],
      { "http://localhost:5173": 8 },
    );

    expect(tirados).toEqual({ "http://localhost:3000": 2, "http://localhost:5173": 8, "http://localhost:4000": 0 });
  });
});
