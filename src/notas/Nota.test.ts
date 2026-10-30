import { describe, expect, it } from "vitest";

import { ErroDeNota } from "./ErroDeNota";
import { Nota, TAMANHO_MAXIMO_DO_TEXTO, TAMANHO_MAXIMO_DO_TITULO } from "./Nota";

const criadaEm = new Date("2026-10-30T12:00:00Z");
const depois = new Date("2026-10-30T12:05:00Z");

function capturarErro(acao: () => unknown): ErroDeNota {
  try {
    acao();
  } catch (erro) {
    if (erro instanceof ErroDeNota) {
      return erro;
    }
  }
  throw new Error("Era esperado um ErroDeNota.");
}

const TITULO_INVALIDO = "O título da nota deve ter entre 1 e 120 caracteres.";
const TEXTO_LONGO = "A nota pode ter até 100.000 caracteres.";

describe("Nota", () => {
  it("nasce com o título padrão, sem texto e com criação e atualização no mesmo instante", () => {
    const nota = Nota.criar({ id: "n1", agora: criadaEm });

    expect(nota.paraDados()).toEqual({
      id: "n1",
      titulo: "Nova nota",
      texto: "",
      criadaEm: "2026-10-30T12:00:00.000Z",
      atualizadaEm: "2026-10-30T12:00:00.000Z",
    });
  });

  it("nasce com o título aparado e o texto exatamente como veio", () => {
    const nota = Nota.criar({ id: "n1", titulo: "  Pendências  ", texto: "  - revisar PR\n", agora: criadaEm });

    expect(nota.titulo).toBe("Pendências");
    expect(nota.texto).toBe("  - revisar PR\n");
  });

  it("renomear troca o título e atualiza atualizadaEm, sem mexer na criação", () => {
    const nota = Nota.criar({ id: "n1", agora: criadaEm });

    nota.renomear("  Ideias ", depois);

    expect(nota.titulo).toBe("Ideias");
    expect(nota.atualizadaEm).toEqual(depois);
    expect(nota.criadaEm).toEqual(criadaEm);
  });

  it("reescrever troca o texto e atualiza atualizadaEm", () => {
    const nota = Nota.criar({ id: "n1", agora: criadaEm });

    nota.reescrever("ligar para o cliente", depois);

    expect(nota.texto).toBe("ligar para o cliente");
    expect(nota.atualizadaEm).toEqual(depois);
  });

  it("renomear ou reescrever com o mesmo conteúdo não conta como alteração", () => {
    const nota = Nota.criar({ id: "n1", titulo: "A", texto: "b", agora: criadaEm });

    nota.renomear(" A ", depois);
    nota.reescrever("b", depois);

    expect(nota.atualizadaEm).toEqual(criadaEm);
  });

  it.each([[""], ["   "], ["x".repeat(TAMANHO_MAXIMO_DO_TITULO + 1)]])("recusa o título %j", (titulo) => {
    const nota = Nota.criar({ id: "n1", agora: criadaEm });

    const erro = capturarErro(() => nota.renomear(titulo, depois));

    expect(erro.motivo).toBe("dados_invalidos");
    expect(erro.message).toBe(TITULO_INVALIDO);
    expect(nota.titulo).toBe("Nova nota");
    expect(nota.atualizadaEm).toEqual(criadaEm);
  });

  it("aceita título com exatamente o limite de caracteres, contado depois de aparar", () => {
    const nota = Nota.criar({ id: "n1", titulo: ` ${"x".repeat(TAMANHO_MAXIMO_DO_TITULO)} `, agora: criadaEm });

    expect(nota.titulo).toHaveLength(TAMANHO_MAXIMO_DO_TITULO);
  });

  it("recusa texto acima do limite e aceita exatamente o limite", () => {
    const nota = Nota.criar({ id: "n1", agora: criadaEm });

    const erro = capturarErro(() => nota.reescrever("x".repeat(TAMANHO_MAXIMO_DO_TEXTO + 1), depois));
    nota.reescrever("x".repeat(TAMANHO_MAXIMO_DO_TEXTO), depois);

    expect(erro.motivo).toBe("dados_invalidos");
    expect(erro.message).toBe(TEXTO_LONGO);
    expect(nota.texto).toHaveLength(TAMANHO_MAXIMO_DO_TEXTO);
  });

  it("recusa criar com título vazio ou texto longo demais", () => {
    expect(capturarErro(() => Nota.criar({ id: "n1", titulo: " ", agora: criadaEm })).message).toBe(TITULO_INVALIDO);
    expect(
      capturarErro(() => Nota.criar({ id: "n1", texto: "x".repeat(TAMANHO_MAXIMO_DO_TEXTO + 1), agora: criadaEm }))
        .message,
    ).toBe(TEXTO_LONGO);
  });

  it("reconstitui exatamente os dados gravados", () => {
    const nota = Nota.criar({ id: "n1", titulo: "T", texto: "corpo", agora: criadaEm });
    nota.reescrever("corpo novo", depois);

    expect(Nota.reconstituir(nota.paraDados()).paraDados()).toEqual(nota.paraDados());
  });
});
