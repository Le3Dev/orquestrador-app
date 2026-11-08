import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { EventoDoMotor } from "../../orquestracao/EventoDeOrquestracao";
import { AdaptadorDeEventosDoClaudeCode, classificarFalha, nomeDoWorkflow } from "./AdaptadorDeEventosDoClaudeCode";

/**
 * As fixtures são saídas reais de `claude -p --output-format stream-json`
 * (Claude Code 2.1.312), capturadas no spike de validação:
 * - turno1: orquestrador lança 2 subagentes em paralelo, cada um lê um arquivo;
 * - turno2: sessão retomada; o orquestrador tenta um `git commit`, que é negado.
 */
function traduzirFixture(nome: string): { adaptador: AdaptadorDeEventosDoClaudeCode; eventos: EventoDoMotor[] } {
  const adaptador = new AdaptadorDeEventosDoClaudeCode();
  const linhas = readFileSync(path.join(__dirname, "fixtures", `${nome}.ndjson`), "utf8")
    .split("\n")
    .filter((linha) => linha.trim() !== "");
  const eventos = linhas.flatMap((linha) => adaptador.traduzir(JSON.parse(linha)));
  return { adaptador, eventos };
}

function doTipo<Tipo extends EventoDoMotor["tipo"]>(
  eventos: EventoDoMotor[],
  tipo: Tipo,
): Extract<EventoDoMotor, { tipo: Tipo }>[] {
  return eventos.filter((evento): evento is Extract<EventoDoMotor, { tipo: Tipo }> => evento.tipo === tipo);
}

const PERIODO = "a41787646eec07830";
const RESERVA = "a6a6ac08da859dc4b";

