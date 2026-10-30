import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DadosDaNota, Nota } from "../../notas/Nota";
import { RepositorioDeNotasEmArquivo } from "./RepositorioDeNotasEmArquivo";

const agora = new Date("2026-10-30T12:00:00Z");

function novaNota(id: string, minutos = 0): Nota {
  return Nota.criar({ id, titulo: `Nota ${id}`, agora: new Date(agora.getTime() + minutos * 60_000) });
}

describe("RepositorioDeNotasEmArquivo", () => {
  let pasta: string;
  let pastaDasNotas: string;

  beforeEach(async () => {
    pasta = await mkdtemp(path.join(tmpdir(), "repositorio-notas-teste-"));
    pastaDasNotas = path.join(pasta, "notas");
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(pasta, { recursive: true, force: true });
  });

  it("cria a pasta das notas e começa vazio", async () => {
    const repositorio = await RepositorioDeNotasEmArquivo.abrir(pasta);

    expect(repositorio.todas()).toEqual([]);
    expect(await readdir(pastaDasNotas)).toEqual([]);
  });

  it("salva uma nota por arquivo e reabre exatamente como ficou", async () => {
    const repositorio = await RepositorioDeNotasEmArquivo.abrir(pasta);
    const nota = novaNota("a");
    nota.reescrever("lembrar do deploy", new Date("2026-10-30T13:00:00Z"));
    await repositorio.salvar(nota);

    const reaberto = await RepositorioDeNotasEmArquivo.abrir(pasta);

    expect(await readdir(pastaDasNotas)).toEqual(["a.json"]);
    expect(reaberto.buscar("a")?.paraDados()).toEqual(nota.paraDados());
    expect(JSON.parse(await readFile(path.join(pastaDasNotas, "a.json"), "utf8"))).toEqual(nota.paraDados());
  });

  it("lista em ordem de criação, da mais antiga para a mais nova", async () => {
    const repositorio = await RepositorioDeNotasEmArquivo.abrir(pasta);
    await repositorio.salvar(novaNota("c", 2));
    await repositorio.salvar(novaNota("a", 0));
    await repositorio.salvar(novaNota("b", 1));

    const reaberto = await RepositorioDeNotasEmArquivo.abrir(pasta);

    expect(repositorio.todas().map((nota) => nota.id)).toEqual(["a", "b", "c"]);
    expect(reaberto.todas().map((nota) => nota.id)).toEqual(["a", "b", "c"]);
  });

  it("devolve cópias: alterar uma nota buscada não muda nada até salvar", async () => {
    const repositorio = await RepositorioDeNotasEmArquivo.abrir(pasta);
    await repositorio.salvar(novaNota("a"));

    repositorio.buscar("a")?.renomear("Outro título", agora);

    expect(repositorio.buscar("a")?.titulo).toBe("Nota a");
  });

  it("devolve null para nota inexistente", async () => {
    const repositorio = await RepositorioDeNotasEmArquivo.abrir(pasta);

    expect(repositorio.buscar("nao-existe")).toBeNull();
  });

  it("remove a nota da memória e do disco", async () => {
    const repositorio = await RepositorioDeNotasEmArquivo.abrir(pasta);
    await repositorio.salvar(novaNota("a"));
    await repositorio.salvar(novaNota("b"));

    await repositorio.remover("a");
    const reaberto = await RepositorioDeNotasEmArquivo.abrir(pasta);

    expect(repositorio.buscar("a")).toBeNull();
    expect(reaberto.todas().map((nota) => nota.id)).toEqual(["b"]);
    expect(await readdir(pastaDasNotas)).toEqual(["b.json"]);
  });

  it("ignora arquivo ilegível com aviso no log, sem apagá-lo, e abre as outras notas", async () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await mkdir(pastaDasNotas, { recursive: true });
    const valida: DadosDaNota = novaNota("boa").paraDados();
    await writeFile(path.join(pastaDasNotas, "boa.json"), JSON.stringify(valida), "utf8");
    await writeFile(path.join(pastaDasNotas, "quebrada.json"), '{"id":"quebrada","titu', "utf8");
    await writeFile(path.join(pastaDasNotas, "incompleta.json"), JSON.stringify({ id: "incompleta" }), "utf8");
    await writeFile(path.join(pastaDasNotas, "trocada.json"), JSON.stringify({ ...valida, id: "outra" }), "utf8");
    await writeFile(path.join(pastaDasNotas, "boa.json.tmp"), "lixo de uma gravação interrompida", "utf8");

    const repositorio = await RepositorioDeNotasEmArquivo.abrir(pasta);

    expect(repositorio.todas().map((nota) => nota.paraDados())).toEqual([valida]);
    expect(aviso).toHaveBeenCalledTimes(3);
    expect(String(aviso.mock.calls[0]?.[0])).toMatch(/^\[notas\] Arquivo ".+\.json" ignorado/);
    expect((await readdir(pastaDasNotas)).sort()).toEqual(
      ["boa.json", "boa.json.tmp", "incompleta.json", "quebrada.json", "trocada.json"].sort(),
    );
  });

  it("gravações seguidas da mesma nota terminam com o último conteúdo, sem arquivo pela metade", async () => {
    const repositorio = await RepositorioDeNotasEmArquivo.abrir(pasta);
    const nota = novaNota("a");

    // Sem esperar entre uma e outra, como edições rápidas na tela.
    const gravacoes: Promise<void>[] = [];
    for (let versao = 1; versao <= 30; versao++) {
      nota.reescrever(`versão ${versao}: ${"x".repeat(versao * 500)}`, agora);
      gravacoes.push(repositorio.salvar(nota));
    }
    await Promise.all(gravacoes);
    await repositorio.aguardarGravacoes();

    const reaberto = await RepositorioDeNotasEmArquivo.abrir(pasta);

    expect(repositorio.buscar("a")?.texto).toMatch(/^versão 30: /);
    expect(reaberto.buscar("a")?.paraDados()).toEqual(nota.paraDados());
    expect(await readdir(pastaDasNotas)).toEqual(["a.json"]);
  });

  it("remover logo depois de salvar, sem esperar, não deixa a nota no disco", async () => {
    const repositorio = await RepositorioDeNotasEmArquivo.abrir(pasta);

    const salvar = repositorio.salvar(novaNota("a"));
    const remover = repositorio.remover("a");
    await Promise.all([salvar, remover]);

    expect(await readdir(pastaDasNotas)).toEqual([]);
  });

  it("recusa identidade que escaparia da pasta das notas", async () => {
    const repositorio = await RepositorioDeNotasEmArquivo.abrir(pasta);

    expect(() => repositorio.salvar(novaNota("..\\fora"))).toThrow(/Identidade de nota inválida/);
    expect(repositorio.buscar("..\\fora")).toBeNull();
  });
});
