import {
  abrirPreviaSozinha,
  enderecoCurto,
  enderecoDigitado,
  enderecosParaPrevia,
  juntarEnderecos,
  LIMITE_DE_ENDERECOS,
  normalizarEndereco,
} from "./enderecosLocais";

describe("normalizarEndereco", () => {
  it.each([
    ["http://localhost:5173/", "http://localhost:5173"],
    ["http://localhost:5173", "http://localhost:5173"],
    ["http://0.0.0.0:3000/", "http://localhost:3000"],
    ["http://127.0.0.1:8080/app", "http://localhost:8080/app"],
    ["http://[::1]:4321/", "http://localhost:4321"],
    ["HTTPS://LocalHost:5173/docs/", "https://localhost:5173/docs/"],
    ["http://localhost:5173.", "http://localhost:5173"],
    ["http://localhost:5173/),", "http://localhost:5173"],
    // Os mesmos caracteres que o servidor mantém no caminho: o endereço do evento chega intacto.
    ["http://localhost:5173/foo_", "http://localhost:5173/foo_"],
    ["http://localhost:5173/a)b", "http://localhost:5173/a)b"],
  ])("%s vira %s", (bruto, esperado) => {
    expect(normalizarEndereco(bruto)).toBe(esperado);
  });

  it.each(["http://example.com:5173", "ftp://localhost:21", "http://localhost", "http://localhost:0", "http://localhost:70000", "localhost:5173"])(
    "não é um servidor local: %s",
    (bruto) => {
      expect(normalizarEndereco(bruto)).toBeNull();
    },
  );
});

describe("juntarEnderecos", () => {
  it("põe o mais recente por último, sem repetir", () => {
    expect(juntarEnderecos(["a", "b"], ["a", "c"])).toEqual(["b", "a", "c"]);
  });

  it("devolve o mesmo array quando nada muda", () => {
    const atuais = ["a", "b"];

    expect(juntarEnderecos(atuais, [])).toBe(atuais);
    expect(juntarEnderecos(atuais, ["b"])).toBe(atuais);
  });

  it("guarda só os últimos", () => {
    const muitos = Array.from({ length: LIMITE_DE_ENDERECOS + 3 }, (_, indice) => `e${indice}`);

    const juntos = juntarEnderecos([], muitos);
    expect(juntos).toHaveLength(LIMITE_DE_ENDERECOS);
    expect(juntos.at(-1)).toBe(`e${LIMITE_DE_ENDERECOS + 2}`);
  });
});

describe("enderecoDigitado", () => {
  it.each([
    ["localhost:5173", "http://localhost:5173"],
    ["  http://127.0.0.1:3000/  ", "http://localhost:3000"],
    ["https://localhost:5173/app", "https://localhost:5173/app"],
    ["example.com", "http://example.com"],
    ["https://example.com/a?b=1", "https://example.com/a?b=1"],
  ])("%s vira %s", (digitado, esperado) => {
    expect(enderecoDigitado(digitado)).toBe(esperado);
  });

  it.each(["", "   ", "javascript:alert(1)", "file:///etc/passwd", "ftp://localhost:21", "http://"])(
    "recusa %s",
    (digitado) => {
      expect(enderecoDigitado(digitado)).toBeNull();
    },
  );
});

describe("enderecosParaPrevia", () => {
  it("oferece os três mais recentes, o último primeiro, sem o endereço da própria tela", () => {
    const enderecos = ["http://localhost:1111", "http://localhost:2222", "http://localhost:3200/api", "http://localhost:4444", "http://localhost:5555"];

    expect(enderecosParaPrevia(enderecos, "http://localhost:3200")).toEqual([
      "http://localhost:5555",
      "http://localhost:4444",
      "http://localhost:2222",
    ]);
  });

  it("reconhece a tela aberta por 127.0.0.1", () => {
    expect(enderecosParaPrevia(["http://localhost:3200"], "http://127.0.0.1:3200")).toEqual([]);
  });
});

describe("enderecoCurto", () => {
  it("tira o esquema", () => {
    expect(enderecoCurto("http://localhost:5173/app")).toBe("localhost:5173/app");
  });
});

describe("abrirPreviaSozinha", () => {
  const agora = Date.parse("2026-11-06T15:30:00Z");
  const origem = "http://localhost:3200";

  it("abre o servidor que acabou de subir", () => {
    expect(abrirPreviaSozinha({ url: "http://localhost:4173", em: "2026-11-06T15:29:50Z" }, agora, origem)).toBe(true);
  });

  it("não abre o anúncio antigo, relido do histórico", () => {
    expect(abrirPreviaSozinha({ url: "http://localhost:4173", em: "2026-11-06T15:20:00Z" }, agora, origem)).toBe(false);
  });

  it("não abre a própria tela nem sem anúncio", () => {
    expect(abrirPreviaSozinha({ url: "http://localhost:3200", em: "2026-11-06T15:29:59Z" }, agora, origem)).toBe(false);
    expect(abrirPreviaSozinha(null, agora, origem)).toBe(false);
  });

  it("hora inválida não abre", () => {
    expect(abrirPreviaSozinha({ url: "http://localhost:4173", em: "ontem" }, agora, origem)).toBe(false);
  });
});
