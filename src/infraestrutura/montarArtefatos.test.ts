import { once } from "node:events";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { Server } from "node:http";
import { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import express from "express";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ResumoDoArtefato } from "../controllers/artefatosRoutes";
import { MontagemDosArtefatos, montarArtefatos, pastaDeEntradaDosArtefatos } from "./montarArtefatos";

describe("montarArtefatos", () => {
  let pasta: string;
  let servidor: Server;
  let base: string;
  let montagem: MontagemDosArtefatos;

  beforeEach(async () => {
    pasta = await mkdtemp(path.join(tmpdir(), "montar-artefatos-teste-"));
  });

  afterEach(async () => {
    await montagem.encerrar();
    servidor.closeAllConnections();
    servidor.close();
    await once(servidor, "close");
    await rm(pasta, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  async function subir(): Promise<void> {
    montagem = await montarArtefatos({ pastaDeDados: pasta });
    const aplicacao = express();
    aplicacao.use(express.json());
    aplicacao.use("/api", montagem.rotas);
    servidor = aplicacao.listen(0, "127.0.0.1");
    await once(servidor, "listening");
    base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}/api`;
    await montagem.iniciar();
  }

  async function listar(): Promise<ResumoDoArtefato[]> {
    return (await (await fetch(`${base}/artefatos`)).json()) as ResumoDoArtefato[];
  }

  it("cria a pasta de entrada, coleta o que já estava lá e o que chega depois", async () => {
    const entrada = pastaDeEntradaDosArtefatos(pasta);
    await mkdir(path.join(entrada, "orquestradores", "orq-1"), { recursive: true });
    await writeFile(path.join(entrada, "orquestradores", "orq-1", "antes.html"), "<p>antes</p>");

    await subir();

    expect(entrada).toBe(path.join(pasta, "artefatos", "entrada"));
    expect((await readdir(entrada)).sort()).toEqual(["chat", "orquestradores"]);
    expect((await listar()).map((artefato) => artefato.arquivo)).toEqual(["antes.html"]);

    await writeFile(path.join(entrada, "chat", "depois.md"), "# depois");
    await expect
      .poll(async () => (await listar()).map((artefato) => artefato.arquivo).sort(), { timeout: 5_000, interval: 50 })
      .toEqual(["antes.html", "depois.md"]);
  });
});
