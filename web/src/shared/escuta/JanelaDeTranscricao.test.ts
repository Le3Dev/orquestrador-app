import { DURACAO_DA_JANELA_MS, DURACAO_DO_CONTEXTO_MS, JanelaDeTranscricao } from "./JanelaDeTranscricao";
import { TrechoTranscrito } from "./TrechoTranscrito";

const trecho = (texto: string, inicioMs: number, fimMs: number): TrechoTranscrito =>
  TrechoTranscrito.criar({ texto, inicioMs, fimMs });

describe("JanelaDeTranscricao", () => {
  it("começa vazia, com 2 min de janela e 60 s de contexto", () => {
    const janela = JanelaDeTranscricao.vazia();
    expect(DURACAO_DA_JANELA_MS).toBe(120_000);
    expect(DURACAO_DO_CONTEXTO_MS).toBe(60_000);
    expect(janela.duracaoMs).toBe(120_000);
    expect(janela.trechos).toEqual([]);
    expect(janela.estaVazia).toBe(true);
    expect(janela.contexto()).toBe("");
    expect(() => JanelaDeTranscricao.vazia(0)).toThrow(/inválida/);
  });

  it("com devolve uma janela nova e não mexe na anterior", () => {
    const vazia = JanelaDeTranscricao.vazia();
    const comUm = vazia.com(trecho("um", 0, 1_000));
    expect(vazia.trechos).toHaveLength(0);
    expect(comUm.trechos.map((t) => t.texto)).toEqual(["um"]);
    expect(Object.isFrozen(comUm)).toBe(true);
    expect(Object.isFrozen(comUm.trechos)).toBe(true);
  });

  it("poda o que terminou mais de duracaoMs antes do fim do trecho mais recente", () => {
    const janela = JanelaDeTranscricao.vazia(10_000)
      .com(trecho("velho", 0, 1_000))
      .com(trecho("no limite", 1_000, 2_000))
      .com(trecho("novo", 11_000, 12_000));
    // "velho" terminou 11 s antes; "no limite", exatamente 10 s antes.
    expect(janela.trechos.map((t) => t.texto)).toEqual(["no limite", "novo"]);
  });

  it("trecho fora de ordem entra no lugar certo", () => {
    const janela = JanelaDeTranscricao.vazia()
      .com(trecho("a", 0, 1_000))
      .com(trecho("c", 2_000, 3_000))
      .com(trecho("b", 1_000, 2_000));
    expect(janela.trechos.map((t) => t.texto)).toEqual(["a", "b", "c"]);
  });

  it("semAntigos poda tomando agora como referência", () => {
    const janela = JanelaDeTranscricao.vazia(10_000).com(trecho("a", 0, 1_000)).com(trecho("b", 5_000, 6_000));
    expect(janela.semAntigos(11_000)).toBe(janela);
    expect(janela.semAntigos(11_001).trechos.map((t) => t.texto)).toEqual(["b"]);
    expect(janela.semAntigos(30_000).estaVazia).toBe(true);
  });

  it("contexto junta só o que terminou nos últimos 60 s", () => {
    const janela = JanelaDeTranscricao.vazia()
      .com(trecho("fora", 0, 9_999))
      .com(trecho("dentro", 10_000, 10_000))
      .com(trecho("Qual a complexidade?", 65_000, 70_000));
    expect(janela.contexto()).toBe("dentro Qual a complexidade?");
    expect(janela.contexto(5_000)).toBe("Qual a complexidade?");
    expect(janela.contexto(DURACAO_DO_CONTEXTO_MS, 100_000)).toBe("Qual a complexidade?");
    expect(janela.contexto(DURACAO_DO_CONTEXTO_MS, 200_000)).toBe("");
  });

  it("ultimasLinhas devolve os n mais recentes, do mais antigo ao mais novo", () => {
    const janela = JanelaDeTranscricao.vazia()
      .com(trecho("um", 0, 1_000))
      .com(trecho("dois", 1_000, 2_000))
      .com(trecho("três", 2_000, 3_000));
    expect(janela.ultimasLinhas(2)).toEqual(["dois", "três"]);
    expect(janela.ultimasLinhas(10)).toEqual(["um", "dois", "três"]);
    expect(janela.ultimasLinhas(0)).toEqual([]);
    expect(janela.maisRecente?.texto).toBe("três");
  });
});
