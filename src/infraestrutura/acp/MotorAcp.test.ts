import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EventoDoMotor } from "../../orquestracao/EventoDeOrquestracao";
import { ABORTO_POR_SILENCIO, PedidoDeTurno, ResultadoDoTurno } from "../../orquestracao/MotorDeAgentes";
import { PonteParaOServidorMcp } from "../motores/ApoioDosMotores";
import { criarPastasDeTeste, configuracaoDeTeste, pedidoDeTeste, PastasDeTeste } from "../motores/fixtures/pedidoDeTeste";
import { MotorAcp } from "./MotorAcp";
import { PerfilAcp } from "./PerfilAcp";
import { criarPerfilDoCopilot } from "./PerfilDoCopilot";
import { criarPerfilDoGemini } from "./PerfilDoGemini";

const AGENTE_FALSO = path.join(__dirname, "fixtures", "agenteAcpFalso.cjs");

interface LinhaDoLog {
  tipo: string;
  method?: string;
  params?: Record<string, unknown>;
  argv?: string[];
  ambiente?: Record<string, unknown>;
  chamada?: string;
  resposta?: { outcome?: { outcome?: string; optionId?: string } };
}

describe("MotorAcp com um agente ACP falso", () => {
  let pastas: PastasDeTeste;
  let arquivoDeLog: string;
  let ambienteDoAgente: Record<string, string>;

  beforeEach(() => {
    pastas = criarPastasDeTeste();
    arquivoDeLog = path.join(pastas.raiz, "agente.log");
    ambienteDoAgente = {};
  });

  afterEach(() => {
    rmSync(pastas.raiz, { recursive: true, force: true });
    delete process.env["COPILOT_ALLOW_ALL"];
  });

  function perfilFalso(): PerfilAcp {
    const copilot = criarPerfilDoCopilot("copilot");
    return {
      ...copilot,
      comando: () => ({ executavel: process.execPath, argumentosIniciais: [AGENTE_FALSO] }),
      ambiente: (base) => ({ ...copilot.ambiente(base), FALSO_LOG: arquivoDeLog, ...ambienteDoAgente }),
    };
  }

  function criarMotor(opcoes: { servidorMcp?: PonteParaOServidorMcp; sondar?: (url: string) => Promise<boolean> } = {}): MotorAcp {
    return new MotorAcp({
      perfil: perfilFalso(),
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

  function recebidos(metodo: string): LinhaDoLog[] {
    return lerLog().filter((linha) => linha.tipo === "recebido" && linha.method === metodo);
  }

  function textoDoPrompt(): string {
    const parametros = recebidos("session/prompt")[0]?.params as { prompt: Array<{ text?: string }> } | undefined;
    return parametros?.prompt.map((parte) => parte.text ?? "").join("\n") ?? "";
  }

  async function executar(
    pedido: PedidoDeTurno,
    motor: MotorAcp = criarMotor(),
    sinal: AbortSignal = new AbortController().signal,
  ): Promise<{ resultado: ResultadoDoTurno; eventos: EventoDoMotor[] }> {
    const eventos: EventoDoMotor[] = [];
    const resultado = await motor.executarTurno(pedido, (evento) => eventos.push(evento), sinal);
    return { resultado, eventos };
  }

  const pedidoCom = (texto: string, sobrepor: Partial<PedidoDeTurno> = {}): PedidoDeTurno =>
    pedidoDeTeste(pastas, "copilot", { texto, ...sobrepor });

  describe("sessão e prompt", () => {
    it("abre uma sessão nova, devolve o id e traduz as falas e o uso para os eventos do domínio", async () => {
      const { resultado, eventos } = await executar(pedidoCom("Faça o trabalho."));

      expect(resultado.sucesso).toBe(true);
      if (!resultado.sucesso) return;
      expect(resultado.sessaoDoMotor).toMatch(/^sessao-falsa-/);
      expect(resultado.resposta).toBe("Vou trabalhar. Pronto.");
      expect(resultado.uso).toMatchObject({ tokensDeEntrada: 100, tokensDeSaida: 20, subagentesLancados: 0 });
      expect(eventos[0]).toEqual({ tipo: "sessao_iniciada", sessaoDoMotor: resultado.sessaoDoMotor });
      expect(eventos).toContainEqual({ tipo: "texto_do_orquestrador", texto: "Vou trabalhar. Pronto." });
      expect(eventos.some((evento) => evento.tipo === "sinal_de_vida")).toBe(true);
      expect(recebidos("session/new")).toHaveLength(1);
      expect(recebidos("session/load")).toHaveLength(0);
      expect(recebidos("session/new")[0]?.params).toMatchObject({ cwd: pastas.trabalho, mcpServers: [] });
    });

    it("põe as regras do Orquestrador, o bloco de configuração e o pedido no prompt, porque o ACP não tem prompt de sistema", async () => {
      await executar(pedidoCom("Corrija o bug do login."));

      const prompt = textoDoPrompt();
      expect(prompt).toContain("<regras-do-orquestrador>");
      expect(prompt).toContain("Você é o ORQUESTRADOR desta conversa.");
      expect(prompt).toContain("<configuracao-do-pedido>");
      expect(prompt).toContain("delegar_subtarefas");
      expect(prompt.endsWith("Corrija o bug do login.")).toBe(true);
    });

    it("leva o contexto da troca de motor no prompt", async () => {
      await executar(pedidoCom("Continue.", { contextoDaTroca: "O motor anterior criou o arquivo a.ts." }));

      expect(textoDoPrompt()).toContain("<contexto-da-troca>");
      expect(textoDoPrompt()).toContain("O motor anterior criou o arquivo a.ts.");
    });

    it("retoma a sessão com session/load e ignora o histórico que o agente repete antes de responder", async () => {
      const { resultado, eventos } = await executar(
        pedidoCom("Segundo pedido.", { sessaoIniciada: true, sessaoId: "sessao-falsa-anterior" }),
      );

      expect(resultado.sucesso).toBe(true);
      expect(resultado.sessaoDoMotor).toBe("sessao-falsa-anterior");
      expect(recebidos("session/load")[0]?.params).toMatchObject({ sessionId: "sessao-falsa-anterior", cwd: pastas.trabalho });
      expect(recebidos("session/new")).toHaveLength(0);
      const falas = eventos.filter((evento) => evento.tipo === "texto_do_orquestrador");
      expect(JSON.stringify(falas)).not.toContain("resposta antiga");
      expect(eventos.some((evento) => evento.tipo === "ferramenta_do_orquestrador")).toBe(false);
      expect(textoDoPrompt()).not.toContain("não pôde ser retomada");
    });

    it("abre uma sessão nova e avisa o agente quando a sessão anterior não existe mais", async () => {
      const { resultado } = await executar(pedidoCom("Oi.", { sessaoIniciada: true, sessaoId: "sessao-falsa-perdida" }));

      expect(resultado.sucesso).toBe(true);
      expect(resultado.sessaoDoMotor).toMatch(/^sessao-falsa-\d+-/);
      expect(resultado.sessaoDoMotor).not.toBe("sessao-falsa-perdida");
      expect(recebidos("session/new")).toHaveLength(1);
      expect(textoDoPrompt()).toContain("não pôde ser retomada");
    });

    it("sem loadSession no agente, abre uma sessão nova a cada turno e avisa", async () => {
      ambienteDoAgente["FALSO_SEM_LOAD"] = "1";

      const { resultado } = await executar(pedidoCom("Oi.", { sessaoIniciada: true, sessaoId: "sessao-falsa-anterior" }));

      expect(resultado.sucesso).toBe(true);
      expect(recebidos("session/load")).toHaveLength(0);
      expect(recebidos("session/new")).toHaveLength(1);
      expect(textoDoPrompt()).toContain("não retoma sessões");
    });

    it("deixa o uso de tokens vazio (zero) quando o agente não o informa", async () => {
      ambienteDoAgente["FALSO_SEM_USO"] = "1";

      const { resultado } = await executar(pedidoCom("Oi."));

      expect(resultado.uso).toMatchObject({ tokensDeEntrada: 0, tokensDeSaida: 0 });
    });

    it("passa ao CLI as pastas liberadas, o modelo e as negações por conta própria, e não herda o que libera tudo", async () => {
      process.env["COPILOT_ALLOW_ALL"] = "1";
      const configuracao = configuracaoDeTeste({ nivelDePermissao: "edicao", modeloDoOrquestrador: "claude-haiku-4.5" });

      await executar(pedidoCom("Oi.", { configuracao }));

      const argv = lerLog().find((linha) => linha.tipo === "argv");
      expect(argv?.ambiente).toEqual({ COPILOT_ALLOW_ALL: null });
      // O agente falso recebe só o script; os argumentos de política vêm do perfil (testado abaixo).
      const perfil = criarPerfilDoCopilot("copilot");
      const argumentos = perfil.argumentosDoTurno({
        contexto: {
          nivel: "edicao",
          modo: "execucao",
          pastaDeTrabalho: pastas.trabalho,
          pastaDeArtefatos: pastas.artefatos,
          pastaDosAnexos: null,
          permiteCommitEPush: false,
        },
        modelo: "claude-haiku-4.5",
      });
      expect(argumentos).toEqual([
        "--add-dir",
        pastas.artefatos,
        "--model",
        "claude-haiku-4.5",
        "--deny-tool=shell",
        "--deny-tool=shell(git commit)",
        "--deny-tool=shell(git push)",
      ]);
    });

    it("recusa um pedido de outro motor sem iniciar processo nenhum", async () => {
      const { resultado } = await executar(pedidoDeTeste(pastas, "codex"));

      expect(resultado.sucesso).toBe(false);
      expect(existsSync(arquivoDeLog)).toBe(false);
    });
  });

  describe("permissões (session/request_permission)", () => {
    function respostaDa(chamada: string): string | undefined {
      return lerLog().find((linha) => linha.tipo === "permissao" && linha.chamada === chamada)?.resposta?.outcome?.optionId;
    }

    it("no nível leitura, recusa escrever no projeto e comandos, e libera gravar na pasta de artefatos", async () => {
      const configuracao = configuracaoDeTeste({ nivelDePermissao: "leitura" });
      const noProjeto = path.join(pastas.trabalho, "src", "x.ts");
      const noArtefato = path.join(pastas.artefatos, "relatorio.html");

      const projeto = await executar(pedidoCom(`[[ESCREVER=${noProjeto}]]`, { configuracao }));
      expect(projeto.eventos).toContainEqual({ tipo: "permissao_negada", ferramenta: "Create file", detalhe: noProjeto });
      expect(respostaDa("Create file")).toBe("reject_once");

      rmSync(arquivoDeLog);
      const artefato = await executar(pedidoCom(`[[ESCREVER=${noArtefato}]]`, { configuracao }));
      expect(artefato.eventos.some((evento) => evento.tipo === "permissao_negada")).toBe(false);
      expect(respostaDa("Create file")).toBe("allow_once");

      rmSync(arquivoDeLog);
      const comando = await executar(pedidoCom("[[COMANDO=npm test]]", { configuracao }));
      expect(comando.eventos).toContainEqual({ tipo: "permissao_negada", ferramenta: "PowerShell", detalhe: "npm test" });
      expect(respostaDa("Run command")).toBe("reject_once");
    });

    it("no nível edicao, libera editar o projeto e recusa comandos", async () => {
      const configuracao = configuracaoDeTeste({ nivelDePermissao: "edicao" });

      await executar(pedidoCom(`[[ESCREVER=${path.join(pastas.trabalho, "a.ts")}]]`, { configuracao }));
      expect(respostaDa("Create file")).toBe("allow_once");

      rmSync(arquivoDeLog);
      await executar(pedidoCom("[[COMANDO=npm test]]", { configuracao }));
      expect(respostaDa("Run command")).toBe("reject_once");
    });

    it("no planejamento (Plan Mode) só lê, seja qual for o nível: recusa editar o projeto e comandos, e libera artefatos", async () => {
      const configuracao = configuracaoDeTeste({ nivelDePermissao: "edicao_e_comandos" });

      await executar(pedidoCom(`[[ESCREVER=${path.join(pastas.trabalho, "a.ts")}]]`, { configuracao, modo: "planejamento" }));
      expect(respostaDa("Create file")).toBe("reject_once");

      rmSync(arquivoDeLog);
      await executar(pedidoCom("[[COMANDO=ls]]", { configuracao, modo: "planejamento" }));
      expect(respostaDa("Run command")).toBe("reject_once");

      rmSync(arquivoDeLog);
      await executar(pedidoCom(`[[ESCREVER=${path.join(pastas.artefatos, "plano.md")}]]`, { configuracao, modo: "planejamento" }));
      expect(respostaDa("Create file")).toBe("allow_once");
    });

    it("recusa git commit e git push quando não estão liberados, e push forçado mesmo quando estão", async () => {
      const semCommit = configuracaoDeTeste({ permitirCommitEPush: false });
      await executar(pedidoCom("[[COMANDO=git add a.ts && git commit -m x]]", { configuracao: semCommit }));
      expect(respostaDa("Run command")).toBe("reject_once");

      rmSync(arquivoDeLog);
      await executar(pedidoCom("[[COMANDO=git -C . push origin main]]", { configuracao: semCommit }));
      expect(respostaDa("Run command")).toBe("reject_once");

      const comCommit = configuracaoDeTeste({ permitirCommitEPush: true });
      rmSync(arquivoDeLog);
      await executar(pedidoCom("[[COMANDO=git commit -m x]]", { configuracao: comCommit }));
      expect(respostaDa("Run command")).toBe("allow_once");

      rmSync(arquivoDeLog);
      await executar(pedidoCom("[[COMANDO=git push --force origin main]]", { configuracao: comCommit }));
      expect(respostaDa("Run command")).toBe("reject_once");
    });

    it("no planejamento recusa commit mesmo com a opção ligada", async () => {
      const configuracao = configuracaoDeTeste({ permitirCommitEPush: true });

      await executar(pedidoCom("[[COMANDO=git commit -m x]]", { configuracao, modo: "planejamento" }));

      expect(respostaDa("Run command")).toBe("reject_once");
    });

    it("nunca escolhe permitir sempre: isso gravaria a liberação na configuração do CLI do usuário", async () => {
      await executar(pedidoCom(`[[COMANDO=ls]] [[ESCREVER=${path.join(pastas.trabalho, "a.ts")}]]`));

      const respostas = lerLog().filter((linha) => linha.tipo === "permissao").map((linha) => linha.resposta?.outcome?.optionId);
      expect(respostas).toHaveLength(2);
      expect(respostas.every((resposta) => resposta === "allow_once")).toBe(true);
    });

    it("libera a ferramenta de delegação do app em qualquer nível e não a mostra como ferramenta do Orquestrador", async () => {
      const configuracao = configuracaoDeTeste({ nivelDePermissao: "leitura" });

      const { eventos } = await executar(pedidoCom("[[MCP]]", { configuracao, modo: "planejamento" }));

      expect(respostaDa("delegar_subtarefas")).toBe("allow_once");
      expect(eventos.some((evento) => evento.tipo === "ferramenta_do_orquestrador")).toBe(false);
    });
  });

  describe("eventos", () => {
    it("traduz o plano do agente para a lista de tarefas e as chamadas de ferramenta para ferramentas do Orquestrador", async () => {
      const { eventos } = await executar(pedidoCom("[[PLANO]] [[COMANDO=ls]]"));

      expect(eventos).toContainEqual({
        tipo: "tarefas_atualizadas",
        tarefas: [
          { texto: "Ler o projeto", situacao: "concluida" },
          { texto: "Escrever o código", situacao: "em_andamento" },
          { texto: "Rodar os testes", situacao: "pendente" },
        ],
      });
      expect(eventos).toContainEqual({ tipo: "ferramenta_do_orquestrador", ferramenta: "PowerShell", detalhe: "ls" });
    });

    it("anuncia o servidor local que um comando subiu, depois de conferir que responde", async () => {
      const sondar = vi.fn(async () => true);

      const { eventos } = await executar(pedidoCom("[[COMANDO=npm run dev]]"), criarMotor({ sondar }));

      expect(sondar).toHaveBeenCalledWith("http://localhost:5173");
      expect(eventos).toContainEqual({ tipo: "endereco_local_detectado", url: "http://localhost:5173", origem: "ferramenta" });
    });

    it("anuncia o endereço citado na resposta final com a origem 'resposta'", async () => {
      const { eventos } = await executar(
        pedidoCom("[[FALAR=Veja em http://localhost:4000]]"),
        criarMotor({ sondar: async () => true }),
      );

      expect(eventos).toContainEqual({ tipo: "endereco_local_detectado", url: "http://localhost:4000", origem: "resposta" });
    });
  });

  describe("perfil com configuração por arquivo (Gemini CLI)", () => {
    function motorDoGemini(servidorMcp?: PonteParaOServidorMcp): MotorAcp {
      const gemini = criarPerfilDoGemini("gemini");
      return new MotorAcp({
        perfil: {
          ...gemini,
          comando: () => ({ executavel: process.execPath, argumentosIniciais: [AGENTE_FALSO] }),
          ambiente: (base) => ({ ...gemini.ambiente(base), FALSO_LOG: arquivoDeLog }),
        },
        sondar: async () => false,
        plataforma: "windows",
        ...(servidorMcp === undefined ? {} : { servidorMcp }),
      });
    }

    it("grava o servidor MCP e as negações num arquivo, não manda o servidor no session/new e apaga o arquivo no fim", async () => {
      const registrarTurno = vi.fn(() => ({ url: "http://127.0.0.1:9999/mcp", token: "tok-123", encerrar: vi.fn() }));
      const configuracao = configuracaoDeTeste({ nivelDePermissao: "edicao" });

      const { resultado } = await executar(
        pedidoDeTeste(pastas, "gemini", { texto: "Oi.", configuracao }),
        motorDoGemini({ registrarTurno }),
      );

      expect(resultado.sucesso).toBe(true);
      expect(recebidos("session/new")[0]?.params).toMatchObject({ mcpServers: [] });
      const lido = lerLog().find((linha) => linha.tipo === "configuracao-por-arquivo") as { conteudo?: unknown } | undefined;
      expect(lido?.conteudo).toMatchObject({
        security: { disableYoloMode: true },
        tools: { exclude: ["run_shell_command"] },
        mcpServers: {
          orquestrador: { httpUrl: "http://127.0.0.1:9999/mcp", headers: { Authorization: "Bearer tok-123" }, timeout: 3_600_000 },
        },
      });
    });

    it("numa subtarefa (sem servidor MCP), grava só as negações", async () => {
      const { resultado } = await executar(pedidoDeTeste(pastas, "gemini", { texto: "Oi." }), motorDoGemini());

      expect(resultado.sucesso).toBe(true);
      const lido = lerLog().find((linha) => linha.tipo === "configuracao-por-arquivo") as { conteudo?: Record<string, unknown> } | undefined;
      expect(lido?.conteudo).toBeDefined();
      expect(lido?.conteudo).not.toHaveProperty("mcpServers");
    });
  });

  describe("ferramentas do app (MCP)", () => {
    it("passa o servidor MCP do turno ao Copilot por arquivo de configuração, com tempo de sobra, e o apaga no fim", async () => {
      const encerrar = vi.fn();
      const registrarTurno = vi.fn(() => ({ url: "http://127.0.0.1:9999/mcp", token: "tok-123", encerrar }));

      await executar(pedidoCom("Oi."), criarMotor({ servidorMcp: { registrarTurno } }));

      expect(registrarTurno).toHaveBeenCalledWith({ orquestradorId: "orq-1", ferramentas: { delegar_subtarefas: true } });
      const argv = lerLog().find((linha) => linha.tipo === "argv")?.argv ?? [];
      const indice = argv.indexOf("--additional-mcp-config");
      expect(indice).toBeGreaterThan(-1);
      const arquivo = (argv[indice + 1] ?? "").replace(/^@/, "");
      expect(lerLog().find((linha) => linha.tipo === "mcp-por-arquivo")).toMatchObject({
        conteudo: {
          mcpServers: {
            orquestrador: {
              type: "http",
              url: "http://127.0.0.1:9999/mcp",
              headers: { Authorization: "Bearer tok-123" },
              tools: ["*"],
              timeout: 3_600_000,
            },
          },
        },
      });
      // O token não vai no `session/new` (nem na linha de comando): só no arquivo, que não sobra.
      expect(recebidos("session/new")[0]?.params).toMatchObject({ mcpServers: [] });
      expect(argv.join(" ")).not.toContain("tok-123");
      expect(existsSync(arquivo)).toBe(false);
      expect(encerrar).toHaveBeenCalledTimes(1);
    });

    it("passa o servidor MCP pelo session/new quando o CLI não aceita arquivo de configuração", async () => {
      const registrarTurno = vi.fn(() => ({ url: "http://127.0.0.1:9999/mcp", token: "tok-123", encerrar: vi.fn() }));
      const { mcpPorArquivo: _ignorado, ...semArquivo } = perfilFalso();
      const motor = new MotorAcp({ perfil: semArquivo, servidorMcp: { registrarTurno }, plataforma: "windows", sondar: async () => false });

      await executar(pedidoCom("Oi."), motor);

      expect(recebidos("session/new")[0]?.params).toMatchObject({
        mcpServers: [
          { type: "http", name: "orquestrador", url: "http://127.0.0.1:9999/mcp", headers: [{ name: "Authorization", value: "Bearer tok-123" }] },
        ],
      });
    });

    it("não passa MCP quando nenhum grupo está ligado (Orquestrador e subagentes no Claude Code)", async () => {
      const registrarTurno = vi.fn();
      const configuracao = configuracaoDeTeste({ motorDoOrquestrador: "claude-code", motorDosSubagentes: "claude-code", modeloDoOrquestrador: "opus", modeloDosSubagentes: "sonnet" });

      await executar(pedidoCom("Oi.", { configuracao }), criarMotor({ servidorMcp: { registrarTurno } }));

      expect(registrarTurno).not.toHaveBeenCalled();
      expect(recebidos("session/new")[0]?.params).toMatchObject({ mcpServers: [] });
    });
  });

  describe("falhas", () => {
    it("classifica o limite de uso, com o horário em que libera", async () => {
      const antes = Date.now();

      const { resultado } = await executar(pedidoCom("[[LIMITE]]"));

      expect(resultado.sucesso).toBe(false);
      if (resultado.sucesso) return;
      expect(resultado.causa).toBe("limite_de_uso");
      expect(resultado.motivo).toContain("Limite de uso do GitHub Copilot CLI atingido");
      const libera = Date.parse(resultado.liberaEm ?? "");
      expect(libera).toBeGreaterThanOrEqual(antes + 19 * 60_000);
      expect(libera).toBeLessThanOrEqual(Date.now() + 21 * 60_000);
      expect(resultado.sessaoDoMotor).toMatch(/^sessao-falsa-/);
    });

    it("classifica a sobrecarga", async () => {
      const { resultado } = await executar(pedidoCom("[[SOBRECARGA]]"));

      expect(resultado).toMatchObject({ sucesso: false, causa: "sobrecarga" });
    });

    it("explica quando o CLI não está logado", async () => {
      ambienteDoAgente["FALSO_SEM_LOGIN"] = "1";

      const { resultado } = await executar(pedidoCom("Oi."));

      expect(resultado).toMatchObject({ sucesso: false, causa: "outro" });
      expect(resultado.sucesso === false && resultado.motivo).toContain('Rode "copilot login"');
    });

    it("conta o que o stderr disse quando o processo morre no meio do turno", async () => {
      const { resultado } = await executar(pedidoCom("[[MORRER]]"));

      expect(resultado.sucesso).toBe(false);
      expect(resultado.sucesso === false && resultado.motivo).toContain("falha fatal do agente falso");
    });

    it("explica que o CLI não foi encontrado quando o executável não existe", async () => {
      const motor = new MotorAcp({
        perfil: { ...perfilFalso(), comando: () => ({ executavel: path.join(pastas.raiz, "nao-existe.exe"), argumentosIniciais: [] }) },
        plataforma: "windows",
      });

      const { resultado } = await executar(pedidoCom("Oi."), motor);

      expect(resultado.sucesso).toBe(false);
      expect(resultado.sucesso === false && resultado.motivo).toContain("não foi encontrado nesta máquina");
      expect(resultado.sucesso === false && resultado.motivo).toContain("npm install -g @github/copilot");
    });
  });

  describe("cancelamento", () => {
    async function esperarPeloPrompt(): Promise<void> {
      for (let tentativa = 0; tentativa < 200 && recebidos("session/prompt").length === 0; tentativa++) {
        await new Promise((resolver) => setTimeout(resolver, 25));
      }
    }

    it("manda session/cancel ao agente e devolve o turno cancelado", async () => {
      const controle = new AbortController();
      const execucao = executar(pedidoCom("[[DEMORAR]]"), criarMotor(), controle.signal);
      await esperarPeloPrompt();

      const inicio = Date.now();
      controle.abort();
      const { resultado } = await execucao;

      expect(resultado).toMatchObject({ sucesso: false, motivo: "Turno cancelado." });
      expect(recebidos("session/cancel")).toHaveLength(1);
      expect(Date.now() - inicio).toBeLessThan(3_000);
    });

    it("trata como cancelado o turno que o agente encerra com end_turn depois do session/cancel (o Copilot faz isso)", async () => {
      ambienteDoAgente["FALSO_CANCELA_COM_END_TURN"] = "1";
      const controle = new AbortController();
      const execucao = executar(pedidoCom("[[DEMORAR]]"), criarMotor(), controle.signal);
      await esperarPeloPrompt();

      controle.abort();
      const { resultado } = await execucao;

      expect(resultado).toMatchObject({ sucesso: false, motivo: "Turno cancelado." });
    });

    it("com a autorrecuperação (silêncio), derruba o processo e devolve a causa 'silencio'", async () => {
      const controle = new AbortController();
      const execucao = executar(pedidoCom("[[DEMORAR]]"), criarMotor(), controle.signal);
      await esperarPeloPrompt();

      controle.abort(ABORTO_POR_SILENCIO);
      const { resultado } = await execucao;

      expect(resultado).toMatchObject({ sucesso: false, causa: "silencio" });
      expect(recebidos("session/cancel")).toHaveLength(0);
    });

    it("não inicia processo nenhum com o sinal já abortado", async () => {
      const controle = new AbortController();
      controle.abort();

      const { resultado } = await executar(pedidoCom("Oi."), criarMotor(), controle.signal);

      expect(resultado).toMatchObject({ sucesso: false, motivo: "Turno cancelado." });
      expect(existsSync(arquivoDeLog)).toBe(false);
    });
  });

  describe("subtarefas", () => {
    it("roda a subtarefa numa sessão nova, com as regras do subagente, e converte os eventos para os de um subagente", async () => {
      const eventos: EventoDoMotor[] = [];
      const motor = criarMotor();

      const resultado = await motor.executarSubtarefa({
        pedido: pedidoCom("Pedido do usuário."),
        subtarefa: { descricao: "Rodar o ls", prompt: "[[COMANDO=ls]] liste a pasta", subagente: null },
        especialidade: null,
        subagenteId: "sub-1",
        aoProgredir: (evento) => eventos.push(evento),
        sinal: new AbortController().signal,
      });

      // O relatório é a última fala, depois da última ferramenta (como o `result` do Claude Code).
      expect(resultado).toMatchObject({ situacao: "concluido", relatorio: "Pronto.", tokensDeEntrada: 100, tokensDeSaida: 20 });
      expect(eventos).toContainEqual({ tipo: "texto_do_subagente", subagenteId: "sub-1", texto: "Vou trabalhar." });
      expect(eventos).toContainEqual({ tipo: "texto_do_subagente", subagenteId: "sub-1", texto: "Pronto." });
      expect(eventos).toContainEqual(
        expect.objectContaining({ tipo: "progresso_do_subagente", subagenteId: "sub-1", ultimaFerramenta: "PowerShell", atividade: "ls", ferramentasUsadas: 1 }),
      );
      expect(eventos.some((evento) => evento.tipo === "sessao_iniciada")).toBe(false);
      expect(recebidos("session/new")).toHaveLength(1);
      expect(recebidos("session/new")[0]?.params).toMatchObject({ mcpServers: [] });
      const prompt = textoDoPrompt();
      expect(prompt).toContain("<regras-do-subagente>");
      expect(prompt).toContain("Você é um subagente executor");
      expect(prompt).toContain("Subtarefa: Rodar o ls");
      expect(prompt).not.toContain("<regras-do-orquestrador>");
      expect(recebidos("session/close")).toHaveLength(1);
    });

    it("aplica as permissões do pedido à subtarefa", async () => {
      const configuracao = configuracaoDeTeste({ nivelDePermissao: "leitura" });

      await criarMotor().executarSubtarefa({
        pedido: pedidoCom("Pedido.", { configuracao }),
        subtarefa: { descricao: "Escrever", prompt: `[[ESCREVER=${path.join(pastas.trabalho, "x.ts")}]]`, subagente: null },
        especialidade: null,
        subagenteId: "sub-2",
        aoProgredir: () => undefined,
        sinal: new AbortController().signal,
      });

      expect(lerLog().find((linha) => linha.tipo === "permissao")?.resposta?.outcome?.optionId).toBe("reject_once");
    });

    it("devolve a falha como relatório da subtarefa", async () => {
      const resultado = await criarMotor().executarSubtarefa({
        pedido: pedidoCom("Pedido."),
        subtarefa: { descricao: "Falhar", prompt: "[[LIMITE]]", subagente: null },
        especialidade: null,
        subagenteId: "sub-3",
        aoProgredir: () => undefined,
        sinal: new AbortController().signal,
      });

      expect(resultado.situacao).toBe("falhou");
      expect(resultado.relatorio).toContain("Limite de uso");
    });
  });
});
