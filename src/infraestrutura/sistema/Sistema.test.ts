import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { comNovasTentativas, ErroAoIniciarProcesso, FachadaClaudeCodeCli } from "../claudecode/FachadaClaudeCodeCli";
import {
  encerrarArvore,
  lerIdentidadeDoPs,
  lerIdentidadeDoWindows,
  lerListaDeProcessos,
  lerTasklistCsv,
  listarProcessos,
  tempoDoPsEmMs,
} from "./Processos";
import { ehAgenteDeixadoPorNos, RegistroDeProcessos } from "./RegistroDeProcessos";

describe("lerTasklistCsv", () => {
  it("lê a memória no formato do Windows em português e em inglês", () => {
    const saida = [
      '"claude.exe","19796","Console","1","278.528 K"',
      '"claude.exe","4176","Console","1","140,636 K"',
      "",
      "INFORMAÇÕES: nenhuma tarefa em execução corresponde aos critérios especificados.",
    ].join("\r\n");

    expect(lerTasklistCsv(saida)).toEqual(
      new Map([
        [19796, 278_528 * 1024],
        [4176, 140_636 * 1024],
      ]),
    );
  });
});

describe("ehAgenteDeixadoPorNos", () => {
  const processo = { pid: 10, orquestradorId: "o1", sessaoId: "sessao-abc", iniciadoEm: "" };

  it("reconhece o agente pela sessão na linha de comando", () => {
    expect(
      ehAgenteDeixadoPorNos(processo, "claude.exe -p --input-format stream-json --resume sessao-abc --model opus"),
    ).toBe(true);
  });

  it("não derruba um PID reaproveitado por outro programa nem uma sessão interativa do usuário", () => {
    expect(ehAgenteDeixadoPorNos(processo, "notepad.exe")).toBe(false);
    expect(ehAgenteDeixadoPorNos(processo, '"C:\\...\\claude.exe"')).toBe(false);
    expect(ehAgenteDeixadoPorNos(processo, null)).toBe(false);
  });

  describe("Codex (app-server) e Copilot (--acp)", () => {
    const registrado = "2026-11-17T15:00:00.000Z";
    const doCodex = { pid: 20, orquestradorId: "o1", sessaoId: "sessao-abc", iniciadoEm: registrado };
    const aoRegistrar = new Date("2026-11-17T15:00:00.300Z");

    it("reconhece o Codex e o Copilot que o app iniciou: a linha de comando e a hora de criação batem com o registro", () => {
      expect(ehAgenteDeixadoPorNos(doCodex, "codex app-server", aoRegistrar)).toBe(true);
      expect(ehAgenteDeixadoPorNos(doCodex, '"C:\\Users\\ana\\AppData\\Roaming\\npm\\codex.exe" app-server', aoRegistrar)).toBe(true);
      // Windows: o `.cmd` do npm roda pelo `cmd.exe`.
      expect(
        ehAgenteDeixadoPorNos(doCodex, 'C:\\WINDOWS\\system32\\cmd.exe /d /s /c ""C:\\Users\\ana\\npm\\codex.cmd" app-server"', aoRegistrar),
      ).toBe(true);
      expect(
        ehAgenteDeixadoPorNos(
          doCodex,
          "node /usr/lib/node_modules/@openai/codex/bin/codex.js app-server",
          new Date("2026-11-17T14:59:50.000Z"),
        ),
      ).toBe(true);
      expect(
        ehAgenteDeixadoPorNos(
          doCodex,
          'copilot --acp --stdio --no-auto-update --no-ask-user --no-color --add-dir "C:\\dados\\artefatos\\entrada\\orquestradores\\o1"',
          aoRegistrar,
        ),
      ).toBe(true);
      expect(
        ehAgenteDeixadoPorNos(doCodex, 'C:\\WINDOWS\\system32\\cmd.exe /d /s /c ""C:\\Users\\ana\\npm\\copilot.cmd" --acp --stdio"', aoRegistrar),
      ).toBe(true);
    });

    it("sem a hora de criação, ou com ela longe da do registro, não é nosso: pode ser uma sessão do próprio usuário", () => {
      // O Codex do VS Code e um editor com Copilot rodam exatamente estes comandos.
      expect(ehAgenteDeixadoPorNos(doCodex, "codex app-server", null)).toBe(false);
      expect(ehAgenteDeixadoPorNos(doCodex, "codex app-server")).toBe(false);
      expect(ehAgenteDeixadoPorNos(doCodex, "codex app-server", new Date("2026-11-17T15:01:00.000Z"))).toBe(false);
      expect(ehAgenteDeixadoPorNos(doCodex, "copilot --acp --stdio", new Date("2026-11-16T09:00:00.000Z"))).toBe(false);
      expect(ehAgenteDeixadoPorNos({ ...doCodex, iniciadoEm: "" }, "codex app-server", aoRegistrar)).toBe(false);
    });

    it("não derruba outro programa que reaproveitou o PID, nem o Codex e o Copilot em outros usos", () => {
      expect(ehAgenteDeixadoPorNos(doCodex, "notepad.exe", aoRegistrar)).toBe(false);
      expect(ehAgenteDeixadoPorNos(doCodex, "codex", aoRegistrar)).toBe(false);
      expect(ehAgenteDeixadoPorNos(doCodex, "codex exec fazer-algo", aoRegistrar)).toBe(false);
      expect(ehAgenteDeixadoPorNos(doCodex, "copilot", aoRegistrar)).toBe(false);
      expect(ehAgenteDeixadoPorNos(doCodex, "node servidor.js --acp", aoRegistrar)).toBe(false);
      expect(ehAgenteDeixadoPorNos(doCodex, "app-server", aoRegistrar)).toBe(false);
      expect(ehAgenteDeixadoPorNos(doCodex, null, aoRegistrar)).toBe(false);
    });

    it("a conferência do Claude Code não mudou: a sessão e o stream-json valem sem a hora de criação", () => {
      expect(ehAgenteDeixadoPorNos(doCodex, "claude.exe -p --input-format stream-json --resume sessao-abc", null)).toBe(true);
      expect(ehAgenteDeixadoPorNos(doCodex, "claude.exe -p --resume outra-sessao --input-format stream-json", aoRegistrar)).toBe(false);
    });
  });
});

