import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ErroDeCaminho, ExploradorDePastas } from "./ExploradorDePastas";

describe("ExploradorDePastas.navegar", () => {
  let raiz: string;
  let explorador: ExploradorDePastas;

  beforeEach(async () => {
    raiz = await mkdtemp(path.join(tmpdir(), "explorador-"));
    await mkdir(path.join(raiz, "projeto-a"));
    await mkdir(path.join(raiz, "projeto-b", "sub"), { recursive: true });
    await mkdir(path.join(raiz, "node_modules"));
    await mkdir(path.join(raiz, ".oculta"));
    await writeFile(path.join(raiz, "arquivo.txt"), "oi");
    explorador = new ExploradorDePastas(raiz);
  });

  afterEach(async () => {
    await rm(raiz, { recursive: true, force: true });
  });

  it("sem caminho, parte da raiz dos projetos e lista só as subpastas visíveis", async () => {
    const navegacao = await explorador.navegar();

    expect(navegacao.caminho).toBe(path.resolve(raiz));
    expect(navegacao.pastas.map((pasta) => pasta.nome)).toEqual(["projeto-a", "projeto-b"]);
    expect(navegacao.pai).toBe(path.dirname(path.resolve(raiz)));
  });

  it("navega para uma subpasta informada por caminho absoluto", async () => {
    const alvo = path.join(raiz, "projeto-b");
    const navegacao = await explorador.navegar(alvo);

    expect(navegacao.caminho).toBe(path.resolve(alvo));
    expect(navegacao.pastas.map((pasta) => pasta.nome)).toEqual(["sub"]);
    expect(navegacao.pai).toBe(path.resolve(raiz));
  });

  it("volta para a raiz quando o caminho informado não existe", async () => {
    const navegacao = await explorador.navegar(path.join(raiz, "nao-existe"));

    expect(navegacao.caminho).toBe(path.resolve(raiz));
  });

  it("no modo estrito, recusa caminho que não existe ou que não é pasta", async () => {
    const inexistente = path.join(raiz, "nao-existe");
    const arquivo = path.join(raiz, "arquivo.txt");

    await expect(explorador.navegar(inexistente, { estrito: true })).rejects.toThrow(
      new ErroDeCaminho(`A pasta "${inexistente}" não existe.`),
    );
    await expect(explorador.navegar(arquivo, { estrito: true })).rejects.toThrow(
      new ErroDeCaminho(`"${arquivo}" não é uma pasta.`),
    );
  });

  it("no modo estrito, normaliza o caminho digitado", async () => {
    const navegacao = await explorador.navegar(`${raiz}/projeto-b/sub/../`, { estrito: true });

    expect(navegacao.caminho).toBe(path.join(path.resolve(raiz), "projeto-b"));
  });

  it("expande ~ para a pasta do usuário", async () => {
    expect((await explorador.navegar("~", { estrito: true })).caminho).toBe(path.resolve(homedir()));
  });
});
