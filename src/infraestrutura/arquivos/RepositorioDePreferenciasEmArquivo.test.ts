import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PreferenciasGlobais } from "../../orquestracao/PreferenciasGlobais";
import { RepositorioDePreferenciasEmArquivo } from "./RepositorioDePreferenciasEmArquivo";

describe("RepositorioDePreferenciasEmArquivo", () => {
  let pasta: string;

  beforeEach(async () => {
    pasta = await mkdtemp(path.join(tmpdir(), "preferencias-teste-"));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(pasta, { recursive: true, force: true });
  });

  it("sem arquivo, abre com as preferências vazias e não cria nada", async () => {
    const repositorio = await RepositorioDePreferenciasEmArquivo.abrir(pasta);

    expect(repositorio.atuais().paraDados()).toEqual({ instrucoesPadrao: "", subagentesProntos: [], autorrecuperacao: true });
    expect(existsSync(path.join(pasta, "preferencias.json"))).toBe(false);
  });

  it("salva, vale na hora e reabre igual", async () => {
    const repositorio = await RepositorioDePreferenciasEmArquivo.abrir(pasta);
    const revisor = { nome: "revisor", descricao: "Revisa código.", prompt: "Aponte bugs.", modelo: "sonnet" as const };
    await repositorio.salvar(
      PreferenciasGlobais.de({
        instrucoesPadrao: "Linha 1\nLinha 2 com \"aspas\" e {{x}}",
        subagentesProntos: [revisor],
      }),
    );

    expect(repositorio.atuais().instrucoesPadrao).toBe('Linha 1\nLinha 2 com "aspas" e {{x}}');
    const reaberto = await RepositorioDePreferenciasEmArquivo.abrir(pasta);
    expect(reaberto.atuais().paraDados()).toEqual(repositorio.atuais().paraDados());
    expect(JSON.parse(await readFile(path.join(pasta, "preferencias.json"), "utf8"))).toEqual({
      instrucoesPadrao: 'Linha 1\nLinha 2 com "aspas" e {{x}}',
      subagentesProntos: [revisor],
      autorrecuperacao: true,
    });
  });

  it("gravações seguidas chegam ao disco na ordem: a última vence", async () => {
    const repositorio = await RepositorioDePreferenciasEmArquivo.abrir(pasta);
    await Promise.all([
      repositorio.salvar(PreferenciasGlobais.de({ instrucoesPadrao: "primeira" })),
      repositorio.salvar(PreferenciasGlobais.de({ instrucoesPadrao: "segunda" })),
    ]);

    const reaberto = await RepositorioDePreferenciasEmArquivo.abrir(pasta);
    expect(reaberto.atuais().instrucoesPadrao).toBe("segunda");
  });

  it("arquivo ilegível é guardado à parte, sem derrubar a abertura", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await writeFile(path.join(pasta, "preferencias.json"), "{ isto não é json", "utf8");

    const repositorio = await RepositorioDePreferenciasEmArquivo.abrir(pasta);

    expect(repositorio.atuais().instrucoesPadrao).toBe("");
    expect(await readFile(path.join(pasta, "preferencias.ilegivel.json"), "utf8")).toBe("{ isto não é json");
    expect(existsSync(path.join(pasta, "preferencias.json"))).toBe(false);
  });
});
