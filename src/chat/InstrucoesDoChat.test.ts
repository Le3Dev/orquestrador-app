import path from "node:path";

import { describe, expect, it } from "vitest";

import { linhasDaRegraDasPerguntas, separarPerguntasDoApp } from "../perguntas/PerguntaDoApp";
import { instrucoesDoChat, mensagemParaOChat, separarAcoesDoApp } from "./InstrucoesDoChat";
import { OrquestradorExistente, ProjetoDoChat } from "./ProjetosDoChat";

const raiz = path.resolve("/projetos");
const projetos: ProjetoDoChat[] = [
  { nome: "painel-app", caminho: path.join(raiz, "painel-app") },
  { nome: "Financeiro", caminho: path.join(raiz, "Financeiro") },
];

function ocioso(nome: string, pasta: string): OrquestradorExistente {
  return {
    nome,
    pasta,
    situacao: "ocioso",
    pedidoAtual: null,
    turnoIniciadoEm: null,
    tamanhoDaFila: 0,
    planoPendente: false,
    branch: null,
    alteracoesSemCommit: false,
  };
}

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
        {
          tipo: "abrir_orquestrador",
          projeto: "painel-app",
          pasta: path.join(raiz, "painel-app"),
          pedido: "rodar os testes",
          novo: false,
          orquestrador: null,
        },
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

    expect(acoes).toEqual([
      {
        tipo: "abrir_orquestrador",
        projeto: "painel-app",
        pasta: path.join(raiz, "painel-app"),
        pedido: null,
        novo: false,
        orquestrador: null,
      },
    ]);
  });

  it('"novo":true pede outro orquestrador no projeto', () => {
    const { acoes, avisos } = separarAcoesDoApp(
      bloco('{"tipo":"abrir_orquestrador","projeto":"painel-app","pedido":"revisar o login","novo":true}'),
      projetos,
    );

    expect(acoes).toEqual([
      {
        tipo: "abrir_orquestrador",
        projeto: "painel-app",
        pasta: path.join(raiz, "painel-app"),
        pedido: "revisar o login",
        novo: true,
        orquestrador: null,
      },
    ]);
    expect(avisos).toEqual([]);
  });

  it("sem o campo novo, ou com false, reaproveita o orquestrador existente", () => {
    const resposta = [
      bloco('{"tipo":"abrir_orquestrador","projeto":"painel-app","pedido":null}'),
      bloco('{"tipo":"abrir_orquestrador","projeto":"Financeiro","pedido":null,"novo":false}'),
    ].join("\n");

    const { acoes } = separarAcoesDoApp(resposta, projetos);

    expect(acoes.map((acao) => [acao.projeto, acao.novo])).toEqual([
      ["painel-app", false],
      ["Financeiro", false],
    ]);
  });

  it("novo com tipo errado vira aviso de formato inválido, sem ação", () => {
    const { texto, acoes, avisos } = separarAcoesDoApp(
      `Abrindo.\n${bloco('{"tipo":"abrir_orquestrador","projeto":"painel-app","pedido":null,"novo":"sim"}')}`,
      projetos,
    );

    expect(texto).toBe("Abrindo.");
    expect(acoes).toEqual([]);
    expect(avisos).toEqual(["O Claude sugeriu uma ação do app em formato inválido; ela foi ignorada."]);
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

  describe("orquestrador indicado", () => {
    const orquestradores: OrquestradorExistente[] = [
      ocioso("Painel", path.join(raiz, "painel-app")),
      ocioso("Painel 2", path.join(raiz, "painel-app")),
      ocioso("Contas", path.join(raiz, "Financeiro")),
    ];

    it("um nome que existe na pasta do projeto vale, com o nome real", () => {
      const { acoes, avisos } = separarAcoesDoApp(
        bloco('{"tipo":"abrir_orquestrador","projeto":"painel-app","orquestrador":"painel 2","pedido":"rodar os testes"}'),
        projetos,
        orquestradores,
      );

      expect(acoes.map((acao) => acao.orquestrador)).toEqual(["Painel 2"]);
      expect(avisos).toEqual([]);
    });

    it("nome inexistente, de outra pasta, vazio ou nulo vira null, sem descartar a ação nem avisar", () => {
      const resposta = [
        bloco('{"tipo":"abrir_orquestrador","projeto":"painel-app","orquestrador":"Inventado","pedido":"a"}'),
        bloco('{"tipo":"abrir_orquestrador","projeto":"painel-app","orquestrador":"Contas","pedido":"b"}'),
        bloco('{"tipo":"abrir_orquestrador","projeto":"painel-app","orquestrador":"  ","pedido":"c"}'),
        bloco('{"tipo":"abrir_orquestrador","projeto":"painel-app","orquestrador":null,"pedido":"d"}'),
      ].join("\n");

      const { acoes, avisos } = separarAcoesDoApp(resposta, projetos, orquestradores);

      expect(acoes.map((acao) => [acao.pedido, acao.orquestrador])).toEqual([
        ["a", null],
        ["b", null],
        ["c", null],
        ["d", null],
      ]);
      expect(avisos).toEqual([]);
    });

    it("com novo, o orquestrador indicado é ignorado", () => {
      const { acoes } = separarAcoesDoApp(
        bloco('{"tipo":"abrir_orquestrador","projeto":"painel-app","orquestrador":"Painel","novo":true}'),
        projetos,
        orquestradores,
      );

      expect(acoes).toMatchObject([{ novo: true, orquestrador: null }]);
    });

    it("orquestrador com tipo errado vira aviso de formato inválido", () => {
      const { acoes, avisos } = separarAcoesDoApp(
        bloco('{"tipo":"abrir_orquestrador","projeto":"painel-app","orquestrador":3}'),
        projetos,
        orquestradores,
      );

      expect(acoes).toEqual([]);
      expect(avisos).toEqual(["O Claude sugeriu uma ação do app em formato inválido; ela foi ignorada."]);
    });
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
    orquestradores: [ocioso("Painel", path.join(raiz, "painel-app"))],
    alteracoesAutorizadas: false,
    pastaDeArtefatos: path.resolve("/dados/artefatos/entrada/chat"),
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
    expect(mensagem).toContain(`- Painel → ${path.join(raiz, "painel-app")} (ocioso)`);
    expect(mensagem).toContain(
      "```acao-do-app\n" +
        '{"tipo":"abrir_orquestrador","projeto":"<nome exato da pasta>","orquestrador":"<nome de um orquestrador ocioso do projeto, ou omita>","pedido":"<texto do pedido ou null>","novo":false}\n```',
    );
    expect(mensagem).toContain('Use "novo":true também quando o usuário pedir explicitamente outro (ou um novo) orquestrador');
    expect(mensagem).toContain("o app reaproveita um orquestrador existente do projeto, de preferência um ocioso");
    expect(mensagem).toMatch(/nunca invente um projeto/);
  });

  it("cada orquestrador traz o estado: trabalhando há quanto tempo e em quê, fila, branch e alterações", () => {
    const pasta = path.join(raiz, "painel-app");
    const pedidoLongo = `corrigir memória\n${"x".repeat(120)}`;
    const mensagem = mensagemParaOChat("oi", {
      ...contexto,
      orquestradores: [
        {
          ...ocioso("Ocupado", pasta),
          situacao: "trabalhando",
          pedidoAtual: "corrigir a memória do chat",
          turnoIniciadoEm: new Date("2026-11-04T15:18:00Z"),
          tamanhoDaFila: 2,
          branch: "orquestrador/abc",
          alteracoesSemCommit: null,
        },
        {
          ...ocioso("Longo", pasta),
          situacao: "trabalhando",
          pedidoAtual: pedidoLongo,
          turnoIniciadoEm: new Date("2026-11-04T14:25:00Z"),
        },
        { ...ocioso("Recente", pasta), situacao: "trabalhando", pedidoAtual: "a", turnoIniciadoEm: new Date("2026-11-04T15:29:40Z") },
        { ...ocioso("Plano", pasta), planoPendente: true },
        { ...ocioso("Parado", pasta), branch: "orquestrador/def", alteracoesSemCommit: true },
      ],
    });

    expect(mensagem).toContain(
      `- Ocupado → ${pasta} (trabalhando há 12 min em "corrigir a memória do chat", 2 na fila, branch orquestrador/abc)`,
    );
    expect(mensagem).toContain(`- Longo → ${pasta} (trabalhando há 1 h 05 min em "corrigir memória ${"x".repeat(83)}…")`);
    expect(mensagem).toContain(`- Recente → ${pasta} (trabalhando há menos de 1 min em "a")`);
    expect(mensagem).toContain(`- Plano → ${pasta} (aguardando aprovação do plano)`);
    expect(mensagem).toContain(`- Parado → ${pasta} (ocioso, branch orquestrador/def, alterações sem commit)`);
    expect(mensagem).toContain("Orquestradores existentes (nome → pasta (estado)):");
  });

  it("regra de para onde vai o pedido: ocioso pelo nome, novo se todos ocupados, ocupado só quando depende dele", () => {
    const bloco = blocoDeContexto(false);

    expect(bloco).toContain(
      'um pedido novo e independente vai para um orquestrador ocioso do projeto (indique o nome dele em "orquestrador", exatamente como na lista); se nenhum do projeto estiver ocioso, use "novo":true',
    );
    expect(bloco).toContain("Trabalhando ou aguardando aprovação do plano conta como ocupado.");
    expect(bloco).toContain(
      "Só mande para um orquestrador ocupado quando o pedido depender do trabalho dele (ex.: commitar o que está na worktree dele)",
    );
    expect(bloco).toContain("avise na resposta que o pedido entra na fila dele");
  });

  it("o exemplo do bloco de ação no contexto é um bloco válido", () => {
    const exemplo = blocoDeContexto(false).replace("<nome exato da pasta>", "painel-app");

    expect(separarAcoesDoApp(exemplo, projetos).acoes).toHaveLength(1);
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

  it("artefatos: liberados sem autorização, na pasta exata, com quando, formato, versão e citação", () => {
    for (const autorizado of [false, true]) {
      const bloco = blocoDeContexto(autorizado);

      expect(bloco).toContain("Artefatos (liberados sempre, sem autorização; não contam como alterar projetos):");
      expect(bloco).toContain(`grave UM arquivo autocontido na pasta ${contexto.pastaDeArtefatos}`);
      expect(bloco).toContain(
        "Quando o usuário pedir uma visualização, relatório, diagrama, protótipo, dashboard ou página, ou quando a resposta ficar melhor como página do que como texto",
      );
      expect(bloco).toContain(".html com CSS e JS inline, sem CDN nem recursos externos (a rede é bloqueada) e imagens como data URI; ou .md");
      expect(bloco).toContain("Até 5 MB");
      expect(bloco).toContain("Nome do arquivo curto e descritivo, porque vira o título");
      expect(bloco).toContain("regrave o MESMO arquivo: ele vira uma nova versão");
      expect(bloco).toContain("cite pelo nome o artefato criado ou atualizado");
      expect(bloco).toContain("A única pasta fora dos projetos em que você grava é a de artefatos");
    }
    expect(blocoDeContexto(false)).toContain("Alterações NÃO autorizadas ainda (gravar artefatos não depende disso)");
  });

  it("traz em todo bloco a regra das perguntas com opções, com o exemplo", () => {
    for (const autorizado of [false, true]) {
      const bloco = blocoDeContexto(autorizado);

      expect(bloco).toContain(linhasDaRegraDasPerguntas().join("\n"));
      expect(bloco).toContain("```pergunta-do-app\n");
      expect(bloco).toContain('no formato "pergunta → escolha"');
    }
  });

  it("o exemplo do bloco de perguntas no contexto é um bloco válido", () => {
    expect(separarPerguntasDoApp(blocoDeContexto(false)).perguntas).toHaveLength(1);
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

  it("explica os artefatos: sem autorização, na pasta indicada pelo bloco", () => {
    const instrucoes = instrucoesDoChat();

    expect(instrucoes).toContain("9. Artefatos: quando o usuário pedir uma visualização, relatório, diagrama");
    expect(instrucoes).toContain("na pasta de artefatos que o bloco <contexto-do-app> indica");
    expect(instrucoes).toContain("Gravar artefatos não precisa da autorização e não conta como alterar projetos.");
    expect(instrucoes).toContain("A exceção é a pasta de artefatos (regra 9).");
  });

  it("aponta para a regra das perguntas com opções do bloco de contexto", () => {
    expect(instrucoesDoChat()).toContain(
      "10. Quando precisar que o usuário escolha entre opções claras, siga a regra de perguntas do bloco <contexto-do-app>: inclua o bloco ```pergunta-do-app",
    );
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
