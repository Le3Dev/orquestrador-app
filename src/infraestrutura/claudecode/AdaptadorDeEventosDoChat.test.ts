import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { EventoDoMotorDeChat } from "../../chat/MotorDeChat";
import { AdaptadorDeEventosDoChat } from "./AdaptadorDeEventosDoChat";

/**
 * `chat-turno1` é a saída real de `claude -p --output-format stream-json
 * --include-partial-messages` (Claude Code 2.1.317, Haiku, esforço baixo) para
 * "Pesquise na web qual é a versão LTS mais recente do Node.js e responda em
 * uma frase.": um WebSearch, um WebFetch e a resposta em pedaços.
 */
function traduzirTudo(
  mensagens: unknown[],
  alteracoesAutorizadas = false,
): { adaptador: AdaptadorDeEventosDoChat; eventos: EventoDoMotorDeChat[] } {
  const adaptador = new AdaptadorDeEventosDoChat(alteracoesAutorizadas);
  return { adaptador, eventos: mensagens.flatMap((mensagem) => adaptador.traduzir(mensagem)) };
}

function lerFixture(nome: string): unknown[] {
  return readFileSync(path.join(__dirname, "fixtures", nome), "utf8")
    .split("\n")
    .filter((linha) => linha.trim() !== "")
    .map((linha): unknown => JSON.parse(linha));
}

function doTipo<Tipo extends EventoDoMotorDeChat["tipo"]>(
  eventos: EventoDoMotorDeChat[],
  tipo: Tipo,
): Extract<EventoDoMotorDeChat, { tipo: Tipo }>[] {
  return eventos.filter((evento): evento is Extract<EventoDoMotorDeChat, { tipo: Tipo }> => evento.tipo === tipo);
}

const linhasDaFixture = lerFixture("chat-turno1.ndjson");

