// Agente ACP falso para os testes: fala JSON-RPC por stdio (uma mensagem por linha),
// como o `copilot --acp`. O que ele faz num `session/prompt` depende de marcadores
// no texto do prompt; o que ele recebe vai para o arquivo de FALSO_LOG (uma linha JSON cada).
//
// Variáveis: FALSO_LOG, FALSO_SEM_LOAD=1 (sem loadSession), FALSO_SEM_LOGIN=1, FALSO_SEM_USO=1.
// Marcadores do prompt: [[ESCREVER=caminho]] [[COMANDO=comando]] [[MCP]] [[PLANO]] [[LIMITE]]
// [[SOBRECARGA]] [[DEMORAR]] [[MORRER]] [[FALAR=texto]] [[IMAGEM]]
const readline = require("node:readline");
const fs = require("node:fs");

const log = process.env.FALSO_LOG;
function registrar(objeto) {
  if (log) fs.appendFileSync(log, `${JSON.stringify(objeto)}\n`);
}
registrar({ tipo: "argv", argv: process.argv.slice(2), cwd: process.cwd(), ambiente: { COPILOT_ALLOW_ALL: process.env.COPILOT_ALLOW_ALL ?? null } });
{
  // O arquivo de configuração do MCP some no fim do turno: o conteúdo vai para o log agora.
  const indice = process.argv.indexOf("--additional-mcp-config");
  if (indice !== -1) {
    const caminho = process.argv[indice + 1].replace(/^@/, "");
    registrar({ tipo: "mcp-por-arquivo", conteudo: JSON.parse(fs.readFileSync(caminho, "utf8")) });
  }
}

{
  // O arquivo de configurações do sistema (Gemini CLI) também some no fim do turno.
  const caminho = process.env.GEMINI_CLI_SYSTEM_SETTINGS_PATH;
  if (caminho) {
    registrar({ tipo: "configuracao-por-arquivo", conteudo: JSON.parse(fs.readFileSync(caminho, "utf8")) });
  }
}

