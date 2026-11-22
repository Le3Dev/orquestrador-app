import { execFileSync, spawn } from "node:child_process";

import { describe, expect, it, vi } from "vitest";

import { ProcessoNaArvore } from "./ArvoreDeProcessos";
import { encerrarArvore } from "./Processos";
import { RegistroDeProcessos, VOLTAS_DA_BUSCA_DE_GRUPOS } from "./RegistroDeProcessos";

const esperar = (ms: number): Promise<void> => new Promise((resolver) => setTimeout(resolver, ms));

/**
 * Um líder de grupo (`detached`, como o Claude Code) que abre um filho no mesmo
 * grupo; os dois escrevem uma linha a cada 200 ms. Devolve as linhas lidas até agora.
 */
function iniciarGrupo(): { pid: number; linhas: () => string[]; fim: Promise<number | null> } {
  const filho = `setInterval(() => console.log("filho"), 200)`;
  const lider = `
    const { spawn } = require("node:child_process");
    spawn(process.execPath, ["-e", ${JSON.stringify(filho)}], { stdio: "inherit" });
    setInterval(() => console.log("lider"), 200);
  `;
  const processo = spawn(process.execPath, ["-e", lider], { stdio: ["ignore", "pipe", "ignore"], detached: true });
  const lidas: string[] = [];
  processo.stdout.setEncoding("utf8");
  processo.stdout.on("data", (parte: string) => lidas.push(...parte.split("\n").filter((linha) => linha !== "")));
  const fim = new Promise<number | null>((resolver) => processo.once("close", resolver));
  return { pid: processo.pid as number, linhas: () => [...lidas], fim };
}

describe.skipIf(process.platform === "win32")("congelamento real de um grupo de processos (ADR-51)", () => {
  it("SIGSTOP para o grupo inteiro, SIGCONT retoma, e encerrar um grupo congelado funciona", async () => {
    const grupo = iniciarGrupo();
    const registro = new RegistroDeProcessos();
    registro.registrar({ pid: grupo.pid, orquestradorId: "o1", sessaoId: "s1", iniciadoEm: new Date().toISOString() });
    try {
      await esperar(1_000);
      expect(grupo.linhas()).toContain("lider");
      expect(grupo.linhas()).toContain("filho");

      expect(registro.congelar("o1")).toBe(true);
      await esperar(300);
      const congelado = grupo.linhas().length;
      await esperar(1_200);
      expect(grupo.linhas().length).toBe(congelado);

      expect(registro.descongelar("o1")).toBe(true);
      expect(registro.descongelar("o1")).toBe(false);
      await esperar(1_000);
      const depois = grupo.linhas().slice(congelado);
      expect(depois).toContain("lider");
      expect(depois).toContain("filho");

      // Congelado de novo, o encerramento ainda derruba o grupo (o SIGCONT vai junto do SIGTERM).
      registro.congelar("o1");
      encerrarArvore(grupo.pid, 3_000);
      const fim = await Promise.race([grupo.fim.then(() => "terminou"), esperar(2_000).then(() => "preso")]);
      expect(fim).toBe("terminou");
    } finally {
      try {
        process.kill(-grupo.pid, "SIGKILL");
      } catch {
        // Já terminou.
      }
    }
  }, 15_000);

  it("um processo que nasce durante a pausa já nasce congelado", async () => {
    const registro = new RegistroDeProcessos();
    const primeiro = iniciarGrupo();
    registro.registrar({ pid: primeiro.pid, orquestradorId: "o1", sessaoId: "s1", iniciadoEm: new Date().toISOString() });
    registro.congelar("o1");
    const segundo = iniciarGrupo();
    try {
      registro.registrar({ pid: segundo.pid, orquestradorId: "o1", sessaoId: "s2", iniciadoEm: new Date().toISOString() });
      await esperar(300);
      const antes = segundo.linhas().length;
      await esperar(1_000);
      expect(segundo.linhas().length).toBe(antes);
      registro.descongelar("o1");
      await esperar(800);
      expect(segundo.linhas().length).toBeGreaterThan(antes);
    } finally {
      for (const pid of [primeiro.pid, segundo.pid]) {
        try {
          process.kill(-pid, "SIGKILL");
        } catch {
          // Já terminou.
        }
      }
    }
  }, 15_000);

  it("congela também o comando que o agente abriu em sessão e grupo próprios (o shell do Bash)", async () => {
    // Como o Claude Code faz com o shell de cada `Bash`: o filho nasce em sessão própria (`detached`).
    const comando = `setInterval(() => console.log("comando"), 200)`;
    const lider = `
      const { spawn } = require("node:child_process");
      const comando = spawn(process.execPath, ["-e", ${JSON.stringify(comando)}], { stdio: "inherit", detached: true });
      console.log("pid:" + comando.pid);
      setInterval(() => console.log("lider"), 200);
    `;
    const processo = spawn(process.execPath, ["-e", lider], { stdio: ["ignore", "pipe", "ignore"], detached: true });
    const lidas: string[] = [];
    processo.stdout.setEncoding("utf8");
    processo.stdout.on("data", (parte: string) => lidas.push(...parte.split("\n").filter((linha) => linha !== "")));
    const pidDoLider = processo.pid as number;
    let pidDoComando = 0;
    const estado = (pid: number): string => {
      try {
        return execFileSync("ps", ["-o", "stat=", "-p", String(pid)], { encoding: "utf8" }).trim();
      } catch {
        return "";
      }
    };
    const registro = new RegistroDeProcessos();
    registro.registrar({ pid: pidDoLider, orquestradorId: "o1", sessaoId: "s1", iniciadoEm: new Date().toISOString() });
    try {
      await vi.waitFor(() => expect(lidas.some((linha) => linha.startsWith("pid:"))).toBe(true), { timeout: 3_000 });
      pidDoComando = Number((lidas.find((linha) => linha.startsWith("pid:")) ?? "").slice(4));
      await esperar(500);

      expect(registro.congelar("o1")).toBe(true);
      await vi.waitFor(() => expect(estado(pidDoComando)).toMatch(/^T/), { timeout: 3_000 });
      expect(estado(pidDoLider)).toMatch(/^T/);
      await esperar(300);
      const congelado = lidas.length;
      await esperar(1_000);
      expect(lidas.length).toBe(congelado);

      expect(registro.descongelar("o1")).toBe(true);
      await esperar(800);
      expect(estado(pidDoComando)).not.toMatch(/^T/);
      expect(estado(pidDoLider)).not.toMatch(/^T/);
      expect(lidas.slice(congelado)).toContain("comando");
      expect(lidas.slice(congelado)).toContain("lider");
    } finally {
      for (const pid of [pidDoLider, pidDoComando]) {
        try {
          if (pid > 0) {
            process.kill(-pid, "SIGKILL");
          }
        } catch {
          // Já terminou.
        }
      }
    }
  }, 15_000);
});

