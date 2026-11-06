import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ArquivoAlterado } from "../../orquestracao/AlteracoesDoWorktree";
import { LeitorDeAlteracoesGit } from "./LeitorDeAlteracoesGit";

/**
 * Configuração só destes testes: autor fixo, sem assinatura, sem conversão de
 * fim de linha e sem o `.gitignore` global do usuário (que poderia esconder
 * arquivos do teste).
 */
function git(cwd: string, ...argumentos: string[]): Promise<string> {
  return new Promise((resolver, rejeitar) => {
    execFile(
      "git",
      [
        "-c",
        "user.name=Teste",
        "-c",
        "user.email=teste@exemplo.com",
        "-c",
        "commit.gpgsign=false",
        "-c",
        "core.autocrlf=false",
        ...argumentos,
      ],
      { cwd, windowsHide: true },
      (erro, saida, erroPadrao) => {
        if (erro !== null) {
          rejeitar(new Error(`git ${argumentos.join(" ")}: ${erroPadrao.toString()}`));
          return;
        }
        resolver(saida.toString());
      },
    );
  });
}

async function escrever(raiz: string, relativo: string, conteudo: string | Buffer): Promise<void> {
  const absoluto = path.join(raiz, relativo);
  await mkdir(path.dirname(absoluto), { recursive: true });
  await writeFile(absoluto, conteudo);
}

function linhas(quantidade: number, prefixo: string): string {
  return Array.from({ length: quantidade }, (_, indice) => `${prefixo} ${indice + 1}`).join("\n") + "\n";
}

const COM_ACENTO = "documentos/relatório final.txt";
const NAO_RASTREADO_COM_ACENTO = "nova pasta/anotação.md";

