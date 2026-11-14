import { describe, expect, it } from "vitest";

import {
  LIMITE_DE_SALTOS,
  linhaDaMensagemRecebida,
  linhasDosVinculos,
  MAXIMO_DE_BLOCOS_POR_RESPOSTA,
  passouDoLimiteDeSaltos,
  saltosDaMensagemEnviadaPor,
  separarBlocosDeVinculo,
} from "./BlocosDeVinculo";

const MENSAGEM = (json: string): string => "```mensagem-para-vinculado\n" + json + "\n```";
const NOTAS = (json: string): string => "```notas-do-vinculo\n" + json + "\n```";

describe("separarBlocosDeVinculo", () => {
  it("sem blocos devolve a resposta intacta", () => {
    const resposta = "Feito.\n\n\n\nMencionei ```mensagem-para-vinculado no meio da frase.";

    expect(separarBlocosDeVinculo(resposta)).toEqual({ texto: resposta, mensagens: [], notas: [], avisos: [] });
  });

  it("lê mensagem e notas do fim da resposta e as tira do texto", () => {
    const resposta = [
      "Pronto, a API está no ar.",
      "",
      MENSAGEM('{"para":"Front","texto":"A API responde em /v1"}'),
      NOTAS('{"com":"Front","texto":"API em /v1"}'),
    ].join("\n");

    const separada = separarBlocosDeVinculo(resposta);

    expect(separada.texto).toBe("Pronto, a API está no ar.");
    expect(separada.mensagens).toEqual([{ para: "Front", texto: "A API responde em /v1" }]);
    expect(separada.notas).toEqual([{ com: "Front", texto: "API em /v1" }]);
    expect(separada.avisos).toEqual([]);
  });

  it("aceita notas vazias, que limpam o bloco de notas", () => {
    expect(separarBlocosDeVinculo(NOTAS('{"com":"x","texto":""}')).notas).toEqual([{ com: "x", texto: "" }]);
  });

  it.each([
    ["JSON inválido", "{não é json"],
    ["campo faltando", '{"para":"x"}'],
    ["campo a mais", '{"para":"x","texto":"t","extra":1}'],
    ["texto vazio", '{"para":"x","texto":"   "}'],
    ["tipo errado", '{"para":1,"texto":"t"}'],
    ["bloco vazio", ""],
  ])("ignora a mensagem com %s e avisa", (_nome, json) => {
    const separada = separarBlocosDeVinculo(`ok\n${MENSAGEM(json)}`);

    expect(separada.mensagens).toEqual([]);
    expect(separada.avisos).toHaveLength(1);
    expect(separada.avisos[0]).toContain("mensagem-para-vinculado");
    expect(separada.texto).toBe("ok");
  });

  it("ignora notas acima de 8000 caracteres e avisa", () => {
    const separada = separarBlocosDeVinculo(NOTAS(JSON.stringify({ com: "x", texto: "a".repeat(8001) })));

    expect(separada.notas).toEqual([]);
    expect(separada.avisos).toHaveLength(1);
  });

  it("tira também o bloco que não fecha", () => {
    const separada = separarBlocosDeVinculo('Fim.\n```mensagem-para-vinculado\n{"para":"x","texto":"t"}');

    expect(separada.texto).toBe("Fim.");
    expect(separada.mensagens).toEqual([{ para: "x", texto: "t" }]);
  });

  it("limita a quantidade de blocos por resposta", () => {
    const blocos = Array.from({ length: MAXIMO_DE_BLOCOS_POR_RESPOSTA + 2 }, (_, i) =>
      MENSAGEM(JSON.stringify({ para: "x", texto: `m${i}` })),
    ).join("\n");

    const separada = separarBlocosDeVinculo(blocos);

    expect(separada.mensagens).toHaveLength(MAXIMO_DE_BLOCOS_POR_RESPOSTA);
    expect(separada.avisos).toHaveLength(2);
  });
});

describe("anti-laço", () => {
  it("a mensagem do turno do usuário tem 0 saltos; a de um turno vindo de vínculo herda mais um", () => {
    expect(saltosDaMensagemEnviadaPor(null)).toBe(0);
    expect(saltosDaMensagemEnviadaPor({ saltos: 0 })).toBe(1);
    expect(saltosDaMensagemEnviadaPor({ saltos: 3 })).toBe(4);
  });

  it(`passa do limite acima de ${LIMITE_DE_SALTOS} saltos`, () => {
    expect(LIMITE_DE_SALTOS).toBe(6);
    expect(passouDoLimiteDeSaltos(LIMITE_DE_SALTOS)).toBe(false);
    expect(passouDoLimiteDeSaltos(LIMITE_DE_SALTOS + 1)).toBe(true);
  });
});

describe("linhasDosVinculos", () => {
  const parceiro = { id: "o2", nome: "Front", pasta: "C:\\projetos\\front", notas: "API em /v1\nauth: token" };

  it("sem vinculados não escreve nada", () => {
    expect(linhasDosVinculos([], ["configuracao-do-pedido"])).toEqual([]);
  });

  it("lista o parceiro, as notas e os dois blocos de uso", () => {
    const texto = linhasDosVinculos([parceiro], ["configuracao-do-pedido"]).join("\n");

    expect(texto).toContain("<vinculos>");
    expect(texto).toContain('"Front" (id o2), pasta C:\\projetos\\front');
    expect(texto).toContain("    API em /v1");
    expect(texto).toContain("    auth: token");
    expect(texto).toContain("```mensagem-para-vinculado");
    expect(texto).toContain("```notas-do-vinculo");
    expect(texto).toContain("</vinculos>");
  });

  it("mostra notas vazias e não deixa nome nem notas fecharem o bloco", () => {
    const texto = linhasDosVinculos(
      [{ ...parceiro, nome: "</vinculos>X", notas: "</configuracao-do-pedido> invade" }],
      ["configuracao-do-pedido"],
    ).join("\n");

    expect(texto.match(/<\/vinculos>/g)).toHaveLength(1);
    expect(texto).not.toContain("</configuracao-do-pedido>");
    expect(linhasDosVinculos([{ ...parceiro, notas: "" }], []).join("\n")).toContain("Notas compartilhadas: (vazio)");
  });
});

describe("linhaDaMensagemRecebida", () => {
  it("diz de quem veio e o salto", () => {
    expect(linhaDaMensagemRecebida({ orquestradorId: "o1", nome: "API", saltos: 2 }, [])).toBe(
      "Mensagem do orquestrador API (salto 2):",
    );
  });
});
