import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Artefato } from "../../artefatos/Artefato";
import { OrigemDoArtefato } from "../../artefatos/OrigemDoArtefato";
import { RepositorioDeArtefatosEmArquivo } from "./RepositorioDeArtefatosEmArquivo";

const agora = new Date("2026-11-05T12:00:00Z");

function hashDe(conteudo: Buffer): string {
  return createHash("sha256").update(conteudo).digest("hex");
}

function novoArtefato(id: string, arquivo: string, conteudo: Buffer, minutos = 0): Artefato {
  return Artefato.criar({
    id,
    origem: OrigemDoArtefato.doOrquestrador("orq-1"),
    arquivo,
    hash: hashDe(conteudo),
    tamanho: conteudo.length,
    agora: new Date(agora.getTime() + minutos * 60_000),
  });
}

describe("RepositorioDeArtefatosEmArquivo", () => {
  let pasta: string;
  let pastaDosArtefatos: string;

  beforeEach(async () => {
    pasta = await mkdtemp(path.join(tmpdir(), "repositorio-artefatos-teste-"));
    pastaDosArtefatos = path.join(pasta, "artefatos");
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(pasta, { recursive: true, force: true });
  });

  it("cria a pasta dos artefatos e começa vazio", async () => {
    const repositorio = await RepositorioDeArtefatosEmArquivo.abrir(pasta);

    expect(repositorio.todos()).toEqual([]);
    expect(await readdir(pastaDosArtefatos)).toEqual([]);
  });

  it("grava artefato.json e o conteúdo de cada versão, e reabre exatamente como ficou", async () => {
    const repositorio = await RepositorioDeArtefatosEmArquivo.abrir(pasta);
    const v1 = Buffer.from("# Relatório\n");
    const v2 = Buffer.from("# Relatório\n\natualizado\n");
    const artefato = novoArtefato("a1", "relatorio.markdown", v1);
    await repositorio.salvar(artefato, { numero: 1, conteudo: v1 });
    artefato.adicionarVersao(hashDe(v2), v2.length, new Date("2026-11-05T12:10:00Z"));
    await repositorio.salvar(artefato, { numero: 2, conteudo: v2 });

    const reaberto = await RepositorioDeArtefatosEmArquivo.abrir(pasta);

    expect((await readdir(path.join(pastaDosArtefatos, "a1"))).sort()).toEqual(["artefato.json", "v1.md", "v2.md"]);
    expect(reaberto.buscar("a1")?.paraDados()).toEqual(artefato.paraDados());
    expect(JSON.parse(await readFile(path.join(pastaDosArtefatos, "a1", "artefato.json"), "utf8"))).toEqual(
      artefato.paraDados(),
    );
    expect((await reaberto.lerConteudo("a1", 1))?.toString()).toBe(v1.toString());
    expect((await reaberto.lerConteudo("a1", 2))?.toString()).toBe(v2.toString());
    expect(await reaberto.lerConteudo("a1", 3)).toBeNull();
    expect(await reaberto.lerConteudo("nao-existe", 1)).toBeNull();
  });

  it("acha pelo arquivo e pela origem, e lista do atualizado mais recentemente para o mais antigo", async () => {
    const repositorio = await RepositorioDeArtefatosEmArquivo.abrir(pasta);
    const conteudo = Buffer.from("<p>x</p>");
    await repositorio.salvar(novoArtefato("antigo", "a.html", conteudo, 0), { numero: 1, conteudo });
    await repositorio.salvar(novoArtefato("novo", "b.html", conteudo, 5), { numero: 1, conteudo });

    expect(repositorio.todos().map((artefato) => artefato.id)).toEqual(["novo", "antigo"]);
    expect(repositorio.buscarPorArquivo(OrigemDoArtefato.doOrquestrador("orq-1"), "a.html")?.id).toBe("antigo");
    expect(repositorio.buscarPorArquivo(OrigemDoArtefato.doChat(), "a.html")).toBeNull();
    expect(repositorio.buscarPorArquivo(OrigemDoArtefato.doOrquestrador("orq-2"), "a.html")).toBeNull();
  });

  it("devolve cópias: alterar um artefato buscado não muda nada até salvar", async () => {
    const repositorio = await RepositorioDeArtefatosEmArquivo.abrir(pasta);
    const conteudo = Buffer.from("x");
    await repositorio.salvar(novoArtefato("a1", "a.html", conteudo), { numero: 1, conteudo });

    repositorio.buscar("a1")?.renomear("Outro", agora);

    expect(repositorio.buscar("a1")?.titulo).toBe("a");
  });

  it("remove a pasta inteira do artefato", async () => {
    const repositorio = await RepositorioDeArtefatosEmArquivo.abrir(pasta);
    const conteudo = Buffer.from("x");
    await repositorio.salvar(novoArtefato("a1", "a.html", conteudo), { numero: 1, conteudo });
    await repositorio.salvar(novoArtefato("a2", "b.html", conteudo), { numero: 1, conteudo });

    await repositorio.remover("a1");
    const reaberto = await RepositorioDeArtefatosEmArquivo.abrir(pasta);

    expect(repositorio.buscar("a1")).toBeNull();
    expect(reaberto.todos().map((artefato) => artefato.id)).toEqual(["a2"]);
    expect(await readdir(pastaDosArtefatos)).toEqual(["a2"]);
  });

  it("ignora artefato ilegível com aviso no log, sem apagá-lo, e não confunde a pasta de entrada", async () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const conteudo = Buffer.from("x");
    const repositorio = await RepositorioDeArtefatosEmArquivo.abrir(pasta);
    const valido = novoArtefato("bom", "a.html", conteudo);
    await repositorio.salvar(valido, { numero: 1, conteudo });
    await mkdir(path.join(pastaDosArtefatos, "quebrado"));
    await writeFile(path.join(pastaDosArtefatos, "quebrado", "artefato.json"), '{"id":"quebrado","tit', "utf8");
    await mkdir(path.join(pastaDosArtefatos, "trocado"));
    await writeFile(
      path.join(pastaDosArtefatos, "trocado", "artefato.json"),
      JSON.stringify({ ...valido.paraDados(), id: "outro" }),
      "utf8",
    );
    await mkdir(path.join(pastaDosArtefatos, "sem-versoes"));
    await writeFile(
      path.join(pastaDosArtefatos, "sem-versoes", "artefato.json"),
      JSON.stringify({ ...valido.paraDados(), id: "sem-versoes", versoes: [] }),
      "utf8",
    );
    await mkdir(path.join(pastaDosArtefatos, "entrada", "chat"), { recursive: true });

    const reaberto = await RepositorioDeArtefatosEmArquivo.abrir(pasta);

    expect(reaberto.todos().map((artefato) => artefato.paraDados())).toEqual([valido.paraDados()]);
    expect(aviso).toHaveBeenCalledTimes(3);
    expect(String(aviso.mock.calls[0]?.[0])).toMatch(/^\[artefatos\] Artefato ".+artefato\.json" ignorado/);
    expect((await readdir(pastaDosArtefatos)).sort()).toEqual(["bom", "entrada", "quebrado", "sem-versoes", "trocado"]);
  });

  it("recusa identidade que escaparia da pasta ou que é a pasta de entrada", async () => {
    const repositorio = await RepositorioDeArtefatosEmArquivo.abrir(pasta);
    const conteudo = Buffer.from("x");

    expect(() => repositorio.salvar(novoArtefato("..\\fora", "a.html", conteudo))).toThrow(/Identidade de artefato inválida/);
    expect(() => repositorio.salvar(novoArtefato("entrada", "a.html", conteudo))).toThrow(/Identidade de artefato inválida/);
  });
});