describe("identidade de um processo (linha de comando e criação)", () => {
  it("lê a saída do PowerShell: linha de comando e criação em ISO", () => {
    const identidade = lerIdentidadeDoWindows('{"l":"codex app-server","c":"2026-11-17T15:00:00.1234567Z"}');

    expect(identidade?.linhaDeComando).toBe("codex app-server");
    expect(identidade?.criadoEm?.toISOString()).toBe("2026-11-17T15:00:00.123Z");
  });

  it("no PowerShell, sem criação ou com data inválida a criação fica nula; sem linha de comando ou texto estranho, nada", () => {
    expect(lerIdentidadeDoWindows('{"l":"codex app-server","c":""}')).toEqual({ linhaDeComando: "codex app-server", criadoEm: null });
    expect(lerIdentidadeDoWindows('{"l":"codex app-server","c":"ontem"}')?.criadoEm).toBeNull();
    expect(lerIdentidadeDoWindows('{"l":null,"c":"2026-11-17T15:00:00Z"}')).toBeNull();
    expect(lerIdentidadeDoWindows("")).toBeNull();
    expect(lerIdentidadeDoWindows("erro qualquer")).toBeNull();
  });

  it("lê a saída do ps: o tempo de vida vira a criação (agora menos o tempo)", () => {
    const agora = Date.parse("2026-11-17T15:00:30.000Z");

    const identidade = lerIdentidadeDoPs("   00:30 copilot --acp --stdio --add-dir /tmp/x\n", agora);

    expect(identidade?.linhaDeComando).toBe("copilot --acp --stdio --add-dir /tmp/x");
    expect(identidade?.criadoEm?.toISOString()).toBe("2026-11-17T15:00:00.000Z");
    expect(lerIdentidadeDoPs("1-02:03:04 codex app-server", agora)?.criadoEm?.toISOString()).toBe("2026-11-16T12:57:26.000Z");
  });

  it("no ps, tempo irreconhecível deixa a criação nula e a saída vazia não é um processo", () => {
    expect(lerIdentidadeDoPs("??? codex app-server", Date.now())).toEqual({ linhaDeComando: "codex app-server", criadoEm: null });
    expect(lerIdentidadeDoPs("", Date.now())).toBeNull();
    expect(lerIdentidadeDoPs("00:10\n", Date.now())).toBeNull();
  });
});

