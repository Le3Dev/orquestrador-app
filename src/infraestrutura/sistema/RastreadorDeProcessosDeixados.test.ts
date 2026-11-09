import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ProcessoNaArvore } from "./ArvoreDeProcessos";
import { RastreadorDeProcessosDeixados } from "./RastreadorDeProcessosDeixados";
import { RegistroDeProcessos } from "./RegistroDeProcessos";
import { RegistroDeProcessosDeixados } from "./RegistroDeProcessosDeixados";

const T0 = Date.parse("2026-11-09T10:00:00.000Z");
const PASTA = "C:\\Users\\eu\\dados\\worktrees\\abc12345";

function processo(pid: number, ppid: number, segundos: number, comando = `proc-${pid}`): ProcessoNaArvore {
  return { pid, ppid, criadoEm: T0 + segundos * 1000, nome: "", comando, grupo: null };
}

/** Máquina de mentira: a listagem devolve `arvore`, e encerrar tira o pid dela. */
class MaquinaFalsa {
  arvore: ProcessoNaArvore[] = [];
  encerrados: number[] = [];
  listagens = 0;
  falhar = false;

  listar = async (): Promise<ProcessoNaArvore[]> => {
    this.listagens += 1;
    if (this.falhar) {
      throw new Error("powershell sumiu");
    }
    return [...this.arvore];
  };

  encerrar = async (pid: number): Promise<void> => {
    this.encerrados.push(pid);
    this.arvore = this.arvore.filter((processo) => processo.pid !== pid);
  };
}

