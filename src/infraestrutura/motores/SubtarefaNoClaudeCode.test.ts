import { rmSync } from "node:fs";

import { afterEach, describe, expect, it } from "vitest";

import { EventoDoMotor } from "../../orquestracao/EventoDeOrquestracao";
import { FachadaClaudeCodeCli, ExecucaoDoClaudeCode } from "../claudecode/FachadaClaudeCodeCli";
import { configuracaoDeTeste, criarPastasDeTeste, pedidoDeTeste, PastasDeTeste } from "./fixtures/pedidoDeTeste";
import { argumentosDaSubtarefa, SubtarefaNoClaudeCode } from "./SubtarefaNoClaudeCode";

/** O que o `claude -p` escreve, em stream-json, numa subtarefa que leu um arquivo e respondeu. */
const MENSAGENS_DO_CLAUDE: unknown[] = [
  { type: "system", subtype: "init", session_id: "s" },
  {
    type: "assistant",
    message: { content: [{ type: "text", text: "Vou ler." }, { type: "tool_use", id: "t1", name: "Read", input: { file_path: "a.ts" } }] },
    parent_tool_use_id: null,
  },
  { type: "assistant", message: { content: [{ type: "text", text: "Li o arquivo." }] }, parent_tool_use_id: null },
  {
    type: "result",
    subtype: "success",
    is_error: false,
    result: "Li o arquivo.",
    duration_ms: 10,
    modelUsage: { "claude-sonnet": { inputTokens: 100, outputTokens: 20, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 } },
  },
];