describe("RegistroDeProcessos", () => {
  let pasta: string;

  beforeEach(async () => {
    pasta = await mkdtemp(path.join(tmpdir(), "registro-teste-"));
  });

  afterEach(async () => {
    await rm(pasta, { recursive: true, force: true });
  });

  it("grava em disco quem está rodando, para o próximo servidor achar os órfãos", () => {
    const arquivo = path.join(pasta, "processos.json");
    const registro = new RegistroDeProcessos(arquivo);

    registro.registrar({ pid: 1, orquestradorId: "o1", sessaoId: "s1", iniciadoEm: "agora" });
    registro.registrar({ pid: 2, orquestradorId: "o2", sessaoId: "s2", iniciadoEm: "agora" });
    registro.remover(1);

    expect(RegistroDeProcessos.lerArquivo(arquivo).map((processo) => processo.pid)).toEqual([2]);
  });

  it("lê arquivo ausente ou corrompido como lista vazia", () => {
    expect(RegistroDeProcessos.lerArquivo(path.join(pasta, "nao-existe.json"))).toEqual([]);
  });
});

describe("comNovasTentativas", () => {
  const sinal = new AbortController().signal;

  it("tenta de novo enquanto o executável some durante a atualização do Claude Code", async () => {
    let chamadas = 0;
    const resultado = await comNovasTentativas(
      async () => {
        chamadas += 1;
        if (chamadas < 3) {
          throw new ErroAoIniciarProcesso("sumiu", "ENOENT");
        }
        return "ok";
      },
      { tentativas: 6, esperaMs: 1, sinal },
    );

    expect(resultado).toBe("ok");
    expect(chamadas).toBe(3);
  });

  it("não insiste em erro que não é passageiro", async () => {
    let chamadas = 0;
    await expect(
      comNovasTentativas(
        async () => {
          chamadas += 1;
          throw new Error("argumento inválido");
        },
        { tentativas: 6, esperaMs: 1, sinal },
      ),
    ).rejects.toThrow("argumento inválido");
    expect(chamadas).toBe(1);
  });

  it("desiste depois do número de tentativas", async () => {
    let chamadas = 0;
    await expect(
      comNovasTentativas(
        async () => {
          chamadas += 1;
          throw new ErroAoIniciarProcesso("sumiu", "ENOENT");
        },
        { tentativas: 3, esperaMs: 1, sinal },
      ),
    ).rejects.toBeInstanceOf(ErroAoIniciarProcesso);
    expect(chamadas).toBe(3);
  });
});

describe("lista de processos (ps)", () => {
  it("converte o etime [[dd-]hh:]mm:ss em milissegundos", () => {
    expect(tempoDoPsEmMs("00:07")).toBe(7_000);
    expect(tempoDoPsEmMs("12:34")).toBe((12 * 60 + 34) * 1000);
    expect(tempoDoPsEmMs("01:02:03")).toBe((3600 + 2 * 60 + 3) * 1000);
    expect(tempoDoPsEmMs("16-05:40:23")).toBe((((16 * 24 + 5) * 60 + 40) * 60 + 23) * 1000);
    expect(tempoDoPsEmMs("ontem")).toBeNull();
  });

  it("lê as linhas do ps, com CPU em vírgula, e ignora o que não reconhece", () => {
    const saida = [
      "    1     0   0.3 16-05:40:23 /sbin/launchd",
      "  812   811  97,5    02:10 /Users/eu/app/node_modules/.bin/vitest run --maxWorkers=1",
      "  900   812   0.0    00:01 sh -c   sleep 30",
      "linha estranha",
      "",
    ].join("\n");

    expect(lerListaDeProcessos(saida)).toEqual([
      { pid: 1, ppid: 0, cpu: 0.3, haMs: (((16 * 24 + 5) * 60 + 40) * 60 + 23) * 1000, comando: "/sbin/launchd" },
      { pid: 812, ppid: 811, cpu: 97.5, haMs: 130_000, comando: "/Users/eu/app/node_modules/.bin/vitest run --maxWorkers=1" },
      { pid: 900, ppid: 812, cpu: 0, haMs: 1_000, comando: "sh -c   sleep 30" },
    ]);
  });

  it.skipIf(process.platform === "win32")("lista os processos reais da máquina, inclusive este", async () => {
    const processos = await listarProcessos();

    expect(processos?.find((processo) => processo.pid === process.pid)?.ppid).toBe(process.ppid);
  });

  it("no Windows avisa que não dá para listar (null), em vez de uma lista vazia", async () => {
    const plataforma = Object.getOwnPropertyDescriptor(process, "platform") as PropertyDescriptor;
    Object.defineProperty(process, "platform", { ...plataforma, value: "win32" });
    try {
      expect(await listarProcessos()).toBeNull();
    } finally {
      Object.defineProperty(process, "platform", plataforma);
    }
  });
});