/** Um processo da listagem falsa: `pid`, pai, grupo; nascidos todos no mesmo instante. */
function noDaArvore(pid: number, ppid: number, grupo: number): ProcessoNaArvore {
  return { pid, ppid, grupo, criadoEm: 1_000, nome: "node", comando: `node ${pid}` };
}

/**
 * Um registro com listagem e sinais falsos. O servidor é o pid 900 (grupo 900);
 * `sinais` guarda cada sinal mandado e `mortos` são grupos que já terminaram.
 */
function registroFalso(listagens: ProcessoNaArvore[][]): {
  registro: RegistroDeProcessos;
  sinais: string[];
  leituras: () => number;
  mortos: Set<number>;
} {
  const sinais: string[] = [];
  const mortos = new Set<number>();
  let leituras = 0;
  const registro = new RegistroDeProcessos(null, {
    listar: () => {
      const arvore = listagens[Math.min(leituras, listagens.length - 1)] ?? [];
      leituras += 1;
      return Promise.resolve(arvore);
    },
    sinalizar: (grupo, sinal) => {
      if (mortos.has(grupo)) {
        return false;
      }
      sinais.push(`${sinal} ${grupo}`);
      return true;
    },
    protegidos: [900],
  });
  return { registro, sinais, leituras: () => leituras, mortos };
}

const SERVIDOR = noDaArvore(900, 1, 900);
const CLAUDE = noDaArvore(100, 900, 100);
const agente = { pid: 100, orquestradorId: "o1", sessaoId: "s1", iniciadoEm: new Date().toISOString() };