describe("AdaptadorDeEventosDoClaudeCode — turno com dois subagentes", () => {
  const { adaptador, eventos } = traduzirFixture("turno1");

  it("começa avisando que a sessão foi iniciada", () => {
    expect(eventos[0]).toEqual({ tipo: "sessao_iniciada" });
  });

  it("dá sinal de vida enquanto o Claude raciocina, com a estimativa de tokens", () => {
    const sinais = doTipo(eventos, "sinal_de_vida");

    expect(sinais.length).toBeGreaterThan(0);
    expect(sinais[0]).toEqual({ tipo: "sinal_de_vida", tokensPensando: 50 });
    expect(sinais[1]?.tokensPensando).toBe(267);
  });

  it("identifica os dois subagentes pelo task_id", () => {
    const iniciados = doTipo(eventos, "subagente_iniciado");

    expect(iniciados.map((evento) => evento.subagenteId)).toEqual([PERIODO, RESERVA]);
    expect(iniciados[0]?.descricao).toBe("Descrever Periodo.ts");
    expect(iniciados[0]?.tarefa).toContain("Periodo.ts");
  });

  it("atribui progresso, textos e conclusão ao subagente certo", () => {
    const progresso = doTipo(eventos, "progresso_do_subagente");
    expect(progresso.map((evento) => evento.subagenteId).sort()).toEqual([PERIODO, RESERVA].sort());
    expect(progresso[0]?.ultimaFerramenta).toBe("Read");

    const textos = doTipo(eventos, "texto_do_subagente");
    expect(textos.find((evento) => evento.subagenteId === PERIODO)?.texto).toContain("Periodo");
    expect(textos.find((evento) => evento.subagenteId === RESERVA)?.texto).toContain("Reserva");

    const concluidos = doTipo(eventos, "subagente_concluido");
    expect(concluidos.map((evento) => evento.situacao)).toEqual(["concluido", "concluido"]);
    expect(concluidos[0]?.tokens).toBeGreaterThan(0);
  });

  it("entrega o relatório final de cada subagente sem as marcações do Claude Code", () => {
    const resultados = doTipo(eventos, "resultado_do_subagente");

    expect(resultados.map((evento) => evento.subagenteId)).toEqual([PERIODO, RESERVA]);
    expect(resultados[0]?.resultado).toMatch(/^Objeto de valor imutável `Periodo`/);
    expect(resultados.every((evento) => !evento.resultado.includes("<tools-used-before-summary>"))).toBe(true);
  });

  it("não acusa o orquestrador de usar ferramentas: ele só lançou subagentes", () => {
    expect(doTipo(eventos, "ferramenta_do_orquestrador")).toEqual([]);
    expect(doTipo(eventos, "texto_do_orquestrador").at(-1)?.texto).toContain("Periodo.ts");
  });

  it("traduz o uso da cota da assinatura", () => {
    const [cota] = doTipo(eventos, "uso_da_cota");

    expect(cota?.janelas.map((janela) => janela.nome)).toEqual(["5 horas", "7 dias"]);
    expect(cota?.janelas[0]?.utilizacao).toBe(0.09);
    expect(cota?.janelas[0]?.renovaEm).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("monta o resultado do turno com a resposta e o consumo", () => {
    expect(adaptador.resultado).toMatchObject({
      sucesso: true,
      uso: { subagentesLancados: 2, tokensDeSaida: 1981 },
    });
    expect(adaptador.resultado?.sucesso && adaptador.resultado.resposta).toContain("Reserva.ts");
  });
});

describe("AdaptadorDeEventosDoClaudeCode — turno retomado com permissão negada", () => {
  const { adaptador, eventos } = traduzirFixture("turno2");

  it("aponta que o orquestrador usou uma ferramenta diretamente", () => {
    expect(doTipo(eventos, "ferramenta_do_orquestrador")).toEqual([
      { tipo: "ferramenta_do_orquestrador", ferramenta: "PowerShell", detalhe: "git commit -m teste" },
    ]);
  });

  it("registra a negação de permissão", () => {
    expect(doTipo(eventos, "permissao_negada")).toEqual([
      { tipo: "permissao_negada", ferramenta: "PowerShell", detalhe: "git commit -m teste" },
    ]);
  });

  it("conta só o consumo deste turno, não o acumulado da sessão", () => {
    expect(adaptador.resultado).toMatchObject({ sucesso: true, uso: { tokensDeSaida: 515 } });
  });
});

describe("AdaptadorDeEventosDoClaudeCode — subagente em segundo plano", () => {
  // Sequência observada no teste ponta a ponta: o Orquestrador lança o
  // Subagente em segundo plano, recebe um retorno vazio na hora e é retomado
  // num segundo ciclo (novo `init` e novo `result`) quando o Subagente acaba.
  function traduzirTudo(mensagens: unknown[]): { adaptador: AdaptadorDeEventosDoClaudeCode; eventos: EventoDoMotor[] } {
    const adaptador = new AdaptadorDeEventosDoClaudeCode();
    return { adaptador, eventos: mensagens.flatMap((mensagem) => adaptador.traduzir(mensagem)) };
  }

  const resultado = (tokensDeSaida: number, duracaoMs: number, resposta: string) => ({
    type: "result",
    subtype: "success",
    is_error: false,
    result: resposta,
    duration_ms: duracaoMs,
    subagent_stats: { spawned: 1 },
    model_usage_since_last_result: { "claude-haiku-5-5": { inputTokens: 10, outputTokens: tokensDeSaida } },
  });

  const { adaptador, eventos } = traduzirTudo([
    { type: "system", subtype: "init", session_id: "s" },
    { type: "system", subtype: "task_started", task_id: "t1", tool_use_id: "chamada-1", description: "Ler", prompt: "leia" },
    {
      type: "user",
      parent_tool_use_id: null,
      message: { content: [{ type: "tool_result", tool_use_id: "chamada-1", content: "" }] },
      tool_use_result: { status: "async_launched", agentId: "t1", content: [] },
    },
    resultado(100, 1000, "Aguardando o subagente."),
    { type: "system", subtype: "task_notification", task_id: "t1", status: "completed", summary: "Relatório do subagente", usage: {} },
    { type: "system", subtype: "init", session_id: "s" },
    resultado(50, 500, "Síntese final"),
  ]);

  it("o subagente iniciado leva o tipo; sem tipo no evento, vale o executor", () => {
    expect(doTipo(eventos, "subagente_iniciado")[0]?.papel).toBe("executor");
    const pronto = new AdaptadorDeEventosDoClaudeCode().traduzir({
      type: "system",
      subtype: "task_started",
      task_id: "t2",
      tool_use_id: "chamada-2",
      description: "Contar",
      subagent_type: "contador-de-linhas",
      prompt: "conte",
    });
    expect(pronto).toEqual([
      { tipo: "subagente_iniciado", subagenteId: "t2", descricao: "Contar", tarefa: "conte", papel: "contador-de-linhas" },
    ]);
  });

  it("não toma o retorno imediato do lançamento como resultado", () => {
    expect(doTipo(eventos, "resultado_do_subagente")).toEqual([]);
    expect(doTipo(eventos, "subagente_concluido")[0]?.resumo).toBe("Relatório do subagente");
  });

  it("anuncia a sessão uma vez só", () => {
    expect(doTipo(eventos, "sessao_iniciada")).toHaveLength(1);
  });

  it("fica com a resposta do último ciclo e soma o consumo de todos", () => {
    expect(adaptador.resultado).toEqual({
      sucesso: true,
      resposta: "Síntese final",
      // `subagent_stats` é acumulado no processo: os dois ciclos contam o mesmo subagente.
      uso: { duracaoMs: 1500, tokensDeEntrada: 20, tokensDeSaida: 150, subagentesLancados: 1 },
    });
  });
});

describe("AdaptadorDeEventosDoClaudeCode — workflow do esforço ultracode", () => {
  // Formato observado no Claude Code 2.1.301 com `--effort ultracode`
  // (trechos reais encurtados): o Orquestrador chama o `Workflow` com um
  // script, que roda em segundo plano e conta o progresso pelos `task_*`.
  const SCRIPT =
    "export const meta = {\n  name: 'revisao-adversarial-soma',\n  description: 'Revisão independente de soma.js',\n  phases: [{ title: 'Revisar', detail: '4 revisores' }],\n}\n\nconst REPO = '/private/tmp/orq'\n";
  const CHAMADA = "toolu_015GzNvUS4FF3qwkt83rj7df";

  function traduzirTudo(mensagens: unknown[]): EventoDoMotor[] {
    const adaptador = new AdaptadorDeEventosDoClaudeCode();
    return mensagens.flatMap((mensagem) => adaptador.traduzir(mensagem));
  }

  const eventos = traduzirTudo([
    {
      type: "assistant",
      parent_tool_use_id: null,
      message: { content: [{ type: "tool_use", id: CHAMADA, name: "Workflow", input: { script: SCRIPT } }] },
    },
    {
      type: "system",
      subtype: "background_tasks_changed",
      tasks: [{ task_id: "w5x6v7i6h", task_type: "local_workflow", description: "Revisão independente de soma.js" }],
    },
    {
      type: "system",
      subtype: "task_started",
      task_id: "w5x6v7i6h",
      tool_use_id: CHAMADA,
      description: "Revisão independente de soma.js",
      task_type: "local_workflow",
      workflow_name: "revisao-adversarial-soma",
      prompt: SCRIPT,
    },
    {
      type: "user",
      parent_tool_use_id: null,
      message: { content: [{ type: "tool_result", tool_use_id: CHAMADA, content: "Workflow lançado" }] },
      tool_use_result: { status: "async_launched", taskId: "w5x6v7i6h", taskType: "local_workflow" },
    },
    {
      type: "system",
      subtype: "task_progress",
      task_id: "w5x6v7i6h",
      tool_use_id: CHAMADA,
      description: "Revisar: revisor:fuzz",
      usage: { total_tokens: 0, tool_uses: 0, duration_ms: 84 },
      last_tool_name: "revisor:fuzz",
      workflow_progress: [{ type: "workflow_phase", index: 1, title: "Revisar" }],
    },
    { type: "system", subtype: "task_updated", task_id: "w5x6v7i6h", patch: { status: "completed" } },
    {
      type: "system",
      subtype: "task_notification",
      task_id: "w5x6v7i6h",
      tool_use_id: CHAMADA,
      status: "completed",
      summary: "Revisão concluída",
      usage: { total_tokens: 1200, duration_ms: 90000 },
    },
  ]);

  it("mostra a chamada do Workflow pelo nome do meta, não pelo script", () => {
    expect(doTipo(eventos, "ferramenta_do_orquestrador")).toEqual([
      { tipo: "ferramenta_do_orquestrador", ferramenta: "Workflow", detalhe: "revisao-adversarial-soma" },
    ]);
  });

  it("o workflow aparece como um subagente de papel workflow, com a descrição como tarefa", () => {
    expect(doTipo(eventos, "subagente_iniciado")).toEqual([
      {
        tipo: "subagente_iniciado",
        subagenteId: "w5x6v7i6h",
        descricao: "Workflow: revisao-adversarial-soma",
        tarefa: "Revisão independente de soma.js",
        papel: "workflow",
      },
    ]);
  });

  it("o progresso e o fim seguem o caminho dos subagentes", () => {
    expect(doTipo(eventos, "progresso_do_subagente")).toEqual([
      {
        tipo: "progresso_do_subagente",
        subagenteId: "w5x6v7i6h",
        atividade: "Revisar: revisor:fuzz",
        ultimaFerramenta: "revisor:fuzz",
        tokens: 0,
        ferramentasUsadas: 0,
        duracaoMs: 84,
      },
    ]);
    expect(doTipo(eventos, "subagente_concluido")).toEqual([
      {
        tipo: "subagente_concluido",
        subagenteId: "w5x6v7i6h",
        situacao: "concluido",
        resumo: "Revisão concluída",
        tokens: 1200,
        duracaoMs: 90000,
      },
    ]);
  });

  it("task_updated e background_tasks_changed não viram eventos, e o lançamento não vira resultado", () => {
    expect(eventos.map((evento) => evento.tipo)).toEqual([
      "ferramenta_do_orquestrador",
      "subagente_iniciado",
      "progresso_do_subagente",
      "subagente_concluido",
    ]);
  });

  it("sem meta no script, o Workflow mostra a descrição; sem nada, um rótulo curto", () => {
    expect(nomeDoWorkflow({ script: "await agent('x')", description: "Revisar o PR" })).toBe("Revisar o PR");
    expect(nomeDoWorkflow({ script: "await agent('x')" })).toBe("workflow sem nome");
    expect(nomeDoWorkflow({ script: 'export const meta = { name: "duplas" }' })).toBe("duplas");
  });

  it("um workflow negado mostra o nome, não o script", () => {
    const adaptador = new AdaptadorDeEventosDoClaudeCode();
    const negacoes = adaptador.traduzir({
      type: "result",
      subtype: "success",
      result: "",
      permission_denials: [{ tool_name: "Workflow", tool_use_id: CHAMADA, tool_input: { script: SCRIPT } }],
    });

    expect(negacoes).toEqual([{ tipo: "permissao_negada", ferramenta: "Workflow", detalhe: "revisao-adversarial-soma" }]);
  });
});

describe("AdaptadorDeEventosDoClaudeCode — lista de tarefas (TodoWrite)", () => {
  // Linha no formato real do `stream-json` (Claude Code 2.1), encurtada.
  const LINHA_DO_TODOWRITE =
    '{"type":"assistant","parent_tool_use_id":null,"message":{"content":[{"type":"tool_use","id":"toolu_01RsJjCd16Fbd2VSKcTVBfny","name":"TodoWrite","input":{"todos":[{"content":"Explorar o projeto","status":"completed","activeForm":"Explorando o projeto"},{"content":"Rodar os testes","status":"in_progress","activeForm":"Rodando os testes"},{"content":"Escrever o README","status":"pending","activeForm":"Escrevendo o README"}]}}]}}';

  function chamadaDoTodoWrite(input: unknown, parentToolUseId: string | null = null): unknown {
    return {
      type: "assistant",
      parent_tool_use_id: parentToolUseId,
      message: { content: [{ type: "tool_use", id: "toolu_todo", name: "TodoWrite", input }] },
    };
  }

  it("vira tarefas_atualizadas, com o activeForm na tarefa em andamento, e não uma linha de ferramenta", () => {
    const eventos = new AdaptadorDeEventosDoClaudeCode().traduzir(JSON.parse(LINHA_DO_TODOWRITE));

    expect(eventos).toEqual([
      {
        tipo: "tarefas_atualizadas",
        tarefas: [
          { texto: "Explorar o projeto", situacao: "concluida" },
          { texto: "Rodando os testes", situacao: "em_andamento" },
          { texto: "Escrever o README", situacao: "pendente" },
        ],
      },
    ]);
  });

  it("sem activeForm, a tarefa em andamento usa o content", () => {
    const eventos = new AdaptadorDeEventosDoClaudeCode().traduzir(
      chamadaDoTodoWrite({ todos: [{ content: "Rodar os testes", status: "in_progress" }] }),
    );

    expect(doTipo(eventos, "tarefas_atualizadas")[0]?.tarefas).toEqual([
      { texto: "Rodar os testes", situacao: "em_andamento" },
    ]);
  });

  it("o TodoWrite de um subagente não mexe nas tarefas do orquestrador", () => {
    const eventos = new AdaptadorDeEventosDoClaudeCode().traduzir(
      chamadaDoTodoWrite({ todos: [{ content: "Ler o arquivo", status: "pending", activeForm: "Lendo" }] }, "toolu_pai"),
    );

    expect(doTipo(eventos, "tarefas_atualizadas")).toEqual([]);
  });

  it.each([
    ["lista vazia", { todos: [] }],
    ["sem todos", {}],
    ["todos não é lista", { todos: "a fazer" }],
    ["situação desconhecida", { todos: [{ content: "Rodar", status: "blocked" }] }],
    ["item sem texto", { todos: [{ content: " ", status: "pending" }] }],
    ["item que não é objeto", { todos: ["Rodar os testes"] }],
  ])("malformado (%s) não emite tarefas e segue como ferramenta comum", (_caso, input) => {
    const eventos = new AdaptadorDeEventosDoClaudeCode().traduzir(chamadaDoTodoWrite(input));

    expect(doTipo(eventos, "tarefas_atualizadas")).toEqual([]);
    expect(doTipo(eventos, "ferramenta_do_orquestrador").map((evento) => evento.ferramenta)).toEqual(["TodoWrite"]);
  });
});

describe("AdaptadorDeEventosDoClaudeCode: endereços locais", () => {
  const VITE = "\n  VITE v6.0.0  ready in 300 ms\n\n  ➜  Local:   http://localhost:\x1b[1m5173\x1b[22m/\n";

  it("anuncia o endereço que o Bash do orquestrador imprimiu, mesmo colorido", () => {
    const eventos = new AdaptadorDeEventosDoClaudeCode().traduzir({
      type: "user",
      parent_tool_use_id: null,
      message: { content: [{ type: "tool_result", tool_use_id: "chamada-1", content: VITE }] },
      tool_use_result: { stdout: VITE, stderr: "", interrupted: false },
    });

    expect(eventos).toEqual([{ tipo: "endereco_local_detectado", url: "http://localhost:5173" }]);
  });

  it("anuncia o endereço achado por um subagente, com o retorno em blocos", () => {
    const eventos = new AdaptadorDeEventosDoClaudeCode().traduzir({
      type: "user",
      parent_tool_use_id: "chamada-do-subagente",
      agent_id: "t1",
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: "chamada-2",
            content: [{ type: "text", text: "ready - started server on 0.0.0.0:3000, url: http://0.0.0.0:3000" }],
          },
        ],
      },
    });

    expect(eventos).toEqual([{ tipo: "endereco_local_detectado", url: "http://localhost:3000" }]);
  });

  it("acha o endereço só na saída estruturada, quando o texto não o traz", () => {
    const eventos = new AdaptadorDeEventosDoClaudeCode().traduzir({
      type: "user",
      parent_tool_use_id: null,
      message: { content: [{ type: "tool_result", tool_use_id: "chamada-3", content: "" }] },
      tool_use_result: { stdout: "", stderr: "Listening on http://127.0.0.1:8080" },
    });

    expect(eventos).toEqual([{ tipo: "endereco_local_detectado", url: "http://localhost:8080" }]);
  });

  it("não repete o mesmo endereço no turno", () => {
    const adaptador = new AdaptadorDeEventosDoClaudeCode();
    const retorno = (conteudo: string) => ({
      type: "user",
      parent_tool_use_id: null,
      message: { content: [{ type: "tool_result", tool_use_id: "chamada", content: conteudo }] },
    });

    expect(adaptador.traduzir(retorno(VITE))).toHaveLength(1);
    expect(adaptador.traduzir(retorno("de novo: http://127.0.0.1:5173/"))).toEqual([]);
    expect(adaptador.traduzir(retorno("http://localhost:5173 e http://localhost:4173"))).toEqual([
      { tipo: "endereco_local_detectado", url: "http://localhost:4173" },
    ]);
  });

  it("ignora endereço citado num arquivo lido, mas vê o do comando", () => {
    const adaptador = new AdaptadorDeEventosDoClaudeCode();
    adaptador.traduzir({
      type: "assistant",
      parent_tool_use_id: null,
      message: {
        content: [
          { type: "tool_use", id: "leitura", name: "Read", input: { file_path: "README.md" } },
          { type: "tool_use", id: "comando", name: "Bash", input: { command: "npm run dev" } },
        ],
      },
    });
    const retorno = (chamada: string, conteudo: string) => ({
      type: "user",
      parent_tool_use_id: null,
      message: { content: [{ type: "tool_result", tool_use_id: chamada, content: conteudo }] },
    });

    expect(adaptador.traduzir(retorno("leitura", "Abra http://localhost:3000 no navegador."))).toEqual([]);
    expect(adaptador.traduzir(retorno("comando", VITE))).toEqual([
      { tipo: "endereco_local_detectado", url: "http://localhost:5173" },
    ]);
  });

  it("vê o endereço na leitura da saída de um comando em segundo plano", () => {
    const adaptador = new AdaptadorDeEventosDoClaudeCode();
    adaptador.traduzir({
      type: "assistant",
      parent_tool_use_id: null,
      message: {
        content: [
          {
            type: "tool_use",
            id: "saida",
            name: "Read",
            input: { file_path: "/private/tmp/claude-501/projeto/sessao/tasks/b9ogs3hfd.output" },
          },
        ],
      },
    });

    expect(
      adaptador.traduzir({
        type: "user",
        parent_tool_use_id: null,
        message: { content: [{ type: "tool_result", tool_use_id: "saida", content: VITE }] },
      }),
    ).toEqual([{ tipo: "endereco_local_detectado", url: "http://localhost:5173" }]);
  });

  it("guarda como candidato o endereço citado no comando e na fala, sem anunciar", () => {
    const adaptador = new AdaptadorDeEventosDoClaudeCode();
    const eventos = adaptador.traduzir({
      type: "assistant",
      parent_tool_use_id: null,
      message: {
        content: [
          { type: "text", text: "O servidor está no ar em **http://127.0.0.1:4173/**." },
          { type: "tool_use", id: "abrir", name: "Bash", input: { command: "open http://127.0.0.1:4173/" } },
          { type: "tool_use", id: "ler", name: "Read", input: { file_path: "http://localhost:9999" } },
        ],
      },
    });

    expect(doTipo(eventos, "endereco_local_detectado")).toEqual([]);
    expect(adaptador.retirarCandidatos()).toEqual(["http://localhost:4173"]);
    // Retirados uma vez: não voltam.
    expect(adaptador.retirarCandidatos()).toEqual([]);
  });

  it("acha candidatos na fala e no relatório de um subagente e na resposta final", () => {
    const adaptador = new AdaptadorDeEventosDoClaudeCode();
    adaptador.traduzir({
      type: "assistant",
      parent_tool_use_id: "chamada-do-subagente",
      agent_id: "t1",
      message: {
        content: [
          { type: "text", text: "Subi em http://localhost:3000" },
          { type: "tool_use", id: "c", name: "Bash", input: { command: "curl -s localhost:3001 http://localhost:3002" } },
        ],
      },
    });
    adaptador.traduzir({ type: "result", subtype: "success", is_error: false, result: "Pronto: http://localhost:8080/app" });

    expect(adaptador.retirarCandidatos()).toEqual([
      "http://localhost:3000",
      "http://localhost:3002",
      "http://localhost:8080/app",
    ]);
  });

  it("confirma um candidato uma vez só, e não repete o que a saída de um comando já anunciou", () => {
    const adaptador = new AdaptadorDeEventosDoClaudeCode();
    adaptador.traduzir({
      type: "user",
      parent_tool_use_id: null,
      message: { content: [{ type: "tool_result", tool_use_id: "x", content: VITE }] },
    });
    adaptador.traduzir({
      type: "assistant",
      parent_tool_use_id: null,
      message: { content: [{ type: "text", text: "http://localhost:5173 e http://localhost:4173" }] },
    });

    expect(adaptador.retirarCandidatos()).toEqual(["http://localhost:4173"]);
    expect(adaptador.confirmarEndereco("http://localhost:4173")).toEqual([
      { tipo: "endereco_local_detectado", url: "http://localhost:4173" },
    ]);
    expect(adaptador.confirmarEndereco("http://localhost:4173")).toEqual([]);
  });

  it("não vê endereço nos turnos gravados, que não sobem servidor", () => {
    expect(doTipo(traduzirFixture("turno1").eventos, "endereco_local_detectado")).toEqual([]);
    expect(doTipo(traduzirFixture("turno2").eventos, "endereco_local_detectado")).toEqual([]);
  });
});

