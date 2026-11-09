import { describe, expect, it } from "vitest";

import {
  descendentesVivos,
  formasDaPasta,
  lerArvoreDoPs,
  lerArvoreDoWindows,
  mesmoProcesso,
  ProcessoNaArvore,
} from "./ArvoreDeProcessos";

const T0 = Date.parse("2026-11-09T10:00:00.000Z");
const PASTA = "C:\\Users\\eu\\dados\\worktrees\\abc12345";

function processo(pid: number, ppid: number, segundos: number, comando = `proc-${pid}`): ProcessoNaArvore {
  return { pid, ppid, criadoEm: T0 + segundos * 1000, nome: comando.split(" ")[0] ?? "", comando, grupo: null };
}

const CLAUDE = processo(100, 1, 0, "claude.exe -p --input-format stream-json");

describe("lerArvoreDoWindows", () => {
  it("lê a lista do Get-CimInstance, ignorando quem não tem data de criação", () => {
    const json = JSON.stringify([
      { p: 4, pp: 0, c: "", n: "System", l: null },
      { p: 100, pp: 50, c: "2026-11-09T10:00:00.0000000Z", n: "claude.exe", l: "claude.exe -p" },
      { p: 200, pp: 100, c: "2026-11-09T10:00:05.1230000Z", n: "node.exe", l: null },
    ]);

    expect(lerArvoreDoWindows(json)).toEqual([
      { pid: 100, ppid: 50, criadoEm: T0, nome: "claude.exe", comando: "claude.exe -p", grupo: null },
      { pid: 200, ppid: 100, criadoEm: T0 + 5_123, nome: "node.exe", comando: "", grupo: null },
    ]);
  });

  it("aceita um objeto só (o ConvertTo-Json não faz lista de um item) e saída inválida", () => {
    expect(lerArvoreDoWindows('{"p":7,"pp":1,"c":"2026-11-09T10:00:00Z","n":"a.exe","l":"a"}')).toHaveLength(1);
    expect(lerArvoreDoWindows("")).toEqual([]);
    expect(lerArvoreDoWindows("erro do powershell")).toEqual([]);
  });
});

describe("lerArvoreDoPs", () => {
  it("lê pid, ppid, grupo e calcula a criação pelo etime", () => {
    const saida = ["  100     1   100    01:00 /usr/bin/claude -p", "  200   100   100    00:10 node /app/vite.js", "lixo"].join(
      "\n",
    );

    expect(lerArvoreDoPs(saida, T0 + 60_000)).toEqual([
      { pid: 100, ppid: 1, criadoEm: T0, nome: "claude", comando: "/usr/bin/claude -p", grupo: 100 },
      { pid: 200, ppid: 100, criadoEm: T0 + 50_000, nome: "node", comando: "node /app/vite.js", grupo: 100 },
    ]);
  });
});

describe("mesmoProcesso", () => {
  it("só é o mesmo com o mesmo pid, a mesma criação (com folga) e a mesma linha de comando", () => {
    const original = processo(300, 100, 10, "node vite.js");
    expect(mesmoProcesso(original, { ...original, criadoEm: original.criadoEm + 1_000 })).toBe(true);
    expect(mesmoProcesso(original, { ...original, criadoEm: original.criadoEm + 60_000 })).toBe(false);
    expect(mesmoProcesso(original, { ...original, comando: "notepad.exe" })).toBe(false);
  });
});

describe("formasDaPasta", () => {
  it("dá a forma do Windows e a do Git Bash, e recusa pastas curtas demais", () => {
    expect(formasDaPasta(PASTA, "C:\\Users\\eu")).toEqual([
      "c:/users/eu/dados/worktrees/abc12345",
      "/c/users/eu/dados/worktrees/abc12345",
    ]);
    expect(formasDaPasta("C:\\", "C:\\Users\\eu")).toBeNull();
    expect(formasDaPasta("C:\\Users\\eu", "C:\\Users\\eu")).toBeNull();
    expect(formasDaPasta("/home/eu/projetos/app", "/home/eu")).toEqual(["/home/eu/projetos/app"]);
  });
});

