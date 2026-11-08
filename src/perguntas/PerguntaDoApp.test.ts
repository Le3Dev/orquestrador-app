import { describe, expect, it } from "vitest";

import { linhasDaRegraDasPerguntas, MARCA_DA_PERGUNTA, separarPerguntasDoApp } from "./PerguntaDoApp";

function bloco(json: string): string {
  return ["```pergunta-do-app", json, "```"].join("\n");
}

function pergunta(enunciado: string, opcoes: unknown[] = ["A", "B"], multipla?: boolean): Record<string, unknown> {
  return multipla === undefined ? { pergunta: enunciado, opcoes } : { pergunta: enunciado, opcoes, multipla };
}

function json(...perguntas: Record<string, unknown>[]): string {
  return JSON.stringify({ perguntas });
}

const AVISO_DE_FORMATO = "O Claude fez uma pergunta com opções em formato inválido; ela foi ignorada.";

describe("separarPerguntasDoApp", () => {
  it("a marca é a do contrato com a tela", () => {
    expect(MARCA_DA_PERGUNTA).toBe("pergunta-do-app");
  });

  it("devolve o texto como está quando não há blocos", () => {
    expect(separarPerguntasDoApp("Só uma resposta.\n")).toEqual({ texto: "Só uma resposta.\n", perguntas: [], avisos: [] });
  });

  it("extrai o bloco do exemplo, normaliza as opções e tira o bloco do texto", () => {
    const resposta = [
      "Antes de seguir, preciso de uma decisão.",
      "",
      bloco(
        '{"perguntas":[{"pergunta":"Qual banco usar?","opcoes":[{"rotulo":"Postgres","descricao":"já usado no projeto"},"SQLite"],"multipla":false}]}',
      ),
    ].join("\n");

    expect(separarPerguntasDoApp(resposta)).toEqual({
      texto: "Antes de seguir, preciso de uma decisão.",
      perguntas: [
        {
          pergunta: "Qual banco usar?",
          opcoes: [
            { rotulo: "Postgres", descricao: "já usado no projeto" },
            { rotulo: "SQLite", descricao: null },
          ],
          multipla: false,
        },
      ],
      avisos: [],
    });
  });

  it("apara os textos, multipla ausente vale false e descrição vazia ou nula vira null", () => {
    const { perguntas, avisos } = separarPerguntasDoApp(
      bloco(
        json(
          pergunta("  Quais testes?  ", [{ rotulo: " Unitários ", descricao: "  " }, { rotulo: "E2E", descricao: null }, "  Carga "]),
          pergunta("Quais pastas?", ["src", "web"], true),
        ),
      ),
    );

    expect(avisos).toEqual([]);
    expect(perguntas).toEqual([
      {
        pergunta: "Quais testes?",
        opcoes: [
          { rotulo: "Unitários", descricao: null },
          { rotulo: "E2E", descricao: null },
          { rotulo: "Carga", descricao: null },
        ],
        multipla: false,
      },
      { pergunta: "Quais pastas?", opcoes: [{ rotulo: "src", descricao: null }, { rotulo: "web", descricao: null }], multipla: true },
    ]);
  });

  it("junta as perguntas de vários blocos, mantendo o texto entre eles", () => {
    const resposta = ["Primeiro:", bloco(json(pergunta("P1"))), "Depois:", bloco(json(pergunta("P2"), pergunta("P3")))].join("\n");

    const { texto, perguntas, avisos } = separarPerguntasDoApp(resposta);

    expect(texto).toBe("Primeiro:\n\nDepois:");
    expect(perguntas.map((item) => item.pergunta)).toEqual(["P1", "P2", "P3"]);
    expect(avisos).toEqual([]);
  });

  it("no total, fica com as 4 primeiras perguntas e avisa do resto", () => {
    const resposta = [bloco(json(pergunta("P1"), pergunta("P2"), pergunta("P3"))), bloco(json(pergunta("P4"), pergunta("P5"))), bloco(json(pergunta("P6")))].join(
      "\n",
    );

    const { texto, perguntas, avisos } = separarPerguntasDoApp(resposta);

    expect(texto).toBe("");
    expect(perguntas.map((item) => item.pergunta)).toEqual(["P1", "P2", "P3", "P4"]);
    expect(avisos).toEqual(["O Claude fez mais de 4 perguntas de uma vez; só as 4 primeiras aparecem."]);
  });

  it.each<[string, string]>([
    ["JSON inválido", "{perguntas: []}"],
    ["sem perguntas", json()],
    ["mais de 4 perguntas num bloco", json(pergunta("1"), pergunta("2"), pergunta("3"), pergunta("4"), pergunta("5"))],
    ["uma opção só", json(pergunta("Qual?", ["A"]))],
    ["mais de 6 opções", json(pergunta("Qual?", ["1", "2", "3", "4", "5", "6", "7"]))],
    ["enunciado vazio", json(pergunta("   "))],
    ["opção vazia", json(pergunta("Qual?", ["A", "  "]))],
    ["opção sem rótulo", json(pergunta("Qual?", ["A", { descricao: "sem rótulo" }]))],
    ["opções repetidas", json(pergunta("Qual?", ["Postgres", "postgres"]))],
    ["multipla com tipo errado", JSON.stringify({ perguntas: [{ pergunta: "Qual?", opcoes: ["A", "B"], multipla: "sim" }] })],
    ["enunciado longo demais", json(pergunta("x".repeat(501)))],
    ["rótulo longo demais", json(pergunta("Qual?", ["A", "x".repeat(151)]))],
    ["sem o envelope perguntas", JSON.stringify(pergunta("Qual?"))],
  ])("%s: o bloco sai do texto e vira aviso, sem perguntas", (_caso, conteudo) => {
    const { texto, perguntas, avisos } = separarPerguntasDoApp(`Antes.\n${bloco(conteudo)}\nDepois.`);

    expect(texto).toBe("Antes.\n\nDepois.");
    expect(perguntas).toEqual([]);
    expect(avisos).toEqual([AVISO_DE_FORMATO]);
  });

  it("um bloco inválido não derruba os válidos", () => {
    const resposta = [bloco("{"), bloco(json(pergunta("Vale?")))].join("\n");

    const { perguntas, avisos } = separarPerguntasDoApp(resposta);

    expect(perguntas.map((item) => item.pergunta)).toEqual(["Vale?"]);
    expect(avisos).toEqual([AVISO_DE_FORMATO]);
  });

  it("bloco sem fechamento até o fim do texto também sai", () => {
    const { texto, perguntas, avisos } = separarPerguntasDoApp(`Escolha:\n\`\`\`pergunta-do-app\n${json(pergunta("Qual?")).slice(0, 20)}`);

    expect(texto).toBe("Escolha:");
    expect(perguntas).toEqual([]);
    expect(avisos).toEqual([AVISO_DE_FORMATO]);
  });

  it("bloco válido sem fechamento no fim do texto ainda vale", () => {
    const { texto, perguntas } = separarPerguntasDoApp(`Escolha:\n\`\`\`pergunta-do-app\n${json(pergunta("Qual?"))}`);

    expect(texto).toBe("Escolha:");
    expect(perguntas).toHaveLength(1);
  });

  it("uma menção ao bloco no meio da frase não vira bloco", () => {
    const resposta = "O app entende o bloco ```pergunta-do-app quando ele começa a linha.";

    expect(separarPerguntasDoApp(resposta)).toEqual({ texto: resposta, perguntas: [], avisos: [] });
  });

  it("aceita o bloco com espaços antes da abertura", () => {
    const { texto, perguntas } = separarPerguntasDoApp(`Escolha:\n  \`\`\`pergunta-do-app\n  ${json(pergunta("Qual?"))}\n  \`\`\``);

    expect(texto).toBe("Escolha:");
    expect(perguntas).toHaveLength(1);
  });

  it("não mexe em outros blocos de código", () => {
    const resposta = "Veja:\n```json\n{\"a\":1}\n```\n```acao-do-app\n{}\n```";

    expect(separarPerguntasDoApp(resposta)).toEqual({ texto: resposta, perguntas: [], avisos: [] });
  });

  it("as perguntas devolvidas são imutáveis", () => {
    const { perguntas } = separarPerguntasDoApp(bloco(json(pergunta("Qual?"))));

    expect(Object.isFrozen(perguntas[0])).toBe(true);
    expect(Object.isFrozen(perguntas[0]?.opcoes)).toBe(true);
    expect(Object.isFrozen(perguntas[0]?.opcoes[0])).toBe(true);
  });
});