describe("congelamento dos grupos dos descendentes (ADR-51)", () => {
  it("congela o grupo do claude primeiro e depois cada grupo próprio dos descendentes, e descongela os descendentes antes", async () => {
    const arvore = [
      SERVIDOR,
      CLAUDE,
      noDaArvore(101, 100, 100), // subagente no grupo do claude: já congelado com ele
      noDaArvore(110, 100, 110), // shell do Bash em sessão própria
      noDaArvore(111, 110, 110), // comando do shell, no grupo do shell
      noDaArvore(120, 100, 120), // outro shell
      noDaArvore(130, 100, 900), // num grupo do servidor: nunca
      noDaArvore(140, 100, 1), // grupo 1: nunca
      noDaArvore(150, 100, 0), // grupo 0: nunca
      noDaArvore(200, 900, 200), // fora da árvore do claude
    ];
    const { registro, sinais, leituras } = registroFalso([arvore]);
    registro.registrar(agente);

    expect(registro.congelar("o1")).toBe(true);
    expect(sinais).toEqual(["SIGSTOP 100"]);
    await vi.waitFor(() => expect(leituras()).toBe(2));
    expect(sinais).toEqual(["SIGSTOP 100", "SIGSTOP 110", "SIGSTOP 120"]);

    sinais.length = 0;
    expect(registro.descongelar("o1")).toBe(true);
    expect(sinais).toEqual(["SIGCONT 110", "SIGCONT 120", "SIGCONT 100"]);
  });

  it("relê a árvore enquanto aparecer grupo novo, até o limite de voltas", async () => {
    // Cada leitura mostra um shell novo em grupo próprio: a busca para no limite.
    const listagens = Array.from({ length: VOLTAS_DA_BUSCA_DE_GRUPOS + 3 }, (_, volta) => [
      SERVIDOR,
      CLAUDE,
      ...Array.from({ length: volta + 1 }, (_, i) => noDaArvore(300 + i, 100, 300 + i)),
    ]);
    const { registro, sinais, leituras } = registroFalso(listagens);
    registro.registrar(agente);

    registro.congelar("o1");
    await vi.waitFor(() => expect(leituras()).toBe(VOLTAS_DA_BUSCA_DE_GRUPOS));
    await new Promise((resolver) => setTimeout(resolver, 20));
    expect(leituras()).toBe(VOLTAS_DA_BUSCA_DE_GRUPOS);
    expect(sinais.filter((sinal) => sinal.startsWith("SIGSTOP"))).toHaveLength(1 + VOLTAS_DA_BUSCA_DE_GRUPOS);
  });

  it("grupo que já terminou e leitura que falha não quebram nada", async () => {
    const arvore = [SERVIDOR, CLAUDE, noDaArvore(110, 100, 110), noDaArvore(120, 100, 120)];
    const { registro, sinais, leituras, mortos } = registroFalso([arvore]);
    mortos.add(110);
    registro.registrar(agente);
    registro.congelar("o1");
    await vi.waitFor(() => expect(leituras()).toBe(2));
    expect(sinais).toEqual(["SIGSTOP 100", "SIGSTOP 120"]);
    mortos.add(120);
    expect(registro.descongelar("o1")).toBe(true);
    expect(sinais).toEqual(["SIGSTOP 100", "SIGSTOP 120", "SIGCONT 100"]);

    const aviso = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const quebrado = new RegistroDeProcessos(null, {
      listar: () => Promise.reject(new Error("ps falhou")),
      sinalizar: () => true,
      protegidos: [900],
    });
    quebrado.registrar(agente);
    expect(quebrado.congelar("o1")).toBe(true);
    await vi.waitFor(() => expect(aviso).toHaveBeenCalled());
    expect(quebrado.descongelar("o1")).toBe(true);
    aviso.mockRestore();
  });

  it("descongelado durante a leitura, não congela mais nada", async () => {
    const arvore = [SERVIDOR, CLAUDE, noDaArvore(110, 100, 110)];
    const { registro, sinais, leituras } = registroFalso([arvore]);
    registro.registrar(agente);
    registro.congelar("o1");
    registro.descongelar("o1");
    await vi.waitFor(() => expect(leituras()).toBe(1));
    await new Promise((resolver) => setTimeout(resolver, 20));
    expect(sinais).toEqual(["SIGSTOP 100", "SIGCONT 100"]);
  });

  it("um agente que nasce durante a pausa congela com os descendentes dele", async () => {
    const arvore = [SERVIDOR, CLAUDE, noDaArvore(500, 900, 500), noDaArvore(510, 500, 510)];
    const { registro, sinais } = registroFalso([arvore]);
    registro.registrar(agente);
    registro.congelar("o1");
    registro.registrar({ ...agente, pid: 500, sessaoId: "s2" });
    await vi.waitFor(() => expect(sinais).toContain("SIGSTOP 510"));
    sinais.length = 0;
    registro.descongelar("o1");
    expect(sinais).toEqual(["SIGCONT 510", "SIGCONT 100", "SIGCONT 500"]);
  });

  it("sem sinal (Windows) a pausa vira retomada e a árvore nem é lida", () => {
    const leituras = vi.fn(() => Promise.resolve([] as ProcessoNaArvore[]));
    const registro = new RegistroDeProcessos(null, { listar: leituras, sinalizar: () => false, protegidos: [900] });
    registro.registrar(agente);
    expect(registro.congelar("o1")).toBe(false);
    expect(registro.descongelar("o1")).toBe(false);
    expect(leituras).not.toHaveBeenCalled();
  });
});
