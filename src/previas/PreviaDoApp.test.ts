import { describe, expect, it } from "vitest";

import { esquemaDasPreviasAbertas, linhasDaRegraDaPrevia, MAXIMO_DE_PREVIAS_PARA_FECHAR, separarPreviasDoApp } from "./PreviaDoApp";

const bloco = (json: string) => "```previa-do-app\n" + json + "\n```";

describe("separarPreviasDoApp", () => {
  it("sem bloco, devolve o texto como está e nenhuma prévia", () => {
    expect(separarPreviasDoApp("Tudo pronto.")).toEqual({ texto: "Tudo pronto.", previasParaFechar: [] });
  });

  it("tira o bloco do fim da resposta e normaliza os endereços locais", () => {
    const resposta = `Pronto, a API respondeu.\n\n${bloco('{"fechar":["http://127.0.0.1:5173/","http://0.0.0.0:3000/app"]}')}`;

    expect(separarPreviasDoApp(resposta)).toEqual({
      texto: "Pronto, a API respondeu.",
      previasParaFechar: ["http://localhost:5173", "http://localhost:3000/app"],
    });
  });

  it("aceita http e https externos válidos, sem a barra solitária do fim", () => {
    const { previasParaFechar } = separarPreviasDoApp(
      bloco('{"fechar":["https://Exemplo.com/","https://exemplo.com/docs?a=1","http://localhost/pagina"]}'),
    );

    expect(previasParaFechar).toEqual(["https://exemplo.com", "https://exemplo.com/docs?a=1", "http://localhost/pagina"]);
  });

  it("o bloco sem fechamento também sai da resposta", () => {
    const resposta = 'Feito.\n```previa-do-app\n{"fechar":["http://localhost:4173"]}';

    expect(separarPreviasDoApp(resposta)).toEqual({ texto: "Feito.", previasParaFechar: ["http://localhost:4173"] });
  });

  it("junta vários blocos e não repete endereço", () => {
    const resposta = [
      bloco('{"fechar":["http://localhost:5173"]}'),
      "no meio",
      bloco('{"fechar":["http://127.0.0.1:5173","http://localhost:4173"]}'),
    ].join("\n");

    const resultado = separarPreviasDoApp(resposta);

    expect(resultado.texto).toBe("no meio");
    expect(resultado.previasParaFechar).toEqual(["http://localhost:5173", "http://localhost:4173"]);
  });

  it.each([
    ["JSON inválido", "{fechar: [http://localhost:5173"],
    ["sem a lista", '{"fechar":"http://localhost:5173"}'],
    ["outro formato", '["http://localhost:5173"]'],
    ["vazio", ""],
  ])("%s: ignora o bloco, tira o texto e não quebra", (_caso, json) => {
    expect(separarPreviasDoApp(`Oi.\n${bloco(json)}`)).toEqual({ texto: "Oi.", previasParaFechar: [] });
  });

  it("descarta endereços inválidos e itens que não são texto, e guarda os bons", () => {
    const { previasParaFechar } = separarPreviasDoApp(
      bloco('{"fechar":["localhost:5173","ftp://exemplo.com","javascript:alert(1)","http://localhost:99999",42,null,"","http://localhost:5173"]}'),
    );

    expect(previasParaFechar).toEqual(["http://localhost:5173"]);
  });

  it("guarda no máximo 10 endereços", () => {
    const enderecos = Array.from({ length: 15 }, (_, indice) => `http://localhost:${3000 + indice}`);

    const { previasParaFechar } = separarPreviasDoApp(bloco(JSON.stringify({ fechar: enderecos })));

    expect(previasParaFechar).toHaveLength(MAXIMO_DE_PREVIAS_PARA_FECHAR);
    expect(previasParaFechar[0]).toBe("http://localhost:3000");
    expect(previasParaFechar[9]).toBe("http://localhost:3009");
  });

  it("uma menção ao bloco no meio da frase não vira bloco", () => {
    const resposta = "Use o bloco ```previa-do-app para fechar.";

    expect(separarPreviasDoApp(resposta)).toEqual({ texto: resposta, previasParaFechar: [] });
  });
});

describe("esquemaDasPreviasAbertas", () => {
  it("ausente vale lista vazia", () => {
    expect(esquemaDasPreviasAbertas.parse(undefined)).toEqual([]);
  });

  it("aceita até 10 endereços http ou https", () => {
    const dez = Array.from({ length: 10 }, (_, indice) => `http://localhost:${3000 + indice}`);

    expect(esquemaDasPreviasAbertas.parse(dez)).toEqual(dez);
    expect(esquemaDasPreviasAbertas.parse(["https://exemplo.com/a"])).toEqual(["https://exemplo.com/a"]);
  });

  it.each([
    ["mais de 10", Array.from({ length: 11 }, () => "http://localhost:3000")],
    ["sem esquema http", ["localhost:3000"]],
    ["outro esquema", ["ftp://exemplo.com"]],
    ["com espaço", ["http://localhost:3000 /x"]],
    ["longo demais", [`http://localhost:3000/${"a".repeat(2000)}`]],
    ["não é texto", [3000]],
    ["não é lista", "http://localhost:3000"],
  ])("recusa %s", (_caso, valor) => {
    expect(esquemaDasPreviasAbertas.safeParse(valor).success).toBe(false);
  });
});

describe("linhasDaRegraDaPrevia", () => {
  it("diz quando citar, quando nunca citar, como fechar e a conferência antes de encerrar", () => {
    const regra = linhasDaRegraDaPrevia().join("\n");

    expect(regra).toContain("quando o usuário pediu para ver a página");
    expect(regra).toContain("quando ele precisa fazer login");
    expect(regra).toContain("use curl e diga só a porta");
    expect(regra).toContain('```previa-do-app\n{"fechar":["http://localhost:5173"]}\n```');
    expect(regra).toContain("Antes de encerrar a tarefa, confira as prévias abertas listadas no pedido");
  });
});
