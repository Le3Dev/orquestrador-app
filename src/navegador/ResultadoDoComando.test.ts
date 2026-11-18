import { describe, expect, it } from "vitest";

import { ErroDoNavegador } from "./ErroDoNavegador";
import { criarResultadoDoComando } from "./ResultadoDoComando";

describe("criarResultadoDoComando", () => {
  it("copia o resultado simples", () => {
    expect(
      criarResultadoDoComando({ url: "https://exemplo.com/", titulo: "Exemplo", mensagem: "Página aberta.", sobra: 1 }),
    ).toEqual({ url: "https://exemplo.com/", titulo: "Exemplo", mensagem: "Página aberta." });
  });

  it("copia a leitura da página com os elementos", () => {
    const resultado = criarResultadoDoComando({
      url: "https://exemplo.com/",
      titulo: "Exemplo",
      mensagem: "Li a página.",
      pagina: {
        texto: "Olá",
        textoTruncado: true,
        elementosOmitidos: 3,
        elementos: [
          { ref: 1, tipo: "link", nome: "Entrar", destino: "https://exemplo.com/entrar" },
          { ref: 2, tipo: "campo", nome: "Email", valor: "a@b.c", estado: "desabilitado" },
          { ref: 3, tipo: "botão", nome: "" },
        ],
      },
    });
    expect(resultado.pagina).toEqual({
      texto: "Olá",
      textoTruncado: true,
      elementosOmitidos: 3,
      elementos: [
        { ref: 1, tipo: "link", nome: "Entrar", destino: "https://exemplo.com/entrar" },
        { ref: 2, tipo: "campo", nome: "Email", valor: "a@b.c", estado: "desabilitado" },
        { ref: 3, tipo: "botão", nome: "" },
      ],
    });
  });

  it("copia a imagem capturada", () => {
    const resultado = criarResultadoDoComando({
      url: "https://exemplo.com/",
      titulo: "",
      mensagem: "Captura da tela.",
      imagem: { base64: "AAAA", tipoDeMidia: "image/jpeg" },
    });
    expect(resultado.imagem).toEqual({ base64: "AAAA", tipoDeMidia: "image/jpeg" });
  });

  it("devolve um objeto imutável", () => {
    expect(Object.isFrozen(criarResultadoDoComando({ url: "u", titulo: "t", mensagem: "m" }))).toBe(true);
  });

  it.each([
    ["não é objeto", "texto"],
    ["nulo", null],
    ["url com o tipo errado", { url: 1, titulo: "", mensagem: "" }],
    ["página sem a lista de elementos", { url: "", titulo: "", mensagem: "", pagina: { texto: "" } }],
    ["elemento sem ref", { url: "", titulo: "", mensagem: "", pagina: { texto: "", elementos: [{ tipo: "link" }] } }],
    ["imagem sem dados", { url: "", titulo: "", mensagem: "", imagem: { base64: "", tipoDeMidia: "image/png" } }],
    ["imagem de tipo desconhecido", { url: "", titulo: "", mensagem: "", imagem: { base64: "AA", tipoDeMidia: "text/html" } }],
  ])("recusa uma resposta inválida: %s", (_rotulo, bruto) => {
    expect(() => criarResultadoDoComando(bruto)).toThrow(ErroDoNavegador);
  });
});