describe("AdaptadorDeEventosDoChat — pergunta real com pesquisa na web", () => {
  const { adaptador, eventos } = traduzirTudo(linhasDaFixture);

  it("entrega a resposta em vários trechos que, juntos, formam a resposta final", () => {
    const trechos = doTipo(eventos, "trecho_da_resposta");
    const resposta = adaptador.resultado?.sucesso === true ? adaptador.resultado.resposta : "";

    expect(trechos.length).toBeGreaterThan(1);
    expect(resposta).toContain("Node.js");
    expect(trechos.map((trecho) => trecho.texto).join("").trim()).toBe(resposta.trim());
  });

  it("não vaza o JSON de entrada das ferramentas nem o raciocínio como trecho", () => {
    const texto = doTipo(eventos, "trecho_da_resposta")
      .map((trecho) => trecho.texto)
      .join("");

    expect(texto).not.toContain('"query"');
  });

  it("mostra as ferramentas usadas com a consulta e a URL", () => {
    expect(doTipo(eventos, "ferramenta_do_chat")).toEqual([
      { tipo: "ferramenta_do_chat", ferramenta: "WebSearch", detalhe: "Node.js latest LTS version release" },
      { tipo: "ferramenta_do_chat", ferramenta: "WebFetch", detalhe: "https://nodejs.org/en/about/previous-releases" },
    ]);
  });

  it("traduz o uso da cota da assinatura", () => {
    const [cota] = doTipo(eventos, "uso_da_cota");

    expect(cota?.janelas.map((janela) => janela.nome)).toEqual(["5 horas", "7 dias"]);
    expect(cota?.janelas[0]?.renovaEm).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("monta o resultado com o consumo e o modelo usado, sem pendência nem avisos", () => {
    expect(adaptador.resultado).toMatchObject({
      sucesso: true,
      uso: {
        duracaoMs: 24603,
        tokensDeEntrada: 16506 + 51328 + 20264,
        tokensDeSaida: 1368,
        modeloUsado: "claude-haiku-5-5",
      },
      autorizacaoPendente: null,
      avisos: [],
    });
  });
});

/**
 * `chat-negacao` é a saída real de `claude -p --output-format stream-json
 * --verbose --permission-mode dontAsk --tools PowerShell Write --allowedTools
 * Read` (Claude Code 2.1.318, Haiku) para "rode `echo oi` no PowerShell e crie
 * o arquivo teste.txt": as duas chamadas são negadas por não estarem
 * liberadas (`decision_reason_type: "mode"`), primeiro o PowerShell.
 */
describe("AdaptadorDeEventosDoChat — negação real sem autorização", () => {
  const linhas = lerFixture("chat-negacao.ndjson");

  it("a primeira negação (o comando) vira a autorização pendente; o Write seguinte fica coberto por ela", () => {
    const { adaptador } = traduzirTudo(linhas);

    expect(adaptador.resultado).toMatchObject({
      sucesso: true,
      autorizacaoPendente: { acao: "rodar_comando", detalhe: "echo oi" },
      avisos: [],
    });
  });

  it("as mensagens de negação não viram eventos para a tela", () => {
    const { eventos } = traduzirTudo(linhas);

    expect(doTipo(eventos, "ferramenta_do_chat").map((evento) => [evento.ferramenta, evento.detalhe])).toEqual([
      ["PowerShell", "echo oi"],
      ["Write", "C:\\Users\\leandro.canha\\AppData\\Local\\Temp\\negacao-chat-3d318250\\teste.txt"],
    ]);
  });

  it("com alterações autorizadas, as negações viram avisos, sem pendência", () => {
    const { adaptador } = traduzirTudo(linhas, true);

    expect(adaptador.resultado).toMatchObject({
      sucesso: true,
      autorizacaoPendente: null,
      avisos: [
        "Bloqueado pelas permissões do chat: PowerShell · echo oi",
        "Bloqueado pelas permissões do chat: Write · C:\\Users\\leandro.canha\\AppData\\Local\\Temp\\negacao-chat-3d318250\\teste.txt",
      ],
    });
  });
});

/**
 * `chat-negacao-por-regra` é a saída real com `--tools PowerShell Read
 * --allowedTools PowerShell Read --disallowedTools "PowerShell(echo
 * proibido*)" "Read(.env*)"`, pedindo para ler o `.env` e rodar `echo
 * proibido`: o Read do `.env` não gera `permission_denied` (só aparece no
 * `result`) e o comando vem com `decision_reason_type: "rule"`.
 */
describe("AdaptadorDeEventosDoChat — negação real por regra fixa", () => {
  it("leitura de .env e comando bloqueado por regra viram avisos comuns, nunca pendência", () => {
    const { adaptador } = traduzirTudo(lerFixture("chat-negacao-por-regra.ndjson"));

    expect(adaptador.resultado).toMatchObject({
      sucesso: true,
      autorizacaoPendente: null,
      avisos: [
        "Bloqueado pelas permissões do chat: Read · C:\\Users\\leandro.canha\\AppData\\Local\\Temp\\negacao-regra-f2eefd5d\\.env",
        "Bloqueado pelas permissões do chat: PowerShell · echo proibido",
      ],
    });
  });
});

describe("AdaptadorDeEventosDoChat — negações sintéticas", () => {
  function negado(ferramenta: string, id: string, motivo = "mode"): Record<string, unknown> {
    return { type: "system", subtype: "permission_denied", tool_name: ferramenta, tool_use_id: id, decision_reason_type: motivo };
  }

  function resultado(negacoes: { ferramenta: string; id: string; entrada: Record<string, unknown> }[]): Record<string, unknown> {
    return {
      type: "result",
      subtype: "success",
      is_error: false,
      result: "ok",
      duration_ms: 1,
      modelUsage: {},
      permission_denials: negacoes.map(({ ferramenta, id, entrada }) => ({ tool_name: ferramenta, tool_use_id: id, tool_input: entrada })),
    };
  }

  it("Write negado vira 'editar' com o caminho do arquivo", () => {
    const { adaptador } = traduzirTudo([
      negado("Write", "t1"),
      resultado([{ ferramenta: "Write", id: "t1", entrada: { file_path: "src/x.ts", content: "a" } }]),
    ]);

    expect(adaptador.resultado).toMatchObject({ autorizacaoPendente: { acao: "editar", detalhe: "src/x.ts" }, avisos: [] });
  });

  it("Edit e NotebookEdit também viram 'editar', com o caminho", () => {
    const edit = traduzirTudo([resultado([{ ferramenta: "Edit", id: "t1", entrada: { file_path: "a.ts", old_string: "x", new_string: "y" } }])]);
    const notebook = traduzirTudo([resultado([{ ferramenta: "NotebookEdit", id: "t1", entrada: { notebook_path: "n.ipynb", new_source: "x" } }])]);

    expect(edit.adaptador.resultado).toMatchObject({ autorizacaoPendente: { acao: "editar", detalhe: "a.ts" } });
    expect(notebook.adaptador.resultado).toMatchObject({ autorizacaoPendente: { acao: "editar", detalhe: "n.ipynb" } });
  });

  it("PowerShell e Bash negados viram 'rodar_comando' com o comando", () => {
    const powershell = traduzirTudo([
      negado("PowerShell", "t1"),
      resultado([{ ferramenta: "PowerShell", id: "t1", entrada: { command: "npm test", description: "testes" } }]),
    ]);
    const bash = traduzirTudo([resultado([{ ferramenta: "Bash", id: "t1", entrada: { command: "ls -la" } }])]);

    expect(powershell.adaptador.resultado).toMatchObject({ autorizacaoPendente: { acao: "rodar_comando", detalhe: "npm test" } });
    expect(bash.adaptador.resultado).toMatchObject({ autorizacaoPendente: { acao: "rodar_comando", detalhe: "ls -la" } });
  });

  it("vale a primeira negação da resposta", () => {
    const { adaptador } = traduzirTudo([
      resultado([
        { ferramenta: "Write", id: "t1", entrada: { file_path: "a.ts" } },
        { ferramenta: "PowerShell", id: "t2", entrada: { command: "npm test" } },
      ]),
    ]);

    expect(adaptador.resultado).toMatchObject({ autorizacaoPendente: { acao: "editar", detalhe: "a.ts" }, avisos: [] });
  });

  it("negação de outra ferramenta vira aviso comum, sem pendência", () => {
    const { adaptador } = traduzirTudo([
      negado("WebFetch", "t1"),
      resultado([{ ferramenta: "WebFetch", id: "t1", entrada: { url: "https://exemplo.com", prompt: "x" } }]),
    ]);

    expect(adaptador.resultado).toMatchObject({
      autorizacaoPendente: null,
      avisos: ["Bloqueado pelas permissões do chat: WebFetch · https://exemplo.com"],
    });
  });

  it("comando negado por regra (push forçado) é aviso, e a próxima negação comum ainda vira pendência", () => {
    const { adaptador } = traduzirTudo([
      negado("PowerShell", "t1", "rule"),
      negado("Edit", "t2"),
      resultado([
        { ferramenta: "PowerShell", id: "t1", entrada: { command: "git push --force" } },
        { ferramenta: "Edit", id: "t2", entrada: { file_path: "b.ts" } },
      ]),
    ]);

    expect(adaptador.resultado).toMatchObject({
      autorizacaoPendente: { acao: "editar", detalhe: "b.ts" },
      avisos: ["Bloqueado pelas permissões do chat: PowerShell · git push --force"],
    });
  });

  it("junta as negações de vários result sem repetir a mesma chamada", () => {
    const primeira = { ferramenta: "Read", id: "t1", entrada: { file_path: ".env" } };
    const { adaptador } = traduzirTudo([resultado([primeira]), resultado([primeira, { ferramenta: "Bash", id: "t2", entrada: { command: "ls" } }])]);

    expect(adaptador.resultado).toMatchObject({
      autorizacaoPendente: { acao: "rodar_comando", detalhe: "ls" },
      avisos: ["Bloqueado pelas permissões do chat: Read · .env"],
    });
  });

  it("resposta com falha não traz pendência", () => {
    const { adaptador } = traduzirTudo([
      { ...resultado([{ ferramenta: "Write", id: "t1", entrada: { file_path: "a.ts" } }]), subtype: "error_during_execution", is_error: true, result: "" },
    ]);

    expect(adaptador.resultado).toEqual({ sucesso: false, motivo: expect.stringContaining("erro durante"), uso: expect.any(Object) });
  });
});

describe("AdaptadorDeEventosDoChat — linhas sintéticas", () => {
  const uso = (entrada: number, saida: number) => ({
    inputTokens: entrada,
    outputTokens: saida,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
  });

  it("com vários result, usa o último acumulado — nunca a soma", () => {
    const { adaptador } = traduzirTudo([
      {
        type: "result",
        subtype: "success",
        is_error: false,
        result: "primeira",
        duration_ms: 100,
        modelUsage: { "claude-opus-5-5": uso(10, 100) },
      },
      {
        type: "result",
        subtype: "success",
        is_error: false,
        result: "final",
        duration_ms: 300,
        modelUsage: { "claude-opus-5-5": uso(30, 250), "claude-haiku-5-5": uso(5, 20) },
      },
    ]);

    expect(adaptador.resultado).toEqual({
      sucesso: true,
      resposta: "final",
      uso: { duracaoMs: 300, tokensDeEntrada: 35, tokensDeSaida: 270, modeloUsado: "claude-opus-5-5" },
      autorizacaoPendente: null,
      avisos: [],
    });
  });

  it("em sessão retomada, conta só o consumo desde o último result, não o da conversa inteira", () => {
    const { adaptador } = traduzirTudo([
      {
        type: "result",
        subtype: "success",
        is_error: false,
        result: "ok",
        duration_ms: 50,
        modelUsage: { "claude-haiku-5-5": uso(1000, 900) },
        model_usage_since_last_result: { "claude-haiku-5-5": uso(40, 30) },
      },
    ]);

    expect(adaptador.resultado).toMatchObject({ uso: { tokensDeEntrada: 40, tokensDeSaida: 30 } });
  });

  it("transforma o limite de uso em falha com motivo em português", () => {
    const { adaptador } = traduzirTudo([
      { type: "result", subtype: "success", is_error: true, result: "Claude AI usage limit reached|1793221200" },
    ]);

    expect(adaptador.resultado).toMatchObject({
      sucesso: false,
      motivo: expect.stringContaining("Limite de uso da assinatura"),
    });
  });

  it("explica o subtipo de erro quando não há texto", () => {
    const { adaptador } = traduzirTudo([{ type: "result", subtype: "error_during_execution", is_error: true }]);

    expect(adaptador.resultado).toMatchObject({ sucesso: false, motivo: expect.stringContaining("erro durante") });
  });

  it("ignora linhas desconhecidas, deltas de pensamento e eventos de subagentes", () => {
    const { adaptador, eventos } = traduzirTudo([
      "texto solto",
      null,
      { type: "coisa_nova", campo: 1 },
      { type: "stream_event", parent_tool_use_id: null, event: { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "hm" } } },
      { type: "stream_event", parent_tool_use_id: "toolu_x", event: { type: "content_block_delta", delta: { type: "text_delta", text: "sub" } } },
      { type: "assistant", parent_tool_use_id: "toolu_x", message: { content: [{ type: "tool_use", name: "Read", input: { file_path: "a" } }] } },
      { type: "stream_event", parent_tool_use_id: null, event: { type: "content_block_delta", delta: { type: "text_delta", text: "oi" } } },
    ]);

    expect(eventos).toEqual([{ tipo: "trecho_da_resposta", texto: "oi" }]);
    expect(adaptador.resultado).toBeNull();
  });

  it("system/init gera sessao_aberta; os outros system não geram evento", () => {
    const { eventos } = traduzirTudo([
      { type: "system", subtype: "init", session_id: "abc" },
      { type: "system", subtype: "task_started" },
      { type: "system", subtype: "background_tasks_changed" },
    ]);

    expect(eventos).toEqual([{ tipo: "sessao_aberta" }]);
  });

  it("resume Read pelo caminho e Glob/Grep pelo padrão", () => {
    const { eventos } = traduzirTudo([
      {
        type: "assistant",
        parent_tool_use_id: null,
        message: {
          content: [
            { type: "tool_use", name: "Read", input: { file_path: "C:\\p\\a.ts" } },
            { type: "tool_use", name: "Grep", input: { pattern: "TODO", path: "C:\\p" } },
            { type: "tool_use", name: "Glob", input: { pattern: "**/*.ts" } },
          ],
        },
      },
    ]);

    expect(doTipo(eventos, "ferramenta_do_chat").map((evento) => evento.detalhe)).toEqual([
      "C:\\p\\a.ts",
      "TODO",
      "**/*.ts",
    ]);
  });

  it("com ultracode, mostra o Workflow pelo nome e ignora os task_* do workflow", () => {
    const script = "export const meta = {\n  name: 'revisao-do-chat',\n  description: 'Revisar',\n}\nawait agent('x')\n";
    const { adaptador, eventos } = traduzirTudo([
      {
        type: "assistant",
        parent_tool_use_id: null,
        message: { content: [{ type: "tool_use", id: "toolu_w", name: "Workflow", input: { script } }] },
      },
      { type: "system", subtype: "background_tasks_changed", tasks: [{ task_id: "w1", task_type: "local_workflow" }] },
      {
        type: "system",
        subtype: "task_started",
        task_id: "w1",
        tool_use_id: "toolu_w",
        task_type: "local_workflow",
        workflow_name: "revisao-do-chat",
        prompt: script,
      },
      { type: "system", subtype: "task_progress", task_id: "w1", description: "Revisar: revisor", workflow_progress: [] },
      { type: "system", subtype: "task_updated", task_id: "w1", patch: { status: "completed" } },
      { type: "system", subtype: "task_notification", task_id: "w1", status: "completed", summary: "Pronto" },
      { type: "stream_event", parent_tool_use_id: null, event: { type: "content_block_delta", delta: { type: "text_delta", text: "Feito." } } },
      { type: "result", subtype: "success", is_error: false, result: "Feito.", duration_ms: 10 },
    ]);

    expect(eventos).toEqual([
      { tipo: "ferramenta_do_chat", ferramenta: "Workflow", detalhe: "revisao-do-chat" },
      { tipo: "trecho_da_resposta", texto: "Feito." },
    ]);
    expect(adaptador.resultado).toMatchObject({ sucesso: true, resposta: "Feito.", autorizacaoPendente: null, avisos: [] });
  });
});

describe("AdaptadorDeEventosDoChat — subagentes (ferramenta Agent)", () => {
  function chamada(entrada: Record<string, unknown>): Record<string, unknown> {
    return {
      type: "assistant",
      parent_tool_use_id: null,
      message: { content: [{ type: "tool_use", id: "toolu_a", name: "Agent", input: entrada }] },
    };
  }

  function detalhes(entrada: Record<string, unknown>): string[] {
    return doTipo(traduzirTudo([chamada(entrada)]).eventos, "ferramenta_do_chat").map((evento) => evento.detalhe);
  }

  it("mostra o nome do subagente, sem o prefixo do plugin quando ele repete o nome", () => {
    expect(detalhes({ subagent_type: "adhd-study-coach:adhd-study-coach", description: "Dizer oi", prompt: "x" })).toEqual([
      "adhd-study-coach",
    ]);
    expect(detalhes({ subagent_type: "general-purpose", description: "Pesquisar", prompt: "x" })).toEqual(["general-purpose"]);
  });

  it("mantém o prefixo quando o plugin e o subagente têm nomes diferentes", () => {
    expect(detalhes({ subagent_type: "meu-plugin:revisor", description: "Revisar", prompt: "x" })).toEqual(["meu-plugin:revisor"]);
  });

  it("sem subagent_type, usa a descrição; sem nada, resume a entrada", () => {
    expect(detalhes({ description: "Pesquisar o assunto", prompt: "texto longo do prompt" })).toEqual(["Pesquisar o assunto"]);
    expect(detalhes({ subagent_type: "  ", description: "Pesquisar o assunto" })).toEqual(["Pesquisar o assunto"]);
    expect(detalhes({ prompt: "só o prompt" })).toEqual([JSON.stringify({ prompt: "só o prompt" })]);
  });

  it("as mensagens do subagente (texto, ferramentas e prompt) ficam fora da resposta", () => {
    const { adaptador, eventos } = traduzirTudo([
      chamada({ subagent_type: "adhd-study-coach:adhd-study-coach", description: "Dizer oi" }),
      { type: "stream_event", parent_tool_use_id: "toolu_a", event: { type: "content_block_delta", delta: { type: "text_delta", text: "Texto interno do coach" } } },
      { type: "assistant", parent_tool_use_id: "toolu_a", message: { content: [{ type: "tool_use", name: "Bash", input: { command: "ls ~/.adhd-study-coach" } }] } },
      { type: "user", parent_tool_use_id: "toolu_a", message: { content: [{ type: "tool_result", content: "interno" }] } },
      { type: "stream_event", parent_tool_use_id: null, event: { type: "content_block_delta", delta: { type: "text_delta", text: "O coach disse oi." } } },
      { type: "result", subtype: "success", is_error: false, result: "O coach disse oi.", duration_ms: 10 },
    ]);

    expect(eventos).toEqual([
      { tipo: "ferramenta_do_chat", ferramenta: "Agent", detalhe: "adhd-study-coach" },
      { tipo: "trecho_da_resposta", texto: "O coach disse oi." },
    ]);
    expect(adaptador.resultado).toMatchObject({ sucesso: true, resposta: "O coach disse oi.", autorizacaoPendente: null, avisos: [] });
  });

  it("uma negação dentro do subagente, com alterações autorizadas, vira aviso e não pedido de autorização", () => {
    const { adaptador } = traduzirTudo(
      [
        { type: "system", subtype: "permission_denied", tool_name: "Bash", tool_use_id: "toolu_b", decision_reason_type: "rule", parent_tool_use_id: "toolu_a" },
        {
          type: "result",
          subtype: "success",
          is_error: false,
          result: "Não consegui.",
          duration_ms: 1,
          permission_denials: [{ tool_name: "Bash", tool_use_id: "toolu_b", tool_input: { command: "git push --force" } }],
        },
      ],
      true,
    );

    expect(adaptador.resultado).toMatchObject({
      autorizacaoPendente: null,
      avisos: ["Bloqueado pelas permissões do chat: Bash · git push --force"],
    });
  });

  it("o próprio Agent negado vira aviso comum, nunca pedido de autorização", () => {
    const { adaptador } = traduzirTudo([
      {
        type: "result",
        subtype: "success",
        is_error: false,
        result: "ok",
        duration_ms: 1,
        permission_denials: [{ tool_name: "Agent", tool_use_id: "toolu_a", tool_input: { subagent_type: "x:x" } }],
      },
    ]);

    expect(adaptador.resultado).toMatchObject({
      autorizacaoPendente: null,
      avisos: ["Bloqueado pelas permissões do chat: Agent · x"],
    });
  });
});

describe("AdaptadorDeEventosDoChat — modelo mostrado com subagente de outro modelo", () => {
  const uso = (entrada: number, saida: number) => ({
    inputTokens: entrada,
    outputTokens: saida,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
  });
  const iniciar = (modelo: string) => ({ type: "system", subtype: "init", model: modelo });
  const doAgentePrincipal = (modelo: string) => ({
    type: "assistant",
    parent_tool_use_id: null,
    message: { model: modelo, content: [{ type: "text", text: "ok" }] },
  });
  const doSubagente = (modelo: string) => ({
    type: "assistant",
    parent_tool_use_id: "toolu_a",
    message: { model: modelo, content: [{ type: "text", text: "interno" }] },
  });
  // O subagente (sonnet) gera mais saída que o chat (opus).
  const resultado = {
    type: "result",
    subtype: "success",
    is_error: false,
    result: "ok",
    duration_ms: 10,
    modelUsage: { "claude-opus-5-5": uso(100, 40), "claude-sonnet-5-5": uso(200, 500) },
  };

  it("mostra o modelo do agente principal, mesmo com o subagente gerando mais saída, e soma os dois", () => {
    const { adaptador } = traduzirTudo([
      iniciar("claude-opus-5-5"),
      doAgentePrincipal("claude-opus-5-5"),
      doSubagente("claude-sonnet-5-5"),
      doAgentePrincipal("claude-opus-5-5"),
      resultado,
    ]);

    expect(adaptador.resultado).toMatchObject({
      uso: { tokensDeEntrada: 300, tokensDeSaida: 540, modeloUsado: "claude-opus-5-5" },
    });
  });

  it("sem message.model do agente principal, usa o model do system/init", () => {
    const { adaptador } = traduzirTudo([
      iniciar("claude-opus-5-5"),
      doSubagente("claude-sonnet-5-5"),
      { type: "assistant", parent_tool_use_id: null, message: { model: "<synthetic>", content: [] } },
      resultado,
    ]);

    expect(adaptador.resultado).toMatchObject({ uso: { tokensDeSaida: 540, modeloUsado: "claude-opus-5-5" } });
  });

  it("sem message.model nem init, cai na regra do modelo com maior saída", () => {
    const { adaptador } = traduzirTudo([doSubagente("claude-sonnet-5-5"), resultado]);

    expect(adaptador.resultado).toMatchObject({ uso: { modeloUsado: "claude-sonnet-5-5" } });
  });

  it("com um init repetido (ciclo retomado), o modelo do agente principal continua valendo", () => {
    const { adaptador } = traduzirTudo([
      iniciar("claude-opus-5-5"),
      doAgentePrincipal("claude-opus-5-5"),
      iniciar("claude-opus-5-5"),
      resultado,
    ]);

    expect(adaptador.resultado).toMatchObject({ uso: { modeloUsado: "claude-opus-5-5" } });
  });
});
