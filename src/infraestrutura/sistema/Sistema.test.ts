import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { comNovasTentativas, ErroAoIniciarProcesso, FachadaClaudeCodeCli } from "../claudecode/FachadaClaudeCodeCli";
import { encerrarArvore, lerListaDeProcessos, lerTasklistCsv, listarProcessos, tempoDoPsEmMs } from "./Processos";
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

    expect(processos.find((processo) => processo.pid === process.pid)?.ppid).toBe(process.ppid);
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
  const processos = await listarProcessos();
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
    const pid = (await listarProcessos()).find(
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
