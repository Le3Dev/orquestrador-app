import { describe, expect, it } from "vitest";

import { DetectorDeEnderecosLocais } from "../motores/DetectorDeEnderecosLocais";
import { acaoDaChamada, AdaptadorDeEventosAcp, ehFerramentaComONome, lerChamadaDeFerramenta } from "./AdaptadorDeEventosAcp";

const naoEhDoApp = (): boolean => false;

describe("lerChamadaDeFerramenta", () => {
  it("junta os caminhos de locations, do diff e dos campos de caminho da entrada, sem repetir", () => {
    const chamada = lerChamadaDeFerramenta({
      toolCallId: "t1",
      title: "Create file",
      kind: "edit",
      rawInput: { path: "/p/a.ts", fileName: "/p/a.ts", destination: "/p/b.ts" },
      locations: [{ path: "/p/a.ts" }],
      content: [{ type: "diff", path: "/p/c.ts", oldText: "", newText: "x" }, { type: "content" }],
    });

    expect(chamada).toMatchObject({ id: "t1", titulo: "Create file", tipo: "edit" });
    expect(chamada.caminhos.sort()).toEqual(["/p/a.ts", "/p/b.ts", "/p/c.ts"]);
  });

  it("trata um tipo desconhecido ou ausente como 'other'", () => {
    expect(lerChamadaDeFerramenta({ kind: "inventado" }).tipo).toBe("other");
    expect(lerChamadaDeFerramenta({}).tipo).toBe("other");
    expect(lerChamadaDeFerramenta(null).tipo).toBe("other");
  });
});

describe("acaoDaChamada", () => {
  const acao = (bruta: Record<string, unknown>, doApp = naoEhDoApp) => acaoDaChamada(lerChamadaDeFerramenta(bruta), doApp);

  it("traduz cada tipo de ferramenta do ACP para a ação do domínio", () => {
    expect(acao({ kind: "read" })).toEqual({ tipo: "leitura" });
    expect(acao({ kind: "search" })).toEqual({ tipo: "leitura" });
    expect(acao({ kind: "think" })).toEqual({ tipo: "leitura" });
    expect(acao({ kind: "fetch" })).toEqual({ tipo: "web" });
    expect(acao({ kind: "edit", locations: [{ path: "/a" }] })).toEqual({ tipo: "escrita", caminhos: ["/a"] });
    expect(acao({ kind: "delete", rawInput: { path: "/b" } })).toEqual({ tipo: "escrita", caminhos: ["/b"] });
    expect(acao({ kind: "move", rawInput: { oldPath: "/c", newPath: "/d" } })).toEqual({ tipo: "escrita", caminhos: expect.arrayContaining(["/c", "/d"]) });
    expect(acao({ kind: "switch_mode" })).toEqual({ tipo: "mudar_de_modo" });
    expect(acao({ kind: "other", title: "mcp__x" })).toEqual({ tipo: "outra", descricao: "mcp__x" });
  });

  it("lê o comando de `command`, de `commands` (juntando) ou, sem nenhum, do título", () => {
    expect(acao({ kind: "execute", rawInput: { command: "npm test" } })).toEqual({ tipo: "comando", comando: "npm test" });
    expect(acao({ kind: "execute", rawInput: { commands: ["cd x", "git commit -m y"] } })).toEqual({
      tipo: "comando",
      comando: "cd x\ngit commit -m y",
    });
    expect(acao({ kind: "execute", title: "git push" })).toEqual({ tipo: "comando", comando: "git push" });
  });

  it("reconhece a ferramenta do app antes do tipo", () => {
    expect(acao({ kind: "other", title: "delegar_subtarefas" }, () => true)).toEqual({ tipo: "ferramenta_do_app" });
  });
});

describe("ehFerramentaComONome", () => {
  const chamada = (titulo: string) => lerChamadaDeFerramenta({ kind: "other", title: titulo });

  it("aceita o nome puro e com o prefixo do servidor, mas não um nome parecido", () => {
    for (const titulo of ["delegar_subtarefas", "orquestrador-delegar_subtarefas", "mcp__orquestrador__delegar_subtarefas", "orquestrador.delegar_subtarefas"]) {
      expect(ehFerramentaComONome(chamada(titulo), ["delegar_subtarefas"]), titulo).toBe(true);
    }
    expect(ehFerramentaComONome(chamada("meu_delegar_subtarefas_x"), ["delegar_subtarefas"])).toBe(false);
    expect(ehFerramentaComONome(chamada("delegar"), ["delegar_subtarefas"])).toBe(false);
  });
});