/** Espera até a condição valer ou o prazo acabar; devolve se valeu. */
async function esperarAte(condicao: () => boolean | Promise<boolean>, prazoMs = 3_000): Promise<boolean> {
  const fim = Date.now() + prazoMs;
  while (Date.now() < fim) {
    if (await condicao()) {
      return true;
    }
    await new Promise((resolver) => setTimeout(resolver, 50));
  }
  return condicao();
}

function vivo(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function descendentesDe(pid: number): Promise<number[]> {
  const processos = (await listarProcessos()) ?? [];
  const achados: number[] = [];
  const fila = [pid];
  while (fila.length > 0) {
    const pai = fila.shift();
    for (const filho of processos.filter((processo) => processo.ppid === pai)) {
      achados.push(filho.pid);
      fila.push(filho.pid);
    }
  }
  return achados;
}

describe.skipIf(process.platform === "win32")("encerrarArvore no Mac/Linux", () => {
  it("derruba o grupo inteiro: o shell e o comando que ele deixou em segundo plano", async () => {
    const filho = spawn("sh", ["-c", "sleep 30 & sleep 30; true"], { detached: true, stdio: "ignore" });
    const pid = filho.pid as number;
    const saiu = new Promise((resolver) => filho.once("exit", resolver));
    let netos: number[] = [];
    expect(await esperarAte(async () => (netos = await descendentesDe(pid)).length >= 2)).toBe(true);

    encerrarArvore(pid);
    await saiu;

    expect(await esperarAte(() => netos.every((neto) => !vivo(neto)))).toBe(true);
  });

  it("um processo que ignora o SIGTERM leva SIGKILL depois da espera", async () => {
    const filho = spawn("sh", ["-c", "trap '' TERM; sleep 30 & wait"], { detached: true, stdio: "ignore" });
    const pid = filho.pid as number;
    const saiu = new Promise((resolver) => filho.once("exit", resolver));
    expect(await esperarAte(async () => (await descendentesDe(pid)).length >= 1)).toBe(true);
    const netos = await descendentesDe(pid);

    encerrarArvore(pid, 200);
    await saiu;

    expect(await esperarAte(() => netos.every((neto) => !vivo(neto)))).toBe(true);
  });

  it("sem grupo próprio (iniciado sem detached), ainda encerra o processo", async () => {
    const filho = spawn("sleep", ["30"], { stdio: "ignore" });
    const saiu = new Promise((resolver) => filho.once("exit", resolver));

    encerrarArvore(filho.pid);

    expect(await saiu).toBe(null);
  });
});

describe.skipIf(process.platform === "win32")("FachadaClaudeCodeCli com um processo de verdade", () => {
  it("avisa cada linha do stdout e do stderr e, ao abortar, derruba o que o processo lançou", async () => {
    const fachada = new FachadaClaudeCodeCli("sh");
    const controle = new AbortController();
    const linhas: string[] = [];
    const mensagens: unknown[] = [];

    const execucao = fachada.executar(
      {
        argumentos: ["-c", 'echo \'{"type":"system"}\'; echo "nao e json"; echo "aviso" >&2; sleep 30 & sleep 30'],
        pasta: process.cwd(),
        ambiente: process.env,
        entrada: "",
        dono: { orquestradorId: "o1", sessaoId: "s1" },
      },
      (mensagem) => mensagens.push(mensagem),
      controle.signal,
      (linha, origem) => linhas.push(`${origem}:${linha}`),
    );
    expect(await esperarAte(() => linhas.length >= 3)).toBe(true);
    const pid = ((await listarProcessos()) ?? []).find(
      (processo) => processo.comando.includes("sleep 30 & sleep 30") && processo.ppid === process.pid,
    )?.pid;
    expect(pid).toBeDefined();
    const netos = await descendentesDe(pid as number);
    expect(netos.length).toBeGreaterThanOrEqual(1);

    controle.abort();
    const saida = await execucao;

    expect(linhas).toEqual(expect.arrayContaining(['stdout:{"type":"system"}', "stdout:nao e json", "stderr:aviso"]));
    expect(mensagens).toEqual([{ type: "system" }]);
    expect(saida.erroPadrao).toBe("aviso");
    expect(await esperarAte(() => netos.every((neto) => !vivo(neto)))).toBe(true);
  });
});