describe("linhasDaRegraDasPerguntas", () => {
  const regra = linhasDaRegraDasPerguntas().join("\n");

  it("diz quando usar e quando não usar o bloco", () => {
    expect(regra).toContain("quando precisar que o usuário decida entre opções claras");
    expect(regra).toContain("Não use o bloco para perguntas abertas");
  });

  it("traz o formato, os limites e o exemplo do contrato", () => {
    expect(regra).toContain('"perguntas" (de 1 a 4)');
    expect(regra).toContain('"opcoes" (de 2 a 6');
    expect(regra).toContain(
      "```pergunta-do-app\n" +
        '{"perguntas":[{"pergunta":"Qual banco usar?","opcoes":[{"rotulo":"Postgres","descricao":"já usado no projeto"},"SQLite"],"multipla":false}]}\n' +
        "```",
    );
  });

  it("o exemplo da regra é um bloco válido", () => {
    expect(separarPerguntasDoApp(regra).perguntas).toHaveLength(1);
  });

  it("não repetir a pergunta, sem \"Outro\" nas opções e como chega a resposta", () => {
    expect(regra).toContain("Não repita a pergunta nem as opções no texto fora do bloco.");
    expect(regra).toContain('não inclua "Outro" nas opções');
    expect(regra).toContain('a escolha do usuário chega como a próxima mensagem, uma linha por pergunta, no formato "pergunta → escolha"');
  });
});
