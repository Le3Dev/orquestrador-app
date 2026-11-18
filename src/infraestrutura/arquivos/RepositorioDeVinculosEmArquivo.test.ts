import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Vinculo } from "../../vinculos/Vinculo";
import { RepositorioDeVinculosEmArquivo } from "./RepositorioDeVinculosEmArquivo";

const agora = new Date("2026-11-14T10:00:00Z");

function novo(id: string, minutos = 0): Vinculo {
  return Vinculo.criar({
    id,
    orquestradorAId: `a-${id}`,
    orquestradorBId: `b-${id}`,
    agora: new Date(agora.getTime() + minutos * 60_000),
  });
}

describe("RepositorioDeVinculosEmArquivo", () => {
  let pasta: string;
  let pastaDosVinculos: string;

  beforeEach(async () => {
    pasta = await mkdtemp(path.join(tmpdir(), "repositorio-vinculos-teste-"));
    pastaDosVinculos = path.join(pasta, "vinculos");
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(pasta, { recursive: true, force: true });
  });

  it("cria a pasta e começa vazio", async () => {
    const repositorio = await RepositorioDeVinculosEmArquivo.abrir(pasta);

    expect(repositorio.todos()).toEqual([]);
    expect(await readdir(pastaDosVinculos)).toEqual([]);
  });

  it("salva um vínculo por arquivo e reabre exatamente como ficou", async () => {
    const repositorio = await RepositorioDeVinculosEmArquivo.abrir(pasta);
    const vinculo = novo("v1");
    vinculo.reescreverNotas("contrato", new Date("2026-11-14T12:00:00Z"));
    await repositorio.salvar(vinculo);

    const reaberto = await RepositorioDeVinculosEmArquivo.abrir(pasta);

    expect(await readdir(pastaDosVinculos)).toEqual(["v1.json"]);
    expect(reaberto.buscar("v1")?.paraDados()).toEqual(vinculo.paraDados());
    expect(JSON.parse(await readFile(path.join(pastaDosVinculos, "v1.json"), "utf8"))).toEqual(vinculo.paraDados());
  });

  it("lista em ordem de criação", async () => {
    const repositorio = await RepositorioDeVinculosEmArquivo.abrir(pasta);
    await repositorio.salvar(novo("c", 2));
    await repositorio.salvar(novo("a", 0));
    await repositorio.salvar(novo("b", 1));

    expect(repositorio.todos().map((v) => v.id)).toEqual(["a", "b", "c"]);
    expect((await RepositorioDeVinculosEmArquivo.abrir(pasta)).todos().map((v) => v.id)).toEqual(["a", "b", "c"]);
  });

  it("devolve cópias: alterar o que foi buscado não muda o repositório até salvar", async () => {
    const repositorio = await RepositorioDeVinculosEmArquivo.abrir(pasta);
    await repositorio.salvar(novo("v1"));

    repositorio.buscar("v1")?.reescreverNotas("x", agora);

    expect(repositorio.buscar("v1")?.notas).toBe("");
  });

  it("remove o arquivo e o vínculo some ao reabrir", async () => {
    const repositorio = await RepositorioDeVinculosEmArquivo.abrir(pasta);
    await repositorio.salvar(novo("v1"));
    await repositorio.remover("v1");

    expect(repositorio.buscar("v1")).toBeNull();
    expect(await readdir(pastaDosVinculos)).toEqual([]);
    expect((await RepositorioDeVinculosEmArquivo.abrir(pasta)).todos()).toEqual([]);
  });

  it("a última edição seguida vence", async () => {
    const repositorio = await RepositorioDeVinculosEmArquivo.abrir(pasta);
    const vinculo = novo("v1");
    await repositorio.salvar(vinculo);
    vinculo.reescreverNotas("primeira", new Date("2026-11-14T11:00:00Z"));
    const primeira = repositorio.salvar(vinculo);
    vinculo.reescreverNotas("segunda", new Date("2026-11-14T12:00:00Z"));
    const segunda = repositorio.salvar(vinculo);
    await Promise.all([primeira, segunda]);

    expect((await RepositorioDeVinculosEmArquivo.abrir(pasta)).buscar("v1")?.notas).toBe("segunda");
  });

  it("pula arquivo ilegível, nome que não bate e JSON fora do formato, mantendo os arquivos", async () => {
    const repositorio = await RepositorioDeVinculosEmArquivo.abrir(pasta);
    await repositorio.salvar(novo("bom"));
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await writeFile(path.join(pastaDosVinculos, "quebrado.json"), "{nao e json", "utf8");
    await writeFile(path.join(pastaDosVinculos, "outro.json"), JSON.stringify(novo("diferente").paraDados()), "utf8");
    await writeFile(path.join(pastaDosVinculos, "formato.json"), JSON.stringify({ id: "formato" }), "utf8");

    const reaberto = await RepositorioDeVinculosEmArquivo.abrir(pasta);

    expect(reaberto.todos().map((v) => v.id)).toEqual(["bom"]);
    expect(aviso).toHaveBeenCalledTimes(3);
    expect((await readdir(pastaDosVinculos)).sort()).toEqual(["bom.json", "formato.json", "outro.json", "quebrado.json"]);
  });

  it("recusa identidade que escaparia da pasta", async () => {
    const repositorio = await RepositorioDeVinculosEmArquivo.abrir(pasta);

    expect(() => repositorio.salvar(novo("..\\fora"))).toThrow(/inválida/);
  });
});
