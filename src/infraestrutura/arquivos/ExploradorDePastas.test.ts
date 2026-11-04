import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { ErroDeOrquestracao } from "../../orquestracao/ErroDeOrquestracao";
import { ExploradorDePastas } from "./ExploradorDePastas";

describe("ExploradorDePastas", () => {
  let base: string;
  let projetos: string;
  let fora: string;

  beforeAll(async () => {
    base = await mkdtemp(path.join(tmpdir(), "explorador-"));
    projetos = path.join(base, "projetos");
    fora = path.join(base, "fora");
    for (const pasta of ["painel", "Api", ".git", "node_modules", "$Recycle.Bin"]) {
      await mkdir(path.join(projetos, pasta), { recursive: true });
    }
    await writeFile(path.join(projetos, "leia-me.txt"), "não é pasta");
    await mkdir(path.join(fora, "documentos"), { recursive: true });
    await mkdir(path.join(base, "ligadas"), { recursive: true });
    // "junction" no Windows (não precisa de admin); no macOS e Linux é ignorado.
    await symlink(fora, path.join(base, "ligadas", "atalho-para-fora"), "junction");
    await symlink(path.join(base, "nao-existe"), path.join(base, "ligadas", "link-quebrado"), "junction");
    // Link para arquivo exige o modo de desenvolvedor no Windows; sem ele, o caso fica de fora.
    await symlink(path.join(projetos, "leia-me.txt"), path.join(base, "ligadas", "link-para-arquivo"), "file").catch(
      () => undefined,
    );
  });

  afterAll(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it("sem caminho, lista as subpastas da pasta dos projetos, em ordem e sem as ocultas", async () => {
    const conteudo = await new ExploradorDePastas(projetos).listar();

    expect(conteudo.atual).toBe(projetos);
    expect(conteudo.acima).toBe(base);
    expect(conteudo.pastas).toEqual([
      { nome: "Api", caminho: path.join(projetos, "Api") },
      { nome: "painel", caminho: path.join(projetos, "painel") },
    ]);
  });

  it("abre qualquer pasta, inclusive fora da pasta dos projetos", async () => {
    const conteudo = await new ExploradorDePastas(projetos).listar(fora);

    expect(conteudo.atual).toBe(fora);
    expect(conteudo.pastas).toEqual([{ nome: "documentos", caminho: path.join(fora, "documentos") }]);
  });

  it("resolve caminho relativo a partir da pasta dos projetos", async () => {
    const conteudo = await new ExploradorDePastas(projetos).listar(path.join("..", "fora"));

    expect(conteudo.atual).toBe(fora);
  });

  it("na raiz do disco, não há pasta acima", async () => {
    const raizDoDisco = path.parse(base).root;

    expect((await new ExploradorDePastas(projetos).listar(raizDoDisco)).acima).toBeNull();
  });

  it("recusa pasta que não existe, ou um arquivo, com mensagem clara", async () => {
    const explorador = new ExploradorDePastas(projetos);
    const inexistente = path.join(base, "nao-existe");

    await expect(explorador.listar(inexistente)).rejects.toThrow(ErroDeOrquestracao);
    await expect(explorador.listar(inexistente)).rejects.toThrow(`A pasta "${inexistente}" não existe.`);
    await expect(explorador.listar(path.join(projetos, "leia-me.txt"))).rejects.toThrow(/não existe/);
  });

  it("mostra links e junctions para pastas; links quebrados ou para arquivos ficam de fora", async () => {
    const conteudo = await new ExploradorDePastas(projetos).listar(path.join(base, "ligadas"));

    expect(conteudo.pastas).toEqual([
      { nome: "atalho-para-fora", caminho: path.join(base, "ligadas", "atalho-para-fora") },
    ]);
  });

  it("atalhos no Windows: as unidades que existem, consultadas uma vez e reaproveitadas por 30 s", async () => {
    let instante = 0;
    const explorador = new ExploradorDePastas(projetos, { pastaPessoal: fora, plataforma: "win32", agora: () => instante });
    const existe = vi
      .spyOn(explorador, "existe")
      .mockImplementation(async (caminho) => caminho === "C:\\" || caminho === "D:\\");

    expect(await explorador.atalhos()).toEqual([
      { nome: "Projetos", caminho: projetos },
      { nome: "Pasta pessoal", caminho: fora },
      { nome: "C:", caminho: "C:\\" },
      { nome: "D:", caminho: "D:\\" },
    ]);
    instante = 10_000;
    await explorador.atalhos();
    expect(existe).toHaveBeenCalledTimes(26);
    instante = 31_000;
    await explorador.atalhos();
    expect(existe).toHaveBeenCalledTimes(52);
  });

  it("atalhos no Windows: unidade que não responde a tempo fica de fora", async () => {
    vi.useFakeTimers();
    try {
      const explorador = new ExploradorDePastas(projetos, { pastaPessoal: fora, plataforma: "win32" });
      vi.spyOn(explorador, "existe").mockImplementation((caminho) =>
        caminho === "Z:\\" ? new Promise<boolean>(() => undefined) : Promise.resolve(caminho === "C:\\"),
      );

      const atalhos = explorador.atalhos();
      await vi.advanceTimersByTimeAsync(1_000);

      expect((await atalhos).map((atalho) => atalho.nome)).toEqual(["Projetos", "Pasta pessoal", "C:"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("atalhos: pasta dos projetos e pasta pessoal; unidades só no Windows", async () => {
    const atalhos = await new ExploradorDePastas(projetos, { pastaPessoal: fora, plataforma: "linux" }).atalhos();

    expect(atalhos).toEqual([
      { nome: "Projetos", caminho: projetos },
      { nome: "Pasta pessoal", caminho: fora },
    ]);
  });
});