describe("RastreadorDeProcessosDeixados", () => {
  let maquina: MaquinaFalsa;
  let deixados: RegistroDeProcessosDeixados;
  let agentes: RegistroDeProcessos;
  let agora: number;

  function criar(registro = deixados): RastreadorDeProcessosDeixados {
    return new RastreadorDeProcessosDeixados({
      deixados: registro,
      agentes,
      listar: maquina.listar,
      encerrar: maquina.encerrar,
      protegidos: [1, 2],
      pastaDoUsuario: "C:\\Users\\eu",
      intervaloMs: 60_000,
      esperaDaListagemFinalMs: 0,
      agora: () => agora,
      esperar: async () => undefined,
    });
  }

  /** Um turno: o Claude Code (pid) nasce, abre um bash que sobe um servidor e sai. */
  async function turnoQueDeixaUmServidor(
    rastreador: RastreadorDeProcessosDeixados,
    claude: number,
    orquestradorId: string,
    segundos: number,
  ): Promise<ProcessoNaArvore> {
    const raiz = processo(claude, 1, segundos, "claude.exe -p");
    const bash = processo(claude + 1, claude, segundos + 1, "bash -c nohup npm run dev &");
    const servidor = processo(claude + 2, claude + 1, segundos + 2, "node vite.js");
    agentes.registrar({ pid: claude, orquestradorId, sessaoId: `s-${claude}`, iniciadoEm: "" });
    agora = T0 + segundos * 1000;
    rastreador.iniciou({ pid: claude, orquestradorId, pasta: PASTA });
    // Listagem no `result`: o bash ainda está vivo.
    maquina.arvore.push(raiz, bash, servidor);
    agora += 30_000;
    await rastreador.listarAgora();
    // O bash e o Claude saem; o servidor fica, com o pai morto.
    maquina.arvore = maquina.arvore.filter((p) => p.pid !== claude && p.pid !== claude + 1);
    agentes.remover(claude);
    await rastreador.finalizar(claude);
    return servidor;
  }

  beforeEach(() => {
    maquina = new MaquinaFalsa();
    deixados = new RegistroDeProcessosDeixados();
    agentes = new RegistroDeProcessos();
    agora = T0;
  });

  it("registra, ligado ao Orquestrador, o que sobreviveu ao turno mesmo com o pai intermediário morto", async () => {
    const rastreador = criar();

    const servidor = await turnoQueDeixaUmServidor(rastreador, 100, "orq-1", 0);

    expect(deixados.todos()).toEqual([
      { pid: servidor.pid, criadoEm: servidor.criadoEm, nome: "", comando: "node vite.js", orquestradorId: "orq-1" },
    ]);
    expect(rastreador.pidsPorOrquestrador()).toEqual(new Map([["orq-1", new Set([servidor.pid])]]));
  });

  it("ao remover o Orquestrador, encerra só os processos dele (e o que eles abriram depois)", async () => {
    const rastreador = criar();
    const doUm = await turnoQueDeixaUmServidor(rastreador, 100, "orq-1", 0);
    const doOutro = await turnoQueDeixaUmServidor(rastreador, 200, "orq-2", 100);
    const netoNovo = processo(150, doUm.pid, 300, "esbuild --service");
    maquina.arvore.push(netoNovo);

    expect(await rastreador.encerrarDoOrquestrador("orq-1")).toBe(2);

    expect(maquina.encerrados.sort()).toEqual([doUm.pid, netoNovo.pid].sort());
    expect(deixados.todos().map((p) => p.orquestradorId)).toEqual(["orq-2"]);
    expect(maquina.arvore.map((p) => p.pid)).toEqual([doOutro.pid]);
  });

  it("não encerra um pid reaproveitado (criação diferente) nem um protegido", async () => {
    deixados.registrar([
      { pid: 300, criadoEm: T0, nome: "node.exe", comando: "node vite.js", orquestradorId: "orq-1" },
      { pid: 2, criadoEm: T0, nome: "electron.exe", comando: "electron", orquestradorId: "orq-1" },
    ]);
    maquina.arvore = [processo(300, 1, 3600, "node vite.js"), processo(2, 1, 0, "electron")];
    const rastreador = criar();

    expect(await rastreador.encerrarTodos()).toBe(0);
    expect(maquina.encerrados).toEqual([]);
    expect(deixados.todos()).toEqual([]);
  });

  it("nunca encerra o Claude Code de outro turno em andamento", async () => {
    deixados.registrar([{ pid: 500, criadoEm: T0, nome: "", comando: "proc-500", orquestradorId: "orq-1" }]);
    agentes.registrar({ pid: 501, orquestradorId: "orq-2", sessaoId: "s", iniciadoEm: "" });
    // O Claude do outro turno aparece como "filho" (ppid coincidente) do deixado.
    maquina.arvore = [processo(500, 1, 0), processo(501, 500, 10, "claude.exe -p")];

    expect(await criar().encerrarTodos()).toBe(1);
    expect(maquina.encerrados).toEqual([500]);
  });

  it("sem conseguir listar, não encerra nada (não dá para conferir os pids)", async () => {
    deixados.registrar([{ pid: 500, criadoEm: T0, nome: "", comando: "proc-500", orquestradorId: "orq-1" }]);
    maquina.arvore = [processo(500, 1, 0)];
    maquina.falhar = true;

    expect(await criar().encerrarDoOrquestrador("orq-1")).toBe(0);
    expect(maquina.encerrados).toEqual([]);
    expect(deixados.todos()).toHaveLength(1);
  });

  it("sem nada registrado, nem lista (a subida do servidor não paga o PowerShell)", async () => {
    expect(await criar().encerrarTodos()).toBe(0);
    expect(maquina.listagens).toBe(0);
  });

  it("tira do registro os que morreram sozinhos na listagem seguinte", async () => {
    const rastreador = criar();
    await turnoQueDeixaUmServidor(rastreador, 100, "orq-1", 0);
    maquina.arvore = [processo(900, 1, 0)];

    await rastreador.listarAgora();

    expect(deixados.todos()).toEqual([]);
  });

  it("removido o Orquestrador enquanto o turno terminava, encerra em vez de registrar", async () => {
    const rastreador = criar();
    agentes.registrar({ pid: 100, orquestradorId: "orq-1", sessaoId: "s", iniciadoEm: "" });
    rastreador.iniciou({ pid: 100, orquestradorId: "orq-1", pasta: PASTA });
    maquina.arvore = [processo(100, 1, 0, "claude.exe -p"), processo(101, 100, 1)];
    await rastreador.listarAgora();

    await rastreador.encerrarDoOrquestrador("orq-1");
    maquina.arvore = [processo(102, 100, 2)];
    agentes.remover(100);
    await rastreador.finalizar(100);

    expect(maquina.encerrados).toEqual([101, 102]);
    expect(deixados.todos()).toEqual([]);
  });

  describe("persistência", () => {
    let pasta: string;

    beforeEach(async () => {
      pasta = await mkdtemp(path.join(tmpdir(), "deixados-"));
    });

    afterEach(async () => {
      await rm(pasta, { recursive: true, force: true });
    });

    it("grava em disco e, na subida seguinte, encerra o que ainda for o mesmo processo", async () => {
      const arquivo = path.join(pasta, "processos-deixados-pelos-agentes.json");
      const servidor = await turnoQueDeixaUmServidor(criar(new RegistroDeProcessosDeixados(arquivo)), 100, "orq-1", 0);
      expect(RegistroDeProcessosDeixados.lerArquivo(arquivo).map((p) => p.pid)).toEqual([servidor.pid]);

      // "Queda": um servidor novo abre o mesmo arquivo.
      const depois = criar(new RegistroDeProcessosDeixados(arquivo));
      expect(await depois.encerrarTodos()).toBe(1);

      expect(maquina.encerrados).toEqual([servidor.pid]);
      expect(RegistroDeProcessosDeixados.lerArquivo(arquivo)).toEqual([]);
    });

    it("lê arquivo ausente ou corrompido como lista vazia", () => {
      expect(RegistroDeProcessosDeixados.lerArquivo(path.join(pasta, "nao-existe.json"))).toEqual([]);
    });
  });
});