describe("AdaptadorDeEventosDoClaudeCode — falhas", () => {
  it("transforma um resultado com erro em falha com o texto do Claude Code", () => {
    const adaptador = new AdaptadorDeEventosDoClaudeCode();
    adaptador.traduzir({ type: "result", subtype: "success", is_error: true, result: "Claude AI usage limit reached" });

    expect(adaptador.resultado).toMatchObject({
      sucesso: false,
      causa: "limite_de_uso",
      motivo: "Limite de uso da assinatura do Claude atingido (Claude AI usage limit reached).",
    });
  });

  it("um erro sem causa conhecida mantém o texto do Claude Code e vira \"outro\"", () => {
    const adaptador = new AdaptadorDeEventosDoClaudeCode();
    adaptador.traduzir({ type: "result", subtype: "success", is_error: true, result: "Prompt is too long" });

    expect(adaptador.resultado).toEqual({ sucesso: false, motivo: "Prompt is too long", uso: expect.anything(), causa: "outro" });
  });

  it("explica o subtipo quando não há texto", () => {
    const adaptador = new AdaptadorDeEventosDoClaudeCode();
    adaptador.traduzir({ type: "result", subtype: "error_max_turns", is_error: true });

    expect(adaptador.resultado).toMatchObject({ sucesso: false, motivo: expect.stringContaining("limite de passos") });
  });

  it("ignora o que não é objeto", () => {
    const adaptador = new AdaptadorDeEventosDoClaudeCode();

    expect(adaptador.traduzir("texto solto")).toEqual([]);
    expect(adaptador.traduzir(null)).toEqual([]);
    expect(adaptador.resultado).toBeNull();
  });
});