// Cada teste roda vários `git` de verdade: no Windows, com a suíte inteira em
// paralelo, isso passa dos 5 s padrão.
describe("LeitorDeAlteracoesGit (repositório git de verdade)", { timeout: 30_000 }, () => {
  let base: string;
  let repo: string;
  let worktree: string;
  let arquivos: readonly ArquivoAlterado[];
  const leitor = new LeitorDeAlteracoesGit();

  function arquivo(caminho: string): ArquivoAlterado {
    const encontrado = arquivos.find((candidato) => candidato.caminho === caminho);
    if (encontrado === undefined) {
      throw new Error(`"${caminho}" não está na lista: ${arquivos.map((a) => a.caminho).join(", ")}`);
    }
    return encontrado;
  }

  beforeAll(async () => {
    base = await mkdtemp(path.join(tmpdir(), "leitor-alteracoes-"));
    repo = path.join(base, "repo");
    worktree = path.join(base, "wt");
    await mkdir(repo);
    await git(repo, "init", "-q", "-b", "main");
    await git(repo, "config", "core.excludesFile", path.join(base, "sem-excludes"));
    await git(repo, "config", "core.autocrlf", "false");

    await escrever(repo, "modificar.txt", "um\ndois\ntrês\n");
    await escrever(repo, "remover.txt", "vai sumir\n");
    await escrever(repo, "antigo.txt", linhas(20, "conteúdo estável da linha"));
    await escrever(repo, COM_ACENTO, "versão 1\n");
    await escrever(repo, "grande.txt", linhas(5_000, "original"));
    await escrever(repo, ".gitignore", "ignorado.log\n");
    await git(repo, "add", "-A");
    await git(repo, "commit", "-q", "--no-verify", "-m", "inicial");

    await git(repo, "worktree", "add", "-q", "-b", "orquestrador/teste", worktree, "HEAD");

    // Alterações do "agente" dentro do worktree.
    await escrever(worktree, "modificar.txt", "um\nDOIS\ntrês\nquatro\n");
    await unlink(path.join(worktree, "remover.txt"));
    await git(worktree, "mv", "antigo.txt", "novo.txt");
    await escrever(worktree, "adicionado.txt", "linha nova\n");
    await git(worktree, "add", "adicionado.txt");
    await escrever(worktree, COM_ACENTO, "versão 2\n");
    await escrever(worktree, "grande.txt", linhas(5_000, "alterada"));
    await escrever(worktree, "solto.txt", "primeira\nsegunda");
    await escrever(worktree, NAO_RASTREADO_COM_ACENTO, "# título\n");
    await escrever(worktree, "figura.png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00, 0x01, 0x02]));
    await escrever(worktree, "ignorado.log", "não deve aparecer\n");

    arquivos = await leitor.listarArquivos(worktree);
  }, 60_000);

  afterAll(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it("lista o modificado com as linhas adicionadas e removidas", () => {
    expect(arquivo("modificar.txt")).toEqual({
      caminho: "modificar.txt",
      caminhoAnterior: null,
      situacao: "modificado",
      adicoes: 2,
      remocoes: 1,
      binario: false,
    });
  });

  it("lista o adicionado (no índice), o removido e o renomeado com o caminho anterior", () => {
    expect(arquivo("adicionado.txt")).toMatchObject({ situacao: "adicionado", adicoes: 1, remocoes: 0 });
    expect(arquivo("remover.txt")).toMatchObject({ situacao: "removido", adicoes: 0, remocoes: 1 });
    expect(arquivo("novo.txt")).toMatchObject({ situacao: "renomeado", caminhoAnterior: "antigo.txt" });
    expect(arquivos.some((candidato) => candidato.caminho === "antigo.txt")).toBe(false);
  });

  it("lista os não rastreados com as linhas contadas e ignora o que está no .gitignore", () => {
    expect(arquivo("solto.txt")).toEqual({
      caminho: "solto.txt",
      caminhoAnterior: null,
      situacao: "nao_rastreado",
      adicoes: 2,
      remocoes: null,
      binario: false,
    });
    expect(arquivos.some((candidato) => candidato.caminho === "ignorado.log")).toBe(false);
  });

  it("marca o binário não rastreado, sem contar linhas, e não monta diff dele", async () => {
    const figura = arquivo("figura.png");

    expect(figura).toMatchObject({ situacao: "nao_rastreado", binario: true, adicoes: null });
    expect(await leitor.lerDiff(worktree, figura)).toEqual({
      caminho: "figura.png",
      diff: "",
      truncado: false,
      binario: true,
    });
  });

  it("mantém nomes com acento e espaço como estão, na lista e no diff", async () => {
    expect(arquivo(COM_ACENTO)).toMatchObject({ situacao: "modificado", adicoes: 1, remocoes: 1 });
    expect(arquivo(NAO_RASTREADO_COM_ACENTO)).toMatchObject({ situacao: "nao_rastreado", adicoes: 1 });

    const diff = await leitor.lerDiff(worktree, arquivo(COM_ACENTO));

    expect(diff.diff).toContain(`+++ b/${COM_ACENTO}`);
    expect(diff.diff).toContain("-versão 1");
    expect(diff.diff).toContain("+versão 2");
  });

  it("devolve a lista em ordem de caminho", () => {
    const caminhos = arquivos.map((candidato) => candidato.caminho);

    expect(caminhos).toEqual([...caminhos].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
  });

  it("monta o diff do modificado com o cabeçalho do trecho", async () => {
    const diff = await leitor.lerDiff(worktree, arquivo("modificar.txt"));

    expect(diff).toMatchObject({ caminho: "modificar.txt", truncado: false, binario: false });
    expect(diff.diff).toMatch(/^@@ -1,3 \+1,4 @@/m);
    expect(diff.diff).toContain("\n-dois\n");
    expect(diff.diff).toContain("\n+DOIS\n");
    expect(diff.diff).toContain("\n+quatro\n");
  });

  it("monta o diff do renomeado pareando origem e destino", async () => {
    const diff = await leitor.lerDiff(worktree, arquivo("novo.txt"));

    expect(diff.diff).toContain("rename from antigo.txt");
    expect(diff.diff).toContain("rename to novo.txt");
  });

  it("monta o diff do removido", async () => {
    const diff = await leitor.lerDiff(worktree, arquivo("remover.txt"));

    expect(diff.diff).toContain("deleted file mode");
    expect(diff.diff).toContain("-vai sumir");
  });

  it("monta o diff de arquivo novo para o não rastreado, avisando a falta de quebra no fim", async () => {
    const diff = await leitor.lerDiff(worktree, arquivo("solto.txt"));

    expect(diff.diff).toBe(
      [
        "diff --git a/solto.txt b/solto.txt",
        "--- /dev/null",
        "+++ b/solto.txt",
        "@@ -0,0 +1,2 @@",
        "+primeira",
        "+segunda",
        "\\ No newline at end of file",
        "",
      ].join("\n"),
    );
    expect(diff.truncado).toBe(false);
  });

  it("corta o diff grande no fim de uma linha e marca truncado", async () => {
    const limitado = new LeitorDeAlteracoesGit({ limiteDoDiffBytes: 4_096 });

    const diff = await limitado.lerDiff(worktree, arquivo("grande.txt"));

    expect(diff.truncado).toBe(true);
    expect(Buffer.byteLength(diff.diff, "utf8")).toBeLessThanOrEqual(4_096);
    expect(diff.diff.endsWith("\n")).toBe(true);
    expect(diff.diff).toContain("\n-original 1\n");
    expect(diff.diff).not.toContain("+alterada 5000");
  });

  it("corta também o diff de um não rastreado grande", async () => {
    await escrever(worktree, "enorme.txt", linhas(3_000, "solta"));
    const limitado = new LeitorDeAlteracoesGit({ limiteDoDiffBytes: 2_048 });
    const enorme = (await limitado.listarArquivos(worktree)).find((candidato) => candidato.caminho === "enorme.txt");

    const diff = await limitado.lerDiff(worktree, enorme as ArquivoAlterado);

    expect(diff.truncado).toBe(true);
    expect(diff.diff).toContain("+solta 1\n");
    expect(diff.diff).not.toContain("+solta 3000");
    await unlink(path.join(worktree, "enorme.txt"));
  });

  it("respeita o limite de arquivos, com os rastreados primeiro", async () => {
    const limitado = new LeitorDeAlteracoesGit({ limiteDeArquivos: 3 });

    const lista = await limitado.listarArquivos(worktree);

    expect(lista).toHaveLength(3);
    expect(lista.every((candidato) => candidato.situacao !== "nao_rastreado")).toBe(true);
  });

  it("conta os commits da branch que não estão no HEAD da pasta original", async () => {
    expect(await leitor.contarCommitsNaBranch(worktree, repo)).toBe(0);

    await escrever(worktree, "commitado.txt", "feito pelo agente\n");
    await git(worktree, "add", "commitado.txt");
    await git(worktree, "commit", "-q", "--no-verify", "-m", "commit do agente");

    expect(await leitor.contarCommitsNaBranch(worktree, repo)).toBe(1);
    // O commit sai da lista de pendentes: já está na branch.
    const lista = await leitor.listarArquivos(worktree);
    expect(lista.some((candidato) => candidato.caminho === "commitado.txt")).toBe(false);
  });

  it("conta zero quando não dá para calcular", async () => {
    expect(await leitor.contarCommitsNaBranch(worktree, path.join(base, "nao-existe"))).toBe(0);
  });

  it("diz se a pasta é repositório com HEAD", async () => {
    const vazia = path.join(base, "vazia");
    const semCommit = path.join(base, "sem-commit");
    await mkdir(vazia);
    await mkdir(semCommit);
    await git(semCommit, "init", "-q");

    expect(await leitor.ehRepositorioComHead(repo)).toBe(true);
    expect(await leitor.ehRepositorioComHead(vazia)).toBe(false);
    expect(await leitor.ehRepositorioComHead(semCommit)).toBe(false);
    expect(await leitor.ehRepositorioComHead(path.join(base, "nao-existe"))).toBe(false);
  });

  it("lança quando o git não consegue ler o worktree", async () => {
    await expect(leitor.listarArquivos(path.join(base, "nao-existe"))).rejects.toThrow();
  });
});
