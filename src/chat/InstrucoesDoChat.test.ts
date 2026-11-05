import path from "node:path";

import { describe, expect, it } from "vitest";

import { instrucoesDoChat, mensagemParaOChat, separarAcoesDoApp } from "./InstrucoesDoChat";
import { ProjetoDoChat } from "./ProjetosDoChat";

const raiz = path.resolve("/projetos");
const projetos: ProjetoDoChat[] = [
  { nome: "painel-app", caminho: path.join(raiz, "painel-app") },
  { nome: "Financeiro", caminho: path.join(raiz, "Financeiro") },
];

function bloco(json: string): string {
  return ["```acao-do-app", json, "```"].join("\n");
}

describe("separarAcoesDoApp", () => {
  it("devolve o texto como está quando não há blocos", () => {
    expect(separarAcoesDoApp("Só uma resposta.\n", projetos)).toEqual({
      texto: "Só uma resposta.\n",
      acoes: [],
      avisos: [],
    });
  });

  it("extrai um bloco válido, resolve a pasta e tira o bloco do texto", () => {
    const resposta = `Vou abrir o painel.\n\n${bloco('{"tipo":"abrir_orquestrador","projeto":"painel-app","pedido":"rodar os testes"}')}\n\nClique no cartão.`;

    expect(separarAcoesDoApp(resposta, projetos)).toEqual({
      texto: "Vou abrir o painel.\n\nClique no cartão.",
      acoes: [
        { tipo: "abrir_orquestrador", projeto: "painel-app", pasta: path.join(raiz, "painel-app"), pedido: "rodar os testes" },
      ],
      avisos: [],
    });
  });

  it("extrai vários blocos, com pedido nulo ou ausente", () => {
    const resposta = [
      "Dois orquestradores:",
      bloco('{"tipo":"abrir_orquestrador","projeto":"painel-app","pedido":null}'),
      bloco('{"tipo":"abrir_orquestrador","projeto":"Financeiro"}'),
    ].join("\n");

    const { texto, acoes, avisos } = separarAcoesDoApp(resposta, projetos);

    expect(texto).toBe("Dois orquestradores:");
    expect(acoes.map((acao) => [acao.projeto, acao.pedido])).toEqual([
      ["painel-app", null],
      ["Financeiro", null],
    ]);
    expect(avisos).toEqual([]);
  });

  it("compara o projeto sem diferenciar maiúsculas e devolve o nome real da pasta", () => {
    const { acoes } = separarAcoesDoApp(bloco('{"tipo":"abrir_orquestrador","projeto":"PAINEL-APP","pedido":""}'), projetos);

    expect(acoes).toEqual([{ tipo: "abrir_orquestrador", projeto: "painel-app", pasta: path.join(raiz, "painel-app"), pedido: null }]);
  });

  it("projeto inexistente vira aviso, sem ação", () => {
    const { texto, acoes, avisos } = separarAcoesDoApp(
      `Abrindo.\n${bloco('{"tipo":"abrir_orquestrador","projeto":"inventado","pedido":null}')}`,
      projetos,
    );

    expect(texto).toBe("Abrindo.");
    expect(acoes).toEqual([]);
    expect(avisos).toEqual(['O projeto "inventado" não existe na pasta raiz; a ação foi ignorada.']);
  });

  it("JSON inválido, tipo desconhecido e bloco sem fechamento saem do texto e viram aviso", () => {
    const resposta = [
      "Antes.",
      bloco("{tipo: abrir}"),
      "Meio.",
      bloco('{"tipo":"apagar_tudo","projeto":"painel-app"}'),
      "```acao-do-app",
      '{"tipo":"abrir_orquestrador","projeto":"painel-app"',
    ].join("\n");

    const { texto, acoes, avisos } = separarAcoesDoApp(resposta, projetos);

    expect(texto).toBe("Antes.\n\nMeio.");
    expect(acoes).toEqual([]);
    expect(avisos).toHaveLength(3);
    expect(avisos[0]).toMatch(/formato inválido/);
  });

  it("as ações devolvidas são imutáveis", () => {
    const { acoes } = separarAcoesDoApp(bloco('{"tipo":"abrir_orquestrador","projeto":"painel-app"}'), projetos);
    expect(Object.isFrozen(acoes[0])).toBe(true);
  });
});

describe("mensagemParaOChat", () => {
  const contexto = {
    agora: new Date("2026-11-04T15:30:00Z"),
    pastaDosProjetos: raiz,
    projetos,
    orquestradores: [{ nome: "Painel", pasta: path.join(raiz, "painel-app") }],
  };

  it("antecede o texto com o bloco <contexto-do-app> completo", () => {
    const mensagem = mensagemParaOChat("Abra o painel", contexto);

    expect(mensagem.startsWith("<contexto-do-app>\n")).toBe(true);
    expect(mensagem.endsWith("</contexto-do-app>\n\nAbra o painel")).toBe(true);
    expect(mensagem).toContain("2026-11-04T15:30:00.000Z");
    expect(mensagem).toContain(`Pasta raiz dos projetos: ${raiz}`);
    expect(mensagem).toContain("- painel-app\n- Financeiro");
    expect(mensagem).toContain(`- Painel → ${path.join(raiz, "painel-app")}`);
    expect(mensagem).toContain("```acao-do-app\n" + '{"tipo":"abrir_orquestrador","projeto":"<nome exato da pasta>","pedido":"<texto do pedido ou null>"}\n```');
    expect(mensagem).toMatch(/nunca invente um projeto/);
  });

  it("indica listas vazias e pergunta só com imagem", () => {
    const mensagem = mensagemParaOChat("  ", { ...contexto, projetos: [], orquestradores: [] });

    expect(mensagem).toContain("(nenhum projeto na pasta raiz)");
    expect(mensagem).toContain("- (nenhum)");
    expect(mensagem.endsWith("Veja a imagem anexada.")).toBe(true);
  });
});

describe("instrucoesDoChat", () => {
  it("diz que o chat só lê, pesquisa na web e responde em português", () => {
    const instrucoes = instrucoesDoChat();

    expect(instrucoes).toContain("Orquestrador de agentes");
    expect(instrucoes).toMatch(/português/);
    expect(instrucoes).toMatch(/WebSearch/);
    expect(instrucoes).toMatch(/Nunca altera nada/);
    expect(instrucoes).toContain("acao-do-app");
  });
});