/** Falha do turno com o texto final dado, depois das mensagens anteriores. */
function falhaCom(resultado: string, antes: unknown[] = []): unknown {
  const adaptador = new AdaptadorDeEventosDoClaudeCode();
  for (const mensagem of antes) {
    adaptador.traduzir(mensagem);
  }
  adaptador.traduzir({ type: "result", subtype: "success", is_error: true, result: resultado });
  return adaptador.resultado;
}

describe("AdaptadorDeEventosDoClaudeCode — causa da falha", () => {
  it("limite de uso com epoch: libera no instante informado e o motivo não traz o número", () => {
    const resultado = falhaCom("Claude AI usage limit reached|1793221200");

    expect(resultado).toMatchObject({
      sucesso: false,
      causa: "limite_de_uso",
      liberaEm: new Date(1793221200 * 1000).toISOString(),
      motivo: "Limite de uso da assinatura do Claude atingido (Claude AI usage limit reached).",
    });
  });

  it("rate_limit_event recusado: limite de uso com o resetsAt, mesmo que o texto final não diga", () => {
    const recusado = {
      type: "rate_limit_event",
      rate_limit_info: { status: "rejected", resetsAt: 1793412000, rateLimitType: "seven_day" },
    };

    expect(falhaCom("Execution error", [recusado])).toMatchObject({
      causa: "limite_de_uso",
      liberaEm: new Date(1793412000 * 1000).toISOString(),
    });
  });

  it("um rate_limit_event permitido não é pista de nada", () => {
    const permitido = { type: "rate_limit_event", rate_limit_info: { status: "allowed", resetsAt: 1793412000 } };

    expect(falhaCom("Execution error", [permitido])).toMatchObject({ causa: "outro", motivo: "Execution error" });
  });

  it("fixture de limite: evento recusado, mensagem sintética com error rate_limit e result com erro", () => {
    const { adaptador, eventos } = traduzirFixture("limite-de-uso");

    expect(adaptador.resultado).toMatchObject({
      sucesso: false,
      causa: "limite_de_uso",
      liberaEm: new Date(1793221200 * 1000).toISOString(),
      motivo: expect.stringContaining("hit your session limit"),
    });
    // A cota continua indo para a tela.
    expect(doTipo(eventos, "uso_da_cota")[0]?.janelas[0]).toMatchObject({ nome: "5 horas", situacao: "rejected" });
  });

  it.each([
    'API Error: 529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}',
    "API Error: Repeated 529 Overloaded errors",
    'API Error: 500 {"type":"error","error":{"type":"api_error","message":"Internal server error"}}',
    "API Error: 503 Service Unavailable",
    "Request failed with status code 502",
    "Opus is experiencing high load",
  ])("sobrecarga: %s", (texto) => {
    expect(falhaCom(texto)).toMatchObject({ causa: "sobrecarga", motivo: expect.stringMatching(/^Os servidores do Claude/) });
    expect(falhaCom(texto)).not.toHaveProperty("liberaEm");
  });

  it.each([
    "API Error: Connection error.",
    "API Error: Request timed out.",
    "TypeError: fetch failed",
    "Error: read ECONNRESET",
    "getaddrinfo ENOTFOUND api.anthropic.com",
    "getaddrinfo EAI_AGAIN api.anthropic.com",
    "connect ETIMEDOUT 160.79.104.10:443",
    "socket hang up",
    "Unable to connect to API (ConnectionRefused)",
  ])("rede: %s", (texto) => {
    expect(falhaCom(texto)).toMatchObject({ causa: "rede", motivo: expect.stringMatching(/^Falha de conexão/) });
  });

  it.each([
    "You've hit your session limit · resets 3pm (America/Sao_Paulo)",
    "You've hit your org's monthly spend limit",
    "You're out of extra usage",
    "API Error: Request rejected (429) · rate limit",
  ])("limite de uso sem data: %s", (texto) => {
    expect(falhaCom(texto)).toMatchObject({ causa: "limite_de_uso", liberaEm: null });
  });

  it("o tipo de erro de uma mensagem do assistente só decide quando o texto não diz nada", () => {
    const comErro = { type: "assistant", parent_tool_use_id: null, error: "server_error", message: { content: [] } };

    expect(falhaCom("Algo deu errado", [comErro])).toMatchObject({ causa: "sobrecarga" });
    expect(falhaCom("API Error: Connection error.", [comErro])).toMatchObject({ causa: "rede" });
  });

  it("um api_retry com 529 é pista de sobrecarga", () => {
    const novaTentativa = { type: "system", subtype: "api_retry", attempt: 3, error_status: 529, error: "server_error" };

    expect(falhaCom("", [novaTentativa])).toMatchObject({ causa: "sobrecarga" });
  });

  it("classificarFalha aceita epoch em milissegundos e cai em \"outro\" sem sinal nenhum", () => {
    expect(classificarFalha(["Claude AI usage limit reached|1793221200000"])).toEqual({
      causa: "limite_de_uso",
      liberaEm: new Date(1793221200000).toISOString(),
    });
    expect(classificarFalha(["Prompt is too long", ""])).toEqual({ causa: "outro", liberaEm: null });
  });

  it("um número 500 qualquer no texto não é sobrecarga", () => {
    expect(classificarFalha(["Arquivo com 500 linhas não pôde ser lido"]).causa).toBe("outro");
  });
});
