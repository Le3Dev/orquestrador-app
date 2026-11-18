// `codex app-server` falso para os testes: JSON-RPC por stdio, uma mensagem por linha e SEM o
// campo "jsonrpc", como o Codex. O que ele faz num `turn/start` depende de marcadores no texto
// do turno; o que ele recebe vai para o arquivo de FALSO_LOG (uma linha JSON cada).
//
// Marcadores: [[COMANDO=cmd]] [[ARQUIVO=caminho]] [[PLANO]] [[LIMITE]] [[SOBRECARGA]] [[LOGIN]]
// [[DEMORAR]] [[MORRER]] [[MCP]] [[FALAR=texto]]
const readline = require("node:readline");
const fs = require("node:fs");

const log = process.env.FALSO_LOG;
function registrar(objeto) {
  if (log) fs.appendFileSync(log, `${JSON.stringify(objeto)}\n`);
}
registrar({
  tipo: "argv",
  argv: process.argv.slice(2),
  cwd: process.cwd(),
  tokenMcp: process.env.ORQUESTRADOR_MCP_TOKEN_DO_TURNO ?? null,
  chaveDoApp: process.env.ORQUESTRADOR_CHAVE_DE_ACESSO ?? null,
});

function enviar(objeto) {
  process.stdout.write(`${JSON.stringify(objeto)}\n`);
}

let proximoId = 5000;
const aguardandoResposta = new Map();
function pedir(method, params) {
  const id = proximoId++;
  return new Promise((resolver) => {
    aguardandoResposta.set(id, resolver);
    enviar({ id, method, params });
  });
}

let contadorDeThreads = 0;
const interrompidos = new Set();
const aguardandoInterrupcao = new Map();

async function turno(m) {
  const { threadId } = m.params;
  const turnId = "turno-1";
  const texto = m.params.input.map((item) => (item.type === "text" ? item.text : `[${item.type}]`)).join("\n");
  const marcador = (nome) => new RegExp(`\\[\\[${nome}(?:=([^\\]]*))?\\]\\]`).exec(texto);
  const base = { threadId, turnId };

  enviar({ id: m.id, result: { turn: { id: turnId, status: "inProgress", items: [], error: null } } });
  enviar({ method: "turn/started", params: { threadId, turn: { id: turnId, status: "inProgress", items: [] } } });
  enviar({ method: "item/reasoning/textDelta", params: { ...base, itemId: "r1", delta: "pensando" } });

  if (marcador("MORRER")) {
    process.stderr.write("falha fatal do app-server falso\n");
    process.exit(3);
  }
  if (marcador("LOGIN")) {
    enviar({
      method: "error",
      params: {
        ...base,
        willRetry: true,
        error: { message: "Reconnecting... 2/5", codexErrorInfo: { responseStreamDisconnected: { httpStatusCode: 401 } } },
      },
    });
    await esperarInterrupcao(threadId);
    enviar({ method: "turn/completed", params: { threadId, turn: { id: turnId, status: "interrupted", items: [] } } });
    return;
  }
  if (marcador("DEMORAR")) {
    await esperarInterrupcao(threadId);
    enviar({ method: "turn/completed", params: { threadId, turn: { id: turnId, status: "interrupted", items: [] } } });
    return;
  }
  if (marcador("LIMITE")) {
    const reposicao = Math.floor(Date.now() / 1000) + 3600;
    enviar({
      method: "account/rateLimits/updated",
      params: { rateLimits: { primary: { usedPercent: 100, windowDurationMins: 300, resetsAt: reposicao }, secondary: { usedPercent: 40, windowDurationMins: 10080, resetsAt: reposicao + 86400 }, rateLimitReachedType: "rate_limit_reached" } },
    });
    const erro = { message: "You've hit your usage limit.", codexErrorInfo: "usageLimitExceeded" };
    enviar({ method: "error", params: { ...base, willRetry: false, error: erro } });
    enviar({ method: "turn/completed", params: { threadId, turn: { id: turnId, status: "failed", items: [], error: erro } } });
    return;
  }
  if (marcador("SOBRECARGA")) {
    const erro = { message: "Selected model is at capacity.", codexErrorInfo: "serverOverloaded" };
    enviar({ method: "turn/completed", params: { threadId, turn: { id: turnId, status: "failed", items: [], error: erro } } });
    return;
  }
  if (marcador("PLANO")) {
    enviar({
      method: "turn/plan/updated",
      params: { ...base, plan: [{ step: "Ler o projeto", status: "completed" }, { step: "Escrever o código", status: "inProgress" }, { step: "Rodar os testes", status: "pending" }] },
    });
  }
  const comando = marcador("COMANDO");
  if (comando) {
    const item = { id: "cmd-1", type: "commandExecution", command: comando[1], cwd: process.cwd(), status: "inProgress", commandActions: [] };
    enviar({ method: "item/started", params: { ...base, item } });
    const resposta = await pedir("item/commandExecution/requestApproval", { ...base, itemId: "cmd-1", command: comando[1], cwd: process.cwd() });
    registrar({ tipo: "aprovacao", pedido: "comando", comando: comando[1], resposta });
    const aceito = resposta?.decision === "accept";
    enviar({
      method: "item/completed",
      params: { ...base, item: { ...item, status: aceito ? "completed" : "declined", aggregatedOutput: aceito ? "servidor em http://localhost:5173 no ar" : null } },
    });
  }
  const arquivo = marcador("ARQUIVO");
  if (arquivo) {
    const item = { id: "arq-1", type: "fileChange", changes: [{ path: arquivo[1], kind: { type: "add" }, diff: "+x" }], status: "inProgress" };
    enviar({ method: "item/started", params: { ...base, item } });
    const resposta = await pedir("item/fileChange/requestApproval", { ...base, itemId: "arq-1" });
    registrar({ tipo: "aprovacao", pedido: "arquivo", caminho: arquivo[1], resposta });
    enviar({ method: "item/completed", params: { ...base, item: { ...item, status: resposta?.decision === "accept" ? "completed" : "declined" } } });
  }
  if (marcador("MCP")) {
    const item = { id: "mcp-1", type: "mcpToolCall", server: "orquestrador", tool: "delegar_subtarefas", status: "inProgress", arguments: {} };
    enviar({ method: "item/started", params: { ...base, item } });
    enviar({ method: "item/completed", params: { ...base, item: { ...item, status: "completed" } } });
  }
  enviar({ method: "item/completed", params: { ...base, item: { id: "msg-0", type: "agentMessage", text: "Vou trabalhar.", phase: "commentary" } } });
  const falar = marcador("FALAR");
  enviar({
    method: "item/completed",
    params: { ...base, item: { id: "msg-1", type: "agentMessage", text: falar ? falar[1] : "Feito.", phase: "final_answer" } },
  });
  const uso = { inputTokens: 50, cachedInputTokens: 10, outputTokens: 10, reasoningOutputTokens: 0, totalTokens: 60 };
  enviar({ method: "thread/tokenUsage/updated", params: { ...base, tokenUsage: { last: uso, total: uso, modelContextWindow: 200000 } } });
  enviar({ method: "thread/tokenUsage/updated", params: { ...base, tokenUsage: { last: uso, total: uso, modelContextWindow: 200000 } } });
  enviar({ method: "turn/completed", params: { threadId, turn: { id: turnId, status: "completed", items: [], error: null } } });
}

