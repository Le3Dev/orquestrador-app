import { spawn } from "node:child_process";

import { describe, expect, it } from "vitest";

import { encerrarArvore } from "./Processos";
import { RegistroDeProcessos } from "./RegistroDeProcessos";

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

describe.skipIf(process.platform === "win32")("congelamento real de um grupo de processos (ADR-49)", () => {
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
});