function enviar(objeto) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...objeto })}\n`);
}
function atualizar(sessionId, update) {
  enviar({ method: "session/update", params: { sessionId, update } });
}

let proximoId = 1000;
const aguardandoResposta = new Map();
function pedir(method, params) {
  const id = proximoId++;
  return new Promise((resolver) => {
    aguardandoResposta.set(id, resolver);
    enviar({ id, method, params });
  });
}

let contador = 0;
const cancelados = new Set();
const aguardandoCancelamento = new Map();

async function pedirPermissao(sessionId, toolCall) {
  const resposta = await pedir("session/request_permission", {
    sessionId,
    toolCall,
    options: [
      { optionId: "allow_once", kind: "allow_once", name: "Allow once" },
      { optionId: "allow_always", kind: "allow_always", name: "Always allow" },
      { optionId: "reject_once", kind: "reject_once", name: "Deny" },
    ],
  });
  registrar({ tipo: "permissao", chamada: toolCall.title, resposta });
  return resposta?.outcome?.outcome === "selected" && resposta.outcome.optionId.startsWith("allow");
}

async function prompt(m) {
  const sessionId = m.params.sessionId;
  const texto = m.params.prompt.map((parte) => (parte.type === "text" ? parte.text : `[${parte.type}]`)).join("\n");
  const marcador = (nome) => new RegExp(`\\[\\[${nome}(?:=([^\\]]*))?\\]\\]`).exec(texto);

  atualizar(sessionId, { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "pensando um pouco" } });
  atualizar(sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Vou " } });
  atualizar(sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "trabalhar." } });

  if (marcador("MORRER")) {
    process.stderr.write("falha fatal do agente falso\n");
    process.exit(3);
  }
  if (marcador("LIMITE")) {
    enviar({ id: m.id, error: { code: -32603, message: "You've hit your usage limit (quota exceeded). Try again in 20 minutes." } });
    return;
  }
  if (marcador("SOBRECARGA")) {
    enviar({ id: m.id, error: { code: -32603, message: "503 Service Unavailable: the model is overloaded" } });
    return;
  }
  const plano = marcador("PLANO");
  if (plano) {
    atualizar(sessionId, {
      sessionUpdate: "plan",
      entries: [
        { content: "Ler o projeto", priority: "high", status: "completed" },
        { content: "Escrever o código", priority: "high", status: "in_progress" },
        { content: "Rodar os testes", priority: "low", status: "pending" },
      ],
    });
  }
  const escrever = marcador("ESCREVER");
  if (escrever) {
    const caminho = escrever[1];
    const chamada = {
      toolCallId: "t-escrever",
      title: "Create file",
      kind: "edit",
      status: "pending",
      rawInput: { fileName: caminho },
      locations: [{ path: caminho }],
    };
    atualizar(sessionId, { sessionUpdate: "tool_call", ...chamada });
    const liberado = await pedirPermissao(sessionId, chamada);
    atualizar(sessionId, { sessionUpdate: "tool_call_update", toolCallId: "t-escrever", status: liberado ? "completed" : "failed" });
  }
  const comando = marcador("COMANDO");
  if (comando) {
    const chamada = {
      toolCallId: "t-comando",
      title: "Run command",
      kind: "execute",
      status: "pending",
      rawInput: { command: comando[1] },
    };
    atualizar(sessionId, { sessionUpdate: "tool_call", ...chamada });
    const liberado = await pedirPermissao(sessionId, chamada);
    atualizar(sessionId, {
      sessionUpdate: "tool_call_update",
      toolCallId: "t-comando",
      status: liberado ? "completed" : "failed",
      content: liberado ? [{ type: "content", content: { type: "text", text: "servidor em http://localhost:5173 no ar" } }] : [],
    });
  }
  if (marcador("MCP")) {
    const chamada = { toolCallId: "t-mcp", title: "delegar_subtarefas", kind: "other", status: "pending", rawInput: { subtarefas: [] } };
    atualizar(sessionId, { sessionUpdate: "tool_call", ...chamada });
    const liberado = await pedirPermissao(sessionId, chamada);
    atualizar(sessionId, { sessionUpdate: "tool_call_update", toolCallId: "t-mcp", status: liberado ? "completed" : "failed" });
  }
  if (marcador("DEMORAR")) {
    await new Promise((resolver) => {
      if (cancelados.has(sessionId)) resolver();
      else aguardandoCancelamento.set(sessionId, resolver);
    });
    // O Copilot responde `end_turn` ao cancelamento de um turno que estava numa ferramenta.
    enviar({ id: m.id, result: { stopReason: process.env.FALSO_CANCELA_COM_END_TURN === "1" ? "end_turn" : "cancelled" } });
    return;
  }
  const falar = marcador("FALAR");
  atualizar(sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: ` ${falar ? falar[1] : "Pronto."}` } });
  enviar({
    id: m.id,
    result: {
      stopReason: "end_turn",
      ...(process.env.FALSO_SEM_USO === "1" ? {} : { usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 } }),
    },
  });
}

const entrada = readline.createInterface({ input: process.stdin });
entrada.on("line", (linha) => {
  const m = JSON.parse(linha);
  if (m.method === undefined) {
    const resolver = aguardandoResposta.get(m.id);
    if (resolver) {
      aguardandoResposta.delete(m.id);
      resolver(m.result);
    }
    return;
  }
  registrar({ tipo: "recebido", method: m.method, params: m.params });
  switch (m.method) {
    case "initialize":
      enviar({
        id: m.id,
        result: {
          protocolVersion: 1,
          agentCapabilities: {
            loadSession: process.env.FALSO_SEM_LOAD !== "1",
            promptCapabilities: { image: true },
            mcpCapabilities: { http: true },
          },
          agentInfo: { name: "Falso", version: "0.0.1" },
          authMethods: [{ id: "falso-login", name: "Login do falso" }],
        },
      });
      break;
    case "authenticate":
      enviar(process.env.FALSO_SEM_LOGIN === "1" ? { id: m.id, error: { code: -32000, message: "Authentication required" } } : { id: m.id, result: {} });
      break;
    case "session/new":
      if (process.env.FALSO_SEM_LOGIN === "1") {
        enviar({ id: m.id, error: { code: -32000, message: "Authentication required" } });
      } else {
        contador += 1;
        enviar({ id: m.id, result: { sessionId: `sessao-falsa-${process.pid}-${contador}`, models: { currentModelId: "modelo-falso" } } });
      }
      break;
    case "session/load":
      if (m.params.sessionId === "sessao-falsa-perdida") {
        enviar({ id: m.id, error: { code: -32002, message: "Session not found" } });
        break;
      }
      // O histórico é repetido ANTES da resposta.
      atualizar(m.params.sessionId, { sessionUpdate: "user_message_chunk", content: { type: "text", text: "pedido antigo" } });
      atualizar(m.params.sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "resposta antiga" } });
      atualizar(m.params.sessionId, { sessionUpdate: "tool_call", toolCallId: "t-antiga", title: "Read file", kind: "read", status: "completed" });
      enviar({ id: m.id, result: { models: { currentModelId: "modelo-falso" } } });
      break;
    case "session/close":
      enviar({ id: m.id, result: {} });
      break;
    case "session/prompt":
      void prompt(m);
      break;
    case "session/cancel": {
      cancelados.add(m.params.sessionId);
      const resolver = aguardandoCancelamento.get(m.params.sessionId);
      if (resolver) resolver();
      break;
    }
    default:
      if (m.id !== undefined) enviar({ id: m.id, error: { code: -32601, message: `Método desconhecido: ${m.method}` } });
  }
});
entrada.on("close", () => process.exit(0));