function esperarInterrupcao(threadId) {
  return new Promise((resolver) => {
    if (interrompidos.has(threadId)) resolver();
    else aguardandoInterrupcao.set(threadId, resolver);
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
      enviar({ id: m.id, result: { userAgent: "falso/0.0.1", codexHome: "/falso", platformFamily: "unix", platformOs: "linux" } });
      break;
    case "initialized":
      break;
    case "account/read":
      enviar({ id: m.id, result: process.env.FALSO_SEM_LOGIN === "1" ? { account: null, requiresOpenaiAuth: true } : { account: { type: "chatgpt", email: "x@y.z", planType: "plus" }, requiresOpenaiAuth: true } });
      break;
    case "thread/start":
    case "thread/resume": {
      if (m.method === "thread/resume" && m.params.threadId === "thread-perdida") {
        enviar({ id: m.id, error: { code: -32600, message: "no rollout found for thread id thread-perdida" } });
        break;
      }
      const id = m.method === "thread/resume" ? m.params.threadId : `thread-falsa-${process.pid}-${++contadorDeThreads}`;
      enviar({ id: m.id, result: { thread: { id, ephemeral: m.params.ephemeral === true }, model: "gpt-falso", approvalPolicy: m.params.approvalPolicy, sandbox: { type: m.params.sandbox } } });
      enviar({ method: "thread/started", params: { thread: { id } } });
      break;
    }
    case "turn/start":
      void turno(m);
      break;
    case "turn/interrupt": {
      enviar({ id: m.id, result: {} });
      interrompidos.add(m.params.threadId);
      const resolver = aguardandoInterrupcao.get(m.params.threadId);
      if (resolver) resolver();
      break;
    }
    default:
      if (m.id !== undefined) enviar({ id: m.id, error: { code: -32601, message: `Método desconhecido: ${m.method}` } });
  }
});
entrada.on("close", () => process.exit(0));
