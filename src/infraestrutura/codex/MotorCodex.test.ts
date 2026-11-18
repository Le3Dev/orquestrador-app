import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EventoDoMotor } from "../../orquestracao/EventoDeOrquestracao";
import { ABORTO_POR_SILENCIO, PedidoDeTurno, ResultadoDoTurno } from "../../orquestracao/MotorDeAgentes";
import { PonteParaOServidorMcp } from "../motores/ApoioDosMotores";
import { configuracaoDeTeste, criarPastasDeTeste, pedidoDeTeste, PastasDeTeste } from "../motores/fixtures/pedidoDeTeste";
import { MotorCodex } from "./MotorCodex";

const APP_SERVER_FALSO = path.join(__dirname, "fixtures", "appServerFalso.cjs");

interface LinhaDoLog {
  tipo: string;
  method?: string;
  params?: Record<string, unknown>;
  argv?: string[];
  tokenMcp?: string | null;
  chaveDoApp?: string | null;
  pedido?: string;
  comando?: string;
  caminho?: string;
  resposta?: { decision?: unknown };
}

describe("MotorCodex com um app-server falso", () => {
  let pastas: PastasDeTeste;
  let arquivoDeLog: string;
  const ambienteOriginal = { ...process.env };

  beforeEach(() => {
    pastas = criarPastasDeTeste();
    arquivoDeLog = path.join(pastas.raiz, "app-server.log");
    process.env["FALSO_LOG"] = arquivoDeLog;
  });

  afterEach(() => {
    rmSync(pastas.raiz, { recursive: true, force: true });
    for (const chave of ["FALSO_LOG", "FALSO_SEM_LOGIN", "ORQUESTRADOR_CHAVE_DE_ACESSO"]) {
      if (ambienteOriginal[chave] === undefined) delete process.env[chave];
      else process.env[chave] = ambienteOriginal[chave];
    }
  });

  function criarMotor(opcoes: { servidorMcp?: PonteParaOServidorMcp; sondar?: (url: string) => Promise<boolean> } = {}): MotorCodex {
    return new MotorCodex({
      executavel: process.execPath,
      argumentosIniciais: [APP_SERVER_FALSO],
      sondar: opcoes.sondar ?? (async () => false),
      plataforma: "windows",
      ...(opcoes.servidorMcp === undefined ? {} : { servidorMcp: opcoes.servidorMcp }),
    });
  }

  function lerLog(): LinhaDoLog[] {
    return existsSync(arquivoDeLog)
      ? readFileSync(arquivoDeLog, "utf8")
          .split("\n")
          .filter((linha) => linha.trim() !== "")
          .map((linha) => JSON.parse(linha) as LinhaDoLog)
      : [];
  }

  const recebidos = (metodo: string): LinhaDoLog[] => lerLog().filter((linha) => linha.tipo === "recebido" && linha.method === metodo);

  const decisaoDe = (pedido: "comando" | "arquivo"): unknown =>
    lerLog().find((linha) => linha.tipo === "aprovacao" && linha.pedido === pedido)?.resposta?.decision;

  async function executar(
    pedido: PedidoDeTurno,
    motor: MotorCodex = criarMotor(),
    sinal: AbortSignal = new AbortController().signal,
  ): Promise<{ resultado: ResultadoDoTurno; eventos: EventoDoMotor[] }> {
    const eventos: EventoDoMotor[] = [];
    const resultado = await motor.executarTurno(pedido, (evento) => eventos.push(evento), sinal);
    return { resultado, eventos };
  }

  const pedidoCom = (texto: string, sobrepor: Partial<PedidoDeTurno> = {}): PedidoDeTurno =>
    pedidoDeTeste(pastas, "codex", { texto, ...sobrepor });

  describe("thread e turno", () => {
    it("abre uma thread nova, devolve o id e traduz mensagens e uso para os eventos do domínio", async () => {
      const { resultado, eventos } = await executar(pedidoCom("Faça o trabalho."));

      expect(resultado.sucesso).toBe(true);
      if (!resultado.sucesso) return;
      expect(resultado.sessaoDoMotor).toMatch(/^thread-falsa-/);
      expect(resultado.resposta).toBe("Feito.");
      // Dois `thread/tokenUsage/updated` (duas chamadas ao modelo): o uso do turno é a soma.
      expect(resultado.uso).toMatchObject({ tokensDeEntrada: 100, tokensDeSaida: 20 });
      expect(eventos[0]).toEqual({ tipo: "sessao_iniciada", sessaoDoMotor: resultado.sessaoDoMotor });
      expect(eventos).toContainEqual({ tipo: "texto_do_orquestrador", texto: "Vou trabalhar." });
      expect(eventos).toContainEqual({ tipo: "texto_do_orquestrador", texto: "Feito." });
      expect(eventos.some((evento) => evento.tipo === "sinal_de_vida")).toBe(true);
      expect(recebidos("initialize")).toHaveLength(1);
      expect(recebidos("initialized")).toHaveLength(1);
      expect(recebidos("thread/resume")).toHaveLength(0);
    });

    it("usa as regras do Orquestrador como instruções de desenvolvedor e a mensagem do turno como entrada", async () => {
      await executar(pedidoCom("Corrija o bug.", { contextoDaTroca: "O motor anterior criou a.ts." }));

      const inicio = recebidos("thread/start")[0]?.params as { developerInstructions: string; cwd: string; approvalPolicy: string };
      expect(inicio.developerInstructions).toContain("Você é o ORQUESTRADOR desta conversa.");
      expect(inicio.developerInstructions).toContain("delegar_subtarefas");
      expect(inicio.cwd).toBe(pastas.trabalho);
      expect(inicio.approvalPolicy).toBe("untrusted");
      const entrada = (recebidos("turn/start")[0]?.params as { input: Array<{ text: string }> }).input[0]?.text ?? "";
      expect(entrada).toContain("<configuracao-do-pedido>");
      expect(entrada).toContain("<contexto-da-troca>");
      expect(entrada.endsWith("Corrija o bug.")).toBe(true);
      expect(entrada).not.toContain("Você é o ORQUESTRADOR desta conversa.");
    });

    it("retoma a thread com thread/resume, sem trazer o histórico de volta", async () => {
      const { resultado } = await executar(pedidoCom("Segundo.", { sessaoIniciada: true, sessaoId: "thread-anterior" }));

      expect(resultado.sucesso).toBe(true);
      expect(resultado.sessaoDoMotor).toBe("thread-anterior");
      expect(recebidos("thread/resume")[0]?.params).toMatchObject({ threadId: "thread-anterior", excludeTurns: true });
      expect(recebidos("thread/start")).toHaveLength(0);
      expect(recebidos("turn/start")[0]?.params).toMatchObject({ threadId: "thread-anterior" });
    });

    it("abre uma thread nova e avisa o agente quando a anterior não existe mais", async () => {
      const { resultado } = await executar(pedidoCom("Oi.", { sessaoIniciada: true, sessaoId: "thread-perdida" }));

      expect(resultado.sucesso).toBe(true);
      expect(resultado.sessaoDoMotor).toMatch(/^thread-falsa-/);
      const entrada = (recebidos("turn/start")[0]?.params as { input: Array<{ text: string }> }).input[0]?.text ?? "";
      expect(entrada).toContain("não pôde ser retomada");
    });

    it("manda o modelo só quando não é o padrão do CLI", async () => {
      await executar(pedidoCom("Oi."));
      expect(recebidos("thread/start")[0]?.params).not.toHaveProperty("model");

      rmSync(arquivoDeLog);
      await executar(pedidoCom("Oi.", { configuracao: configuracaoDeTeste({ motorDoOrquestrador: "codex", motorDosSubagentes: "codex", modeloDoOrquestrador: "gpt-5.5" }) }));
      expect(recebidos("thread/start")[0]?.params).toMatchObject({ model: "gpt-5.5" });
      expect(recebidos("turn/start")[0]?.params).toMatchObject({ model: "gpt-5.5" });
    });

    it("recusa um pedido de outro motor sem iniciar processo nenhum", async () => {
      const { resultado } = await executar(pedidoDeTeste(pastas, "copilot"));

      expect(resultado.sucesso).toBe(false);
      expect(existsSync(arquivoDeLog)).toBe(false);
    });

    it("não passa ao Codex a chave de acesso do app", async () => {
      process.env["ORQUESTRADOR_CHAVE_DE_ACESSO"] = "a".repeat(64);

      await executar(pedidoCom("Oi."));

      expect(lerLog().find((linha) => linha.tipo === "argv")?.chaveDoApp).toBeNull();
    });
  });

  describe("sandbox e aprovações", () => {
    it("deixa o sandbox read-only no nível leitura e no planejamento", async () => {
      await executar(pedidoCom("Oi.", { configuracao: configuracaoDeTeste({ motorDoOrquestrador: "codex", motorDosSubagentes: "codex", nivelDePermissao: "leitura" }) }));
      expect(recebidos("thread/start")[0]?.params).toMatchObject({ sandbox: "read-only" });
      expect(recebidos("turn/start")[0]?.params).toMatchObject({ sandboxPolicy: { type: "readOnly" } });

      rmSync(arquivoDeLog);
      await executar(pedidoCom("Oi.", { modo: "planejamento" }));
      expect(recebidos("turn/start")[0]?.params).toMatchObject({ sandboxPolicy: { type: "readOnly" } });
    });

    it("usa workspace-write com a pasta de artefatos gravável, e rede só com comandos liberados", async () => {
      const edicao = configuracaoDeTeste({ motorDoOrquestrador: "codex", motorDosSubagentes: "codex", nivelDePermissao: "edicao" });
      await executar(pedidoCom("Oi.", { configuracao: edicao }));
      expect(recebidos("turn/start")[0]?.params).toMatchObject({
        sandboxPolicy: { type: "workspaceWrite", writableRoots: [expect.stringContaining("artefatos")], networkAccess: false },
      });

      rmSync(arquivoDeLog);
      await executar(pedidoCom("Oi."));
      expect(recebidos("thread/start")[0]?.params).toMatchObject({ sandbox: "workspace-write" });
      expect(recebidos("turn/start")[0]?.params).toMatchObject({ sandboxPolicy: { type: "workspaceWrite", networkAccess: true } });
    });

    it("no nível leitura recusa comandos e alterações no projeto e libera gravar na pasta de artefatos", async () => {
      const configuracao = configuracaoDeTeste({ motorDoOrquestrador: "codex", motorDosSubagentes: "codex", nivelDePermissao: "leitura" });

      const comando = await executar(pedidoCom("[[COMANDO=npm test]]", { configuracao }));
      expect(decisaoDe("comando")).toBe("decline");
      expect(comando.eventos).toContainEqual({ tipo: "permissao_negada", ferramenta: "PowerShell", detalhe: "npm test" });

      rmSync(arquivoDeLog);
      const noProjeto = path.join(pastas.trabalho, "x.ts");
      const arquivo = await executar(pedidoCom(`[[ARQUIVO=${noProjeto}]]`, { configuracao }));
      expect(decisaoDe("arquivo")).toBe("decline");
      expect(arquivo.eventos).toContainEqual({ tipo: "permissao_negada", ferramenta: "Edit", detalhe: noProjeto });

      rmSync(arquivoDeLog);
      await executar(pedidoCom(`[[ARQUIVO=${path.join(pastas.artefatos, "relatorio.html")}]]`, { configuracao }));
      expect(decisaoDe("arquivo")).toBe("accept");
    });

    it("no nível edicao libera editar o projeto e recusa comandos; no planejamento só lê", async () => {
      const edicao = configuracaoDeTeste({ motorDoOrquestrador: "codex", motorDosSubagentes: "codex", nivelDePermissao: "edicao" });
      await executar(pedidoCom(`[[ARQUIVO=${path.join(pastas.trabalho, "a.ts")}]] [[COMANDO=ls]]`, { configuracao: edicao }));
      expect(decisaoDe("arquivo")).toBe("accept");
      expect(decisaoDe("comando")).toBe("decline");

      rmSync(arquivoDeLog);
      await executar(pedidoCom(`[[ARQUIVO=${path.join(pastas.trabalho, "a.ts")}]] [[COMANDO=ls]]`, { modo: "planejamento" }));
      expect(decisaoDe("arquivo")).toBe("decline");
      expect(decisaoDe("comando")).toBe("decline");
    });

    it("recusa git commit e push quando não estão liberados, e push forçado sempre", async () => {
      await executar(pedidoCom("[[COMANDO=git commit -am x]]"));
      expect(decisaoDe("comando")).toBe("decline");

      rmSync(arquivoDeLog);
      const comCommit = configuracaoDeTeste({ motorDoOrquestrador: "codex", motorDosSubagentes: "codex", permitirCommitEPush: true });
      await executar(pedidoCom("[[COMANDO=git commit -am x]]", { configuracao: comCommit }));
      expect(decisaoDe("comando")).toBe("accept");

      rmSync(arquivoDeLog);
      await executar(pedidoCom("[[COMANDO=git push -fu origin main]]", { configuracao: comCommit }));
      expect(decisaoDe("comando")).toBe("decline");
    });
  });

  describe("eventos", () => {
    it("mostra comandos e alterações como ferramentas, anuncia o servidor que o comando subiu e traduz o plano", async () => {
      const sondar = vi.fn(async () => true);

      const { eventos } = await executar(pedidoCom(`[[PLANO]] [[COMANDO=npm run dev]] [[ARQUIVO=${path.join(pastas.trabalho, "a.ts")}]]`), criarMotor({ sondar }));

      expect(eventos).toContainEqual({ tipo: "ferramenta_do_orquestrador", ferramenta: "PowerShell", detalhe: "npm run dev" });
      expect(eventos).toContainEqual({ tipo: "ferramenta_do_orquestrador", ferramenta: "Edit", detalhe: path.join(pastas.trabalho, "a.ts") });
      expect(eventos).toContainEqual({ tipo: "endereco_local_detectado", url: "http://localhost:5173", origem: "ferramenta" });
      expect(eventos).toContainEqual({
        tipo: "tarefas_atualizadas",
        tarefas: [
          { texto: "Ler o projeto", situacao: "concluida" },
          { texto: "Escrever o código", situacao: "em_andamento" },
          { texto: "Rodar os testes", situacao: "pendente" },
        ],
      });
    });

    it("não mostra a chamada da ferramenta de delegação do app como ferramenta do Orquestrador", async () => {
      const { eventos } = await executar(pedidoCom("[[MCP]]"));

      expect(eventos.some((evento) => evento.tipo === "ferramenta_do_orquestrador")).toBe(false);
    });
  });

  describe("ferramentas do app (MCP)", () => {
    it("configura o servidor MCP do turno na thread, com o token numa variável de ambiente e tempo de sobra", async () => {
      const encerrar = vi.fn();
      const registrarTurno = vi.fn(() => ({ url: "http://127.0.0.1:9999/mcp", token: "tok-xyz", encerrar }));

      await executar(pedidoCom("Oi."), criarMotor({ servidorMcp: { registrarTurno } }));

      expect(registrarTurno).toHaveBeenCalledWith({ orquestradorId: "orq-1", ferramentas: { delegar_subtarefas: true } });
      expect(recebidos("thread/start")[0]?.params).toMatchObject({
        config: {
          mcp_servers: {
            orquestrador: {
              url: "http://127.0.0.1:9999/mcp",
              bearer_token_env_var: "ORQUESTRADOR_MCP_TOKEN_DO_TURNO",
              default_tools_approval_mode: "approve",
              tool_timeout_sec: 3600,
            },
          },
        },
      });
      expect(lerLog().find((linha) => linha.tipo === "argv")?.tokenMcp).toBe("tok-xyz");
      expect(JSON.stringify(lerLog())).not.toContain('"argv":["' + "tok-xyz");
      expect(encerrar).toHaveBeenCalledTimes(1);
    });

    it("não configura MCP quando nenhum grupo está ligado", async () => {
      const registrarTurno = vi.fn();
      const configuracao = configuracaoDeTeste({ motorDoOrquestrador: "claude-code", motorDosSubagentes: "claude-code", modeloDoOrquestrador: "opus", modeloDosSubagentes: "sonnet" });

      await executar(pedidoCom("Oi.", { configuracao, motor: "codex" }), criarMotor({ servidorMcp: { registrarTurno } }));

      expect(registrarTurno).not.toHaveBeenCalled();
      expect(recebidos("thread/start")[0]?.params).not.toHaveProperty("config");
    });
  });

  describe("falhas", () => {
    it("classifica o limite de uso pelo codexErrorInfo, com o horário de reposição da janela", async () => {
      const antes = Date.now();

      const { resultado, eventos } = await executar(pedidoCom("[[LIMITE]]"));

      expect(resultado.sucesso).toBe(false);
      if (resultado.sucesso) return;
      expect(resultado.causa).toBe("limite_de_uso");
      expect(resultado.motivo).toContain("Limite de uso do Codex atingido");
      expect(Date.parse(resultado.liberaEm ?? "")).toBeGreaterThan(antes + 3_000_000);
      expect(resultado.sessaoDoMotor).toMatch(/^thread-falsa-/);
      expect(eventos).toContainEqual({
        tipo: "uso_da_cota",
        janelas: [
          { nome: "5 horas", utilizacao: 1, renovaEm: expect.any(String), situacao: "rejected" },
          { nome: "7 dias", utilizacao: 0.4, renovaEm: expect.any(String), situacao: "rejected" },
        ],
      });
    });

    it("classifica a sobrecarga", async () => {
      const { resultado } = await executar(pedidoCom("[[SOBRECARGA]]"));

      expect(resultado).toMatchObject({ sucesso: false, causa: "sobrecarga" });
    });

    it("para na hora e explica quando o Codex não está logado, sem esperar as novas tentativas dele", async () => {
      const inicio = Date.now();

      const { resultado } = await executar(pedidoCom("[[LOGIN]]"));

      expect(resultado).toMatchObject({ sucesso: false, causa: "outro" });
      expect(resultado.sucesso === false && resultado.motivo).toContain('Rode "codex login"');
      expect(recebidos("turn/interrupt")).toHaveLength(1);
      expect(Date.now() - inicio).toBeLessThan(5_000);
    });

    it("conta o que o stderr disse quando o processo morre no meio do turno", async () => {
      const { resultado } = await executar(pedidoCom("[[MORRER]]"));

      expect(resultado.sucesso).toBe(false);
      expect(resultado.sucesso === false && resultado.motivo).toContain("falha fatal do app-server falso");
    });

    it("explica que o Codex não foi encontrado quando o executável não existe", async () => {
      const motor = new MotorCodex({ executavel: path.join(pastas.raiz, "nao-existe.exe"), plataforma: "windows" });

      const { resultado } = await executar(pedidoCom("Oi."), motor);

      expect(resultado.sucesso).toBe(false);
      expect(resultado.sucesso === false && resultado.motivo).toContain("não foi encontrado nesta máquina");
      expect(resultado.sucesso === false && resultado.motivo).toContain("npm install -g @openai/codex");
    });
  });

  describe("cancelamento", () => {
    async function esperarPeloTurno(): Promise<void> {
      for (let tentativa = 0; tentativa < 200 && recebidos("turn/start").length === 0; tentativa++) {
        await new Promise((resolver) => setTimeout(resolver, 25));
      }
    }

    it("interrompe o turno (turn/interrupt) e devolve o turno cancelado", async () => {
      const controle = new AbortController();
      const execucao = executar(pedidoCom("[[DEMORAR]]"), criarMotor(), controle.signal);
      await esperarPeloTurno();

      controle.abort();
      const { resultado } = await execucao;

      expect(resultado).toMatchObject({ sucesso: false, motivo: "Turno cancelado." });
      expect(recebidos("turn/interrupt")).toHaveLength(1);
    });

    it("com a autorrecuperação (silêncio), derruba o processo e devolve a causa 'silencio'", async () => {
      const controle = new AbortController();
      const execucao = executar(pedidoCom("[[DEMORAR]]"), criarMotor(), controle.signal);
      await esperarPeloTurno();

      controle.abort(ABORTO_POR_SILENCIO);
      const { resultado } = await execucao;

      expect(resultado).toMatchObject({ sucesso: false, causa: "silencio" });
      expect(recebidos("turn/interrupt")).toHaveLength(0);
    });
  });

  describe("subtarefas", () => {
    it("roda a subtarefa numa thread efêmera, com as regras do subagente, e converte os eventos", async () => {
      const eventos: EventoDoMotor[] = [];

      const resultado = await criarMotor().executarSubtarefa({
        pedido: pedidoCom("Pedido."),
        subtarefa: { descricao: "Rodar", prompt: "[[COMANDO=ls]]", subagente: null },
        especialidade: null,
        subagenteId: "sub-1",
        aoProgredir: (evento) => eventos.push(evento),
        sinal: new AbortController().signal,
      });

      expect(resultado).toMatchObject({ situacao: "concluido", relatorio: "Feito.", tokensDeEntrada: 100, tokensDeSaida: 20 });
      expect(eventos).toContainEqual({ tipo: "texto_do_subagente", subagenteId: "sub-1", texto: "Feito." });
      expect(eventos).toContainEqual(
        expect.objectContaining({ tipo: "progresso_do_subagente", subagenteId: "sub-1", ultimaFerramenta: "PowerShell", atividade: "ls" }),
      );
      expect(eventos.some((evento) => evento.tipo === "sessao_iniciada")).toBe(false);
      const inicio = recebidos("thread/start")[0]?.params as { ephemeral: boolean; developerInstructions: string };
      expect(inicio.ephemeral).toBe(true);
      expect(inicio.developerInstructions).toContain("Você é um subagente executor");
      expect(inicio.developerInstructions).not.toContain("ORQUESTRADOR");
      expect(recebidos("thread/start")[0]?.params).not.toHaveProperty("config");
    });

    it("aplica as permissões do pedido à subtarefa", async () => {
      await criarMotor().executarSubtarefa({
        pedido: pedidoCom("Pedido.", { configuracao: configuracaoDeTeste({ motorDoOrquestrador: "codex", motorDosSubagentes: "codex", nivelDePermissao: "leitura" }) }),
        subtarefa: { descricao: "Rodar", prompt: "[[COMANDO=npm test]]", subagente: null },
        especialidade: null,
        subagenteId: "sub-2",
        aoProgredir: () => undefined,
        sinal: new AbortController().signal,
      });

      expect(decisaoDe("comando")).toBe("decline");
    });
  });
});
