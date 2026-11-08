import { appendFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { slugDaPasta } from "../claudecode/TranscricoesDoClaudeCode";
import { DiagnosticadorDoClaudeNoSistema, encurtarComando } from "./DiagnosticadorDoClaudeNoSistema";
import { ProcessoListado } from "./Processos";
import { RegistroDeProcessos } from "./RegistroDeProcessos";

const ALVO = { orquestradorId: "o1", sessaoId: "sessao-1", pastaDoTurno: "/projetos/painel/.worktrees/o1" };

const PROCESSOS: ProcessoListado[] = [
  { pid: 1, ppid: 0, cpu: 0.2, haMs: 1e9, comando: "/sbin/launchd" },
  { pid: 100, ppid: 50, cpu: 3.5, haMs: 600_000, comando: "/usr/local/bin/claude -p --resume sessao-1" },
  { pid: 200, ppid: 100, cpu: 0.1, haMs: 120_000, comando: "/bin/zsh -c npm test" },
  { pid: 300, ppid: 200, cpu: 95, haMs: 110_000, comando: "node /projetos/painel/node_modules/.bin/vitest run" },
  { pid: 400, ppid: 1, cpu: 50, haMs: 5_000, comando: "outro programa" },
];

describe("DiagnosticadorDoClaudeNoSistema", () => {
  let pastaDoClaude: string;
  let pastaDaSessao: string;
  let registro: RegistroDeProcessos;

  beforeEach(async () => {
    pastaDoClaude = await mkdtemp(path.join(tmpdir(), "diagnostico-"));
    pastaDaSessao = path.join(pastaDoClaude, "projects", slugDaPasta(ALVO.pastaDoTurno));
    registro = new RegistroDeProcessos();
    registro.registrar({ pid: 100, orquestradorId: "o1", sessaoId: "sessao-1", iniciadoEm: "2026-11-08T10:00:00.000Z" });
    registro.registrar({ pid: 999, orquestradorId: "o2", sessaoId: "sessao-2", iniciadoEm: "2026-11-08T10:00:00.000Z" });
  });

  afterEach(async () => {
    await rm(pastaDoClaude, { recursive: true, force: true });
  });

  async function gravarTranscricoes(): Promise<void> {
    await mkdir(path.join(pastaDaSessao, "sessao-1", "subagents"), { recursive: true });
    await writeFile(path.join(pastaDaSessao, "sessao-1.jsonl"), '{"type":"user"}\n');
    await writeFile(path.join(pastaDaSessao, "sessao-1", "subagents", "agent-a1.jsonl"), '{"type":"user"}\n');
  }

  it("acha o Claude do Orquestrador, a CPU dele e os descendentes do mais ocupado ao menos", async () => {
    const diagnosticador = new DiagnosticadorDoClaudeNoSistema(registro, {
      listarProcessos: async () => PROCESSOS,
      pastaDoClaude,
    });

    const diagnostico = await diagnosticador.diagnosticar(ALVO);

    expect(diagnostico.processoVivo).toBe(true);
    expect(diagnostico.processosConhecidos).toBe(true);
    expect(diagnostico.cpuDoClaude).toBe(3.5);
    expect(diagnostico.filhos).toEqual([
      { pid: 300, comando: "node vitest run", cpu: 95, haMs: 110_000 },
      { pid: 200, comando: "zsh -c npm test", cpu: 0.1, haMs: 120_000 },
    ]);
  });

  it("transcrições: no primeiro diagnóstico vale a escrita recente; depois, a mudança desde o anterior", async () => {
    await gravarTranscricoes();
    let agora = Date.now();
    const diagnosticador = new DiagnosticadorDoClaudeNoSistema(registro, {
      listarProcessos: async () => PROCESSOS,
      pastaDoClaude,
      agora: () => agora,
    });

    const primeiro = await diagnosticador.diagnosticar(ALVO);
    expect(primeiro.transcricoesCrescendo).toBe(true);
    expect(primeiro.ultimaEscritaEm).not.toBeNull();

    const semMudanca = await diagnosticador.diagnosticar(ALVO);
    expect(semMudanca.transcricoesCrescendo).toBe(false);

    await appendFile(path.join(pastaDaSessao, "sessao-1", "subagents", "agent-a1.jsonl"), '{"type":"assistant"}\n');
    expect((await diagnosticador.diagnosticar(ALVO)).transcricoesCrescendo).toBe(true);

    // Um subagente novo também conta.
    await writeFile(path.join(pastaDaSessao, "sessao-1", "subagents", "agent-b2.jsonl"), "{}\n");
    expect((await diagnosticador.diagnosticar(ALVO)).transcricoesCrescendo).toBe(true);

    // Esquecido o alvo, volta a valer a escrita recente: dois minutos depois, não é recente.
    diagnosticador.esquecer("o1");
    agora += 120_000;
    expect((await diagnosticador.diagnosticar(ALVO)).transcricoesCrescendo).toBe(false);
  });

  it("acha a sessão mesmo se o slug não bater com a pasta (procura em todos os projetos)", async () => {
    pastaDaSessao = path.join(pastaDoClaude, "projects", "outro-slug");
    await gravarTranscricoes();
    const diagnosticador = new DiagnosticadorDoClaudeNoSistema(registro, { listarProcessos: async () => [], pastaDoClaude });

    expect((await diagnosticador.diagnosticar(ALVO)).ultimaEscritaEm).not.toBeNull();
  });

  it("nunca lança: sem ps, sem transcrições e sem processo, devolve valores neutros", async () => {
    const diagnosticador = new DiagnosticadorDoClaudeNoSistema(registro, {
      listarProcessos: () => Promise.reject(new Error("ps sumiu")),
      pastaDoClaude: path.join(pastaDoClaude, "nao-existe"),
      processoExiste: () => {
        throw new Error("falhou");
      },
    });

    await expect(diagnosticador.diagnosticar(ALVO)).resolves.toEqual({
      processoVivo: false,
      processosConhecidos: true,
      cpuDoClaude: 0,
      filhos: [],
      transcricoesCrescendo: false,
      ultimaEscritaEm: null,
    });
  });

  it("sem ps, decide se o processo vive pelo sinal 0", async () => {
    const diagnosticador = new DiagnosticadorDoClaudeNoSistema(registro, {
      listarProcessos: async () => [],
      pastaDoClaude,
      processoExiste: (pid) => pid === 100,
    });

    expect((await diagnosticador.diagnosticar(ALVO)).processoVivo).toBe(true);
  });

  it("sem lista de processos no sistema (Windows), diz que não os conhece e decide a vida pelo sinal 0", async () => {
    const diagnosticador = new DiagnosticadorDoClaudeNoSistema(registro, {
      listarProcessos: async () => null,
      pastaDoClaude,
      processoExiste: (pid) => pid === 100,
    });

    expect(await diagnosticador.diagnosticar(ALVO)).toMatchObject({
      processoVivo: true,
      processosConhecidos: false,
      cpuDoClaude: 0,
      filhos: [],
    });
  });

  it("um Orquestrador sem processo registrado não está vivo", async () => {
    const diagnosticador = new DiagnosticadorDoClaudeNoSistema(registro, {
      listarProcessos: async () => PROCESSOS,
      pastaDoClaude,
    });

    const diagnostico = await diagnosticador.diagnosticar({ ...ALVO, orquestradorId: "o3" });

    expect(diagnostico).toMatchObject({ processoVivo: false, cpuDoClaude: 0, filhos: [] });
  });
});

describe("encurtarComando", () => {
  it("troca caminhos absolutos e de node_modules pelo nome e corta em ~80 caracteres", () => {
    expect(encurtarComando("/usr/bin/node /a/b/node_modules/vite/bin/vite.js --port 5173")).toBe("node vite.js --port 5173");
    expect(encurtarComando("npm run dev")).toBe("npm run dev");
    const longo = encurtarComando(`grep -r ${"x".repeat(200)} src`);
    expect(longo).toHaveLength(80);
    expect(longo.endsWith("…")).toBe(true);
  });
});
