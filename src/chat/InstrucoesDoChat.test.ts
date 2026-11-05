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
    alteracoesAutorizadas: false,
  };

  /** Só o bloco de contexto, sem a pergunta. */
  function blocoDeContexto(alteracoesAutorizadas: boolean): string {
    const mensagem = mensagemParaOChat("pergunta", { ...contexto, alteracoesAutorizadas });
    return mensagem.slice(0, mensagem.indexOf("</contexto-do-app>"));
  }

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

  it("as permissões declaram substituir as regras anteriores e limitam tudo às pastas dos projetos", () => {
    for (const autorizado of [false, true]) {
      const bloco = blocoDeContexto(autorizado);

      expect(bloco).toContain("substituem qualquer regra anterior");
      expect(bloco).toContain(`só dentro das pastas dos projetos da pasta raiz (${raiz})`);
      expect(bloco).toMatch(/\.env\* são bloqueados/);
    }
  });

  it("sem autorização: manda tentar a ferramenta, e se negada, avisar em uma linha e parar sem contornar", () => {
    const bloco = blocoDeContexto(false);

    expect(bloco).toContain("Alterações NÃO autorizadas ainda");
    expect(bloco).toContain("use a ferramenta mesmo assim: o app pede a autorização ao usuário");
    expect(bloco).toContain("diga em uma linha que precisa da autorização e pare");
    expect(bloco).toContain("Não contorne a negação");
    expect(bloco).not.toContain("AUTORIZADAS pelo usuário");
  });

  it("com autorização: edita e roda comandos sem pedir confirmação, até o próximo /clear", () => {
    const bloco = blocoDeContexto(true);

    expect(bloco).toContain("Alterações AUTORIZADAS pelo usuário até o próximo /clear");
    expect(bloco).toContain("sem pedir confirmação");
    expect(bloco).not.toContain("NÃO autorizadas");
  });

  it("commit e push só a pedido, em branch própria, sem main, sem push forçado e sem Co-authored-by", () => {
    for (const autorizado of [false, true]) {
      const bloco = blocoDeContexto(autorizado);

      expect(bloco).toContain("Commit e push: só quando o usuário pedir explicitamente nesta mensagem");
      expect(bloco).toContain("feature/, fix/, hotfix/ ou refactor/, nunca na main");
      expect(bloco).toContain("nunca push forçado");
      expect(bloco).toContain("nunca a linha Co-authored-by");
    }
  });

  it("pede a lista do que foi alterado e sugere orquestrador para mudanças grandes", () => {
    const bloco = blocoDeContexto(true);

    expect(bloco).toContain("listando os arquivos alterados e os comandos rodados");
    expect(bloco).toMatch(/Mudanças grandes .*sugira abrir um orquestrador/);
  });
});

describe("instrucoesDoChat", () => {
  it("diz que o chat pesquisa, lê, edita e roda comandos nas pastas dos projetos, em português", () => {
    const instrucoes = instrucoesDoChat();

    expect(instrucoes).toContain("Orquestrador de agentes");
    expect(instrucoes).toMatch(/português/);
    expect(instrucoes).toMatch(/WebSearch/);
    expect(instrucoes).toMatch(/editar arquivos \(Edit, Write, NotebookEdit\) e rodar comandos \(PowerShell, Bash\)/);
    expect(instrucoes).toContain("só dentro das pastas dos projetos da pasta raiz");
    expect(instrucoes).not.toMatch(/Nunca altera nada/);
    expect(instrucoes).toContain("acao-do-app");
  });

  it("explica a autorização única e o que fazer quando ela é negada", () => {
    const instrucoes = instrucoesDoChat();

    expect(instrucoes).toContain("autorização única do usuário, que vale até o próximo /clear");
    expect(instrucoes).toContain("use a ferramenta mesmo assim: o app pede a autorização ao usuário");
    expect(instrucoes).toContain("Não contorne a negação");
  });

  it("traz as regras de commit e push, do relatório e das mudanças grandes", () => {
    const instrucoes = instrucoesDoChat();

    expect(instrucoes).toContain("Commit e push: só quando o usuário pedir explicitamente");
    expect(instrucoes).toContain("nunca na main");
    expect(instrucoes).toContain("nunca a linha Co-authored-by");
    expect(instrucoes).toContain("listando os arquivos alterados e os comandos rodados");
    expect(instrucoes).toMatch(/sugira abrir um orquestrador/);
  });
});