describe("AdaptadorDeEventosAcp", () => {
  function criar(agora: () => number = () => 0): { adaptador: AdaptadorDeEventosAcp; detector: DetectorDeEnderecosLocais } {
    const detector = new DetectorDeEnderecosLocais();
    return { detector, adaptador: new AdaptadorDeEventosAcp({ detector, nomeDoTerminal: "Bash", agora }) };
  }
  const fala = (texto: string) => ({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: texto } });

  it("junta os pedaços da fala e só emite o texto quando o agente chama uma ferramenta ou o turno acaba", () => {
    const { adaptador } = criar();

    expect(adaptador.traduzir(fala("Vou "))).toEqual([]);
    expect(adaptador.traduzir(fala("ler."))).toEqual([]);
    const aoChamar = adaptador.traduzir({ sessionUpdate: "tool_call", toolCallId: "t", title: "Read file", kind: "read", rawInput: { path: "/a.ts" } });
    expect(aoChamar).toEqual([
      { tipo: "texto_do_orquestrador", texto: "Vou ler." },
      { tipo: "ferramenta_do_orquestrador", ferramenta: "Read", detalhe: "/a.ts" },
    ]);
    adaptador.traduzir(fala("Pronto."));
    expect(adaptador.finalizar()).toEqual([{ tipo: "texto_do_orquestrador", texto: "Pronto." }]);
    expect(adaptador.respostaFinal).toBe("Pronto.");
  });

  it("descarta o aviso 'Info: <caminho>' que o Copilot mistura com a fala, sem colar na resposta", () => {
    const { adaptador } = criar();

    adaptador.traduzir(fala("Info: C:\\projeto\\alfa.txt"));
    adaptador.traduzir(fala("feito alfa"));

    expect(adaptador.finalizar()).toEqual([{ tipo: "texto_do_orquestrador", texto: "feito alfa" }]);
    expect(adaptador.respostaFinal).toBe("feito alfa");
  });

  it("a resposta final é a última fala, mesmo que o agente termine numa ferramenta sem falar depois", () => {
    const { adaptador } = criar();
    adaptador.traduzir(fala("Fiz tudo."));
    adaptador.traduzir({ sessionUpdate: "tool_call", toolCallId: "t", kind: "execute", rawInput: { command: "ls" } });

    expect(adaptador.finalizar()).toEqual([]);
    expect(adaptador.respostaFinal).toBe("Fiz tudo.");
  });

  it("não repete a ferramenta quando o agente reenvia o mesmo tool_call", () => {
    const { adaptador } = criar();
    const chamada = { sessionUpdate: "tool_call", toolCallId: "t", kind: "execute", rawInput: { command: "ls" } };

    expect(adaptador.traduzir(chamada)).toHaveLength(1);
    expect(adaptador.traduzir(chamada)).toEqual([]);
    expect(adaptador.atividade).toEqual({ ferramentasUsadas: 1, ultimaFerramenta: "Bash", ultimaAtividade: "ls" });
  });

  it("transforma o raciocínio em sinal de vida, no máximo um por segundo", () => {
    let agora = 10_000;
    const { adaptador } = criar(() => agora);
    const pensar = (texto: string) => adaptador.traduzir({ sessionUpdate: "agent_thought_chunk", content: { type: "text", text: texto } });

    expect(pensar("a".repeat(40))).toEqual([{ tipo: "sinal_de_vida", tokensPensando: 10 }]);
    expect(pensar("b".repeat(40))).toEqual([]);
    agora += 1_500;
    expect(pensar("c".repeat(40))).toEqual([{ tipo: "sinal_de_vida", tokensPensando: 30 }]);
  });

  it("só a saída de comandos pode anunciar um servidor; a de ler arquivo, não", () => {
    const { adaptador, detector } = criar();
    adaptador.traduzir({ sessionUpdate: "tool_call", toolCallId: "r", kind: "read", rawInput: { path: "/README.md" } });
    adaptador.traduzir({
      sessionUpdate: "tool_call_update",
      toolCallId: "r",
      status: "completed",
      content: [{ type: "content", content: { type: "text", text: "abra http://localhost:3000 para ver" } }],
    });
    expect(detector.retirarCandidatos()).toEqual([]);

    adaptador.traduzir({ sessionUpdate: "tool_call", toolCallId: "c", kind: "execute", rawInput: { command: "npm run dev" } });
    adaptador.traduzir({
      sessionUpdate: "tool_call_update",
      toolCallId: "c",
      status: "completed",
      content: [{ type: "content", content: { type: "text", text: "ready on http://localhost:5173" } }],
    });
    expect(detector.retirarCandidatos()).toEqual(["http://localhost:5173"]);
  });

  it("ignora a lista de tarefas com status desconhecido e as atualizações que não interessam à tela", () => {
    const { adaptador } = criar();

    expect(adaptador.traduzir({ sessionUpdate: "plan", entries: [{ content: "x", status: "inventado" }] })).toEqual([]);
    expect(adaptador.traduzir({ sessionUpdate: "plan", entries: [] })).toEqual([]);
    for (const tipo of ["usage_update", "available_commands_update", "config_option_update", "session_info_update", "user_message_chunk"]) {
      expect(adaptador.traduzir({ sessionUpdate: tipo })).toEqual([]);
    }
    expect(adaptador.traduzir("lixo")).toEqual([]);
  });

  it("não mostra a chamada da ferramenta de delegação como ferramenta do Orquestrador", () => {
    const detector = new DetectorDeEnderecosLocais();
    const adaptador = new AdaptadorDeEventosAcp({
      detector,
      ehFerramentaDeDelegacao: (chamada) => chamada.titulo === "delegar_subtarefas",
    });

    expect(adaptador.traduzir({ sessionUpdate: "tool_call", toolCallId: "d", title: "delegar_subtarefas", kind: "other" })).toEqual([]);
    expect(adaptador.atividade.ferramentasUsadas).toBe(0);
  });
});