describe("descendentesVivos", () => {
  const base = { raiz: CLAUDE, vistos: [], protegidos: new Set<number>(), adocao: null };

  it("segue a árvore pelo ppid a partir do Claude Code", () => {
    const arvore = [CLAUDE, processo(200, 100, 5), processo(201, 200, 6), processo(999, 1, 3)];

    expect(descendentesVivos({ ...base, arvore }).map((p) => p.pid).sort()).toEqual([200, 201]);
  });

  it("liga o filho ao pai intermediário que já morreu, se ele foi visto numa listagem anterior", () => {
    const bashDoNohup = processo(200, 100, 5, "bash -c nohup npm run dev &");
    const servidorDeDev = processo(300, 200, 6, "node vite.js");
    // Listagem atual: o Claude e o bash já saíram; só o servidor ficou.
    const arvore = [servidorDeDev];

    expect(descendentesVivos({ ...base, arvore, vistos: [bashDoNohup] }).map((p) => p.pid)).toEqual([300]);
    expect(descendentesVivos({ ...base, arvore, vistos: [] })).toEqual([]);
  });

  it("não segue um ppid que aponta para um PID reaproveitado por outro processo", () => {
    // O pai visto (pid 200) morreu e o pid foi reaproveitado por um programa
    // do usuário, que abriu um filho: esse filho não é do turno.
    const paiVisto = processo(200, 100, 5, "bash");
    const reaproveitado = processo(200, 1, 30, "explorer-filho.exe");
    const filhoDoOutro = processo(400, 200, 31, "notepad.exe");

    expect(descendentesVivos({ ...base, arvore: [reaproveitado, filhoDoOutro], vistos: [paiVisto] })).toEqual([]);
  });

  it("não segue um filho mais velho que o pai (ppid antigo que coincide com o pid)", () => {
    const antigo = processo(500, 100, -3600, "servico-antigo.exe");

    expect(descendentesVivos({ ...base, arvore: [CLAUDE, antigo] })).toEqual([]);
  });

  it("nunca inclui pids protegidos nem passa por eles", () => {
    const arvore = [CLAUDE, processo(200, 100, 5), processo(201, 200, 6)];

    expect(descendentesVivos({ ...base, arvore, protegidos: new Set([200]) })).toEqual([]);
  });

  it("no Mac/Linux, liga pelo grupo do Claude Code mesmo com o pai morto e não visto", () => {
    const raiz = { ...CLAUDE, grupo: 100 };
    const orfao = { ...processo(300, 1, 6, "node vite.js"), grupo: 100 };

    expect(descendentesVivos({ ...base, raiz, arvore: [orfao] }).map((p) => p.pid)).toEqual([300]);
  });

  describe("adoção de quem perdeu o pai sem ser visto", () => {
    const adocao = { formasDaPasta: formasDaPasta(PASTA, "C:\\Users\\eu") ?? [], ate: T0 + 120_000 };
    const npm = processo(300, 250, 10, '"C:\\Program Files\\nodejs\\node.exe" npm-cli.js run dev');
    const cmd = processo(301, 300, 11, "cmd.exe /d /s /c vite");
    const vite = processo(302, 301, 12, `node "${PASTA}\\node_modules\\vite\\bin\\vite.js"`);

    it("adota a árvore inteira quando algum membro cita a pasta do turno", () => {
      const achados = descendentesVivos({ ...base, arvore: [npm, cmd, vite], adocao });

      expect(achados.map((p) => p.pid).sort()).toEqual([300, 301, 302]);
    });

    it("não adota sem citar a pasta, nascido fora do turno ou filho de um terminal do canvas", () => {
      const semPasta = processo(600, 250, 10, "notepad.exe");
      const antesDoTurno = { ...vite, pid: 700, ppid: 650, criadoEm: T0 - 60_000 };
      const shellDoCanvas = processo(800, 1, -10, "pwsh.exe");
      const doTerminal = { ...vite, pid: 801, ppid: 800 };

      expect(
        descendentesVivos({
          ...base,
          arvore: [semPasta, antesDoTurno, doTerminal],
          adocao,
          alheios: [shellDoCanvas],
        }),
      ).toEqual([]);
    });

    it("não adota quem ainda tem o pai vivo fora do turno", () => {
      const pai = processo(250, 1, -100, "explorer.exe");

      expect(descendentesVivos({ ...base, arvore: [pai, npm, cmd, vite], adocao })).toEqual([]);
    });
  });
});