describe("SubtarefaNoClaudeCode", () => {
  let pastas: PastasDeTeste;
  afterEach(() => rmSync(pastas.raiz, { recursive: true, force: true }));

  function fachadaFalsa(mensagens: unknown[], aoExecutar: (execucao: ExecucaoDoClaudeCode) => void = () => undefined): FachadaClaudeCodeCli {
    return {
      executar: async (execucao: ExecucaoDoClaudeCode, aoReceber: (mensagem: unknown) => void) => {
        aoExecutar(execucao);
        for (const mensagem of mensagens) aoReceber(mensagem);
        return { codigoDeSaida: 0, erroPadrao: "" };
      },
    } as unknown as FachadaClaudeCodeCli;
  }

  function pedido(parcial: Parameters<typeof configuracaoDeTeste>[0] = {}) {
    pastas = criarPastasDeTeste();
    return pedidoDeTeste(pastas, "codex", {
      configuracao: configuracaoDeTeste({ motorDoOrquestrador: "codex", motorDosSubagentes: "claude-code", ...parcial }),
    });
  }

  it("roda o claude -p como agente único e devolve o relatório, o uso e os eventos de subagente", async () => {
    const eventos: EventoDoMotor[] = [];
    let execucaoDoClaude: ExecucaoDoClaudeCode | undefined;
    const executor = new SubtarefaNoClaudeCode(fachadaFalsa(MENSAGENS_DO_CLAUDE, (execucao) => (execucaoDoClaude = execucao)), "windows");

    const resultado = await executor.executarSubtarefa({
      pedido: pedido(),
      subtarefa: { descricao: "Ler a.ts", prompt: "leia a.ts", subagente: null },
      especialidade: null,
      subagenteId: "sub-1",
      aoProgredir: (evento) => eventos.push(evento),
      sinal: new AbortController().signal,
    });

    expect(resultado).toMatchObject({ situacao: "concluido", relatorio: "Li o arquivo.", tokensDeEntrada: 100, tokensDeSaida: 20 });
    expect(eventos).toContainEqual({ tipo: "texto_do_subagente", subagenteId: "sub-1", texto: "Li o arquivo." });
    expect(eventos).toContainEqual(expect.objectContaining({ tipo: "progresso_do_subagente", subagenteId: "sub-1", ultimaFerramenta: "Read", atividade: "a.ts" }));
    expect(execucaoDoClaude?.pasta).toBe(pastas.trabalho);
    expect(execucaoDoClaude?.entrada).toContain("Subtarefa: Ler a.ts");
    expect(execucaoDoClaude?.dono.sessaoId).toBe("sub-1");
  });

  it("devolve a falha do Claude Code como relatório, com a causa classificada", async () => {
    const limite = [{ type: "result", subtype: "error_during_execution", is_error: true, result: "Claude AI usage limit reached|1794936160" }];
    const executor = new SubtarefaNoClaudeCode(fachadaFalsa(limite));

    const resultado = await executor.executarSubtarefa({
      pedido: pedido(),
      subtarefa: { descricao: "A", prompt: "a", subagente: null },
      especialidade: null,
      subagenteId: "sub-2",
      aoProgredir: () => undefined,
      sinal: new AbortController().signal,
    });

    expect(resultado.situacao).toBe("falhou");
    expect(resultado.relatorio).toContain("Limite de uso");
  });

  it("não inicia processo com o sinal já abortado", async () => {
    const controle = new AbortController();
    controle.abort();
    let rodou = false;
    const executor = new SubtarefaNoClaudeCode(fachadaFalsa(MENSAGENS_DO_CLAUDE, () => (rodou = true)));

    const resultado = await executor.executarSubtarefa({
      pedido: pedido(),
      subtarefa: { descricao: "A", prompt: "a", subagente: null },
      especialidade: null,
      subagenteId: "sub-3",
      aoProgredir: () => undefined,
      sinal: controle.signal,
    });

    expect(resultado.situacao).toBe("cancelado");
    expect(rodou).toBe(false);
  });

  describe("argumentosDaSubtarefa", () => {
    const arquivos = { instrucoes: "/tmp/instrucoes.txt", configuracoes: "/tmp/configuracoes.json" };

    function argumentos(parcial: Parameters<typeof configuracaoDeTeste>[0] = {}, modo: "execucao" | "planejamento" = "execucao"): string[] {
      const base = pedido(parcial);
      return argumentosDaSubtarefa({ ...base, modo }, { especialidade: null }, arquivos, "uuid-novo");
    }

    const depois = (lista: string[], flag: string): string[] => {
      const inicio = lista.indexOf(flag);
      const fim = lista.findIndex((item, indice) => indice > inicio && item.startsWith("--"));
      return lista.slice(inicio + 1, fim === -1 ? undefined : fim);
    };

    it("usa uma sessão nova, as regras do subagente e o modelo dos subagentes, sem a ferramenta Agent", () => {
      const lista = argumentos({ modeloDosSubagentes: "haiku" });

      expect(lista).toContain("-p");
      expect(depois(lista, "--session-id")).toEqual(["uuid-novo"]);
      expect(lista).not.toContain("--resume");
      expect(depois(lista, "--append-system-prompt-file")).toEqual(["/tmp/instrucoes.txt"]);
      expect(depois(lista, "--model")).toEqual(["haiku"]);
      expect(depois(lista, "--tools")).not.toContain("Agent");
      expect(lista).not.toContain("--agents");
      expect(depois(lista, "--permission-mode")).toEqual(["dontAsk"]);
    });

    it("dá as ferramentas do nível do pedido, e só leitura (mais artefatos) no planejamento", () => {
      expect(depois(argumentos({ nivelDePermissao: "edicao_e_comandos" }), "--tools")).toEqual(expect.arrayContaining(["Edit", "Write", "PowerShell", "Bash"]));
      const leitura = depois(argumentos({ nivelDePermissao: "edicao_e_comandos" }, "planejamento"), "--tools");
      expect(leitura).toEqual(expect.arrayContaining(["Read", "Grep", "Edit", "Write"]));
      expect(leitura).not.toContain("PowerShell");
      // No nível leitura, Edit e Write só valem na pasta de artefatos.
      const liberadas = depois(argumentos({ nivelDePermissao: "leitura" }), "--allowedTools");
      expect(liberadas).not.toContain("Edit");
      expect(liberadas.some((regra) => regra.startsWith("Edit(") && regra.includes("artefatos"))).toBe(true);
    });

    it("nega commit e push sem a opção ligada, e só o push forçado com ela", () => {
      expect(depois(argumentos({ permitirCommitEPush: false }), "--disallowedTools")).toContain("PowerShell(git commit:*)");
      const liberado = depois(argumentos({ permitirCommitEPush: true }), "--disallowedTools");
      expect(liberado).not.toContain("PowerShell(git commit:*)");
      expect(liberado.some((regra) => regra.includes("--force"))).toBe(true);
    });
  });
});
