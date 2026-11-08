import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { SistemaDeArquivosEmDisco } from "../infraestrutura/arquivos/SistemaDeArquivosEmDisco";
import { ErroDeArquivo, MotivoDoErroDeArquivo, TAMANHO_MAXIMO_DO_ARQUIVO } from "./ArquivosDaPasta";
import { ConfiguracaoDoOrquestrador } from "./ConfiguracaoDoOrquestrador";
import { Orquestrador } from "./Orquestrador";
import { PastaDeTrabalho } from "./PastaDeTrabalho";
import { ServicoDeArquivos } from "./ServicoDeArquivos";

/** Pasta de teste no disco de verdade: os ataques por symlink só valem com o sistema de arquivos real. */
let base: string;
let projeto: string;
let worktree: string;

async function gravar(relativo: string, conteudo: string | Buffer, raiz = projeto): Promise<void> {
  const destino = path.join(raiz, relativo);
  await mkdir(path.dirname(destino), { recursive: true });
  await writeFile(destino, conteudo);
}

beforeAll(async () => {
  base = await mkdtemp(path.join(tmpdir(), "servico-de-arquivos-"));
  projeto = path.join(base, "projetos", "painel");
  worktree = path.join(base, "worktrees", "o1");

  await gravar("src/app.ts", "const a = 1;\nconst b = 2;\n");
  await gravar("src/util/texto.ts", "export {};");
  await gravar("src/item10.ts", "");
  await gravar("src/item2.ts", "");
  await gravar("README.md", "# Painel");
  await gravar(".gitignore", "node_modules\n");
  await gravar(".env", "SENHA=123");
  await gravar(".env.local", "SENHA=456");
  await gravar(".git/config", "[core]");
  await gravar("node_modules/pacote/index.js", "module.exports = 1;");
  await gravar("imagem.bin", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]));
  await gravar("grande.txt", "a".repeat(TAMANHO_MAXIMO_DO_ARQUIVO + 1));
  await gravar("no-limite.txt", "a".repeat(TAMANHO_MAXIMO_DO_ARQUIVO));
  await gravar("vazio.txt", "");
  await gravar("segredo.txt", "senha de fora", path.join(base, "fora"));

  await symlink(path.join(base, "fora", "segredo.txt"), path.join(projeto, "link-para-fora.txt"));
  await symlink(path.join(base, "fora"), path.join(projeto, "pasta-de-fora"));
  await symlink(path.join(projeto, ".git", "config"), path.join(projeto, "link-para-git"));
  await symlink(path.join(projeto, ".env"), path.join(projeto, "link-para-env"));
  await symlink(path.join(projeto, "src", "app.ts"), path.join(projeto, "atalho.ts"));
  await symlink(path.join(projeto, "nao-existe"), path.join(projeto, "link-quebrado"));

  await gravar("so-no-worktree.ts", "1", worktree);
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

function novoOrquestrador(): Orquestrador {
  return Orquestrador.criar({
    id: "o1",
    nome: "Painel",
    pastaDeTrabalho: PastaDeTrabalho.qualquer(projeto),
    sessaoId: "s1",
    configuracao: ConfiguracaoDoOrquestrador.de({
      modeloDoOrquestrador: "opus",
      modeloDosSubagentes: "sonnet",
      quantidadeDeSubagentes: { modo: "automatica", limite: 2 },
      nivelDePermissao: "edicao_e_comandos",
    }),
    agora: new Date("2026-11-07T10:00:00Z"),
  });
}

async function recusa(promessa: Promise<unknown>): Promise<{ motivo: MotivoDoErroDeArquivo; mensagem: string }> {
  try {
    await promessa;
  } catch (erro) {
    expect(erro).toBeInstanceOf(ErroDeArquivo);
    return { motivo: (erro as ErroDeArquivo).motivo, mensagem: (erro as ErroDeArquivo).message };
  }
  throw new Error("Era para recusar.");
}

describe("ServicoDeArquivos", () => {
  let orquestrador: Orquestrador;
  let servico: ServicoDeArquivos;

  beforeEach(() => {
    orquestrador = novoOrquestrador();
    servico = new ServicoDeArquivos({
      repositorio: { buscarPorId: (id) => (id === orquestrador.id ? orquestrador : null) },
      sistema: new SistemaDeArquivosEmDisco(),
    });
  });

  describe("listar", () => {
    it("lista um nível da raiz: pastas antes, sem .git, node_modules, .env* e links para fora ou quebrados", async () => {
      const listagem = await servico.listar("o1", "");

      expect(listagem.caminho).toBe("");
      expect(listagem.truncada).toBe(false);
      expect(listagem.entradas.map((entrada) => entrada.nome)).toEqual([
        "src",
        ".gitignore",
        "atalho.ts",
        "grande.txt",
        "imagem.bin",
        "no-limite.txt",
        "README.md",
        "vazio.txt",
      ]);
      expect(listagem.entradas[0]).toEqual({ nome: "src", tipo: "pasta" });
      expect(listagem.entradas.find((entrada) => entrada.nome === "atalho.ts")).toEqual({
        nome: "atalho.ts",
        tipo: "arquivo",
        tamanho: 26,
      });
    });

    it("lista uma subpasta, com números em ordem natural", async () => {
      const listagem = await servico.listar("o1", "src/");

      expect(listagem.caminho).toBe("src");
      expect(listagem.entradas.map((entrada) => entrada.nome)).toEqual(["util", "app.ts", "item2.ts", "item10.ts"]);
    });

    it("usa o worktree atual quando ele existe", async () => {
      orquestrador.usarWorktree("orquestrador/o1", worktree);

      const listagem = await servico.listar("o1", "");

      expect(listagem.entradas).toEqual([{ nome: "so-no-worktree.ts", tipo: "arquivo", tamanho: 1 }]);
    });

    it("volta para a pasta de trabalho quando a pasta do worktree sumiu", async () => {
      orquestrador.usarWorktree("orquestrador/o1", path.join(base, "worktrees", "sumiu"));

      const listagem = await servico.listar("o1", "");

      expect(listagem.entradas.map((entrada) => entrada.nome)).toContain("README.md");
    });

    it.each<[string, MotivoDoErroDeArquivo]>([
      ["..", "caminho_invalido"],
      ["src/../..", "caminho_invalido"],
      ["/etc", "caminho_invalido"],
      ["C:\\Windows", "caminho_invalido"],
      [".git", "bloqueado"],
      ["node_modules", "bloqueado"],
      ["pasta-de-fora", "bloqueado"],
      ["nao-existe", "nao_encontrado"],
      ["README.md", "tipo_errado"],
    ])("recusa %j (%s)", async (caminho, motivo) => {
      expect((await recusa(servico.listar("o1", caminho))).motivo).toBe(motivo);
    });

    it("recusa orquestrador inexistente", async () => {
      expect(await recusa(servico.listar("nao-existe", ""))).toEqual({
        motivo: "nao_encontrado",
        mensagem: "Orquestrador não encontrado.",
      });
    });
  });

  describe("ler", () => {
    it("lê um arquivo de texto com tamanho e linhas", async () => {
      expect(await servico.ler("o1", "src/app.ts")).toEqual({
        caminho: "src/app.ts",
        conteudo: "const a = 1;\nconst b = 2;\n",
        tamanho: 26,
        linhas: 2,
      });
    });

    it("conta a última linha sem quebra e o arquivo vazio como zero linhas", async () => {
      expect((await servico.ler("o1", "README.md")).linhas).toBe(1);
      expect((await servico.ler("o1", "vazio.txt")).linhas).toBe(0);
    });

    it("segue um symlink que fica dentro da pasta e normaliza o caminho", async () => {
      const arquivo = await servico.ler("o1", "./src//util\\texto.ts");

      expect(arquivo.caminho).toBe("src/util/texto.ts");
      expect((await servico.ler("o1", "atalho.ts")).conteudo).toBe("const a = 1;\nconst b = 2;\n");
    });

    it("abre um arquivo com exatamente 500 KB", async () => {
      expect((await servico.ler("o1", "no-limite.txt")).tamanho).toBe(TAMANHO_MAXIMO_DO_ARQUIVO);
    });

    it.each<[string, MotivoDoErroDeArquivo]>([
      ["../../fora/segredo.txt", "caminho_invalido"],
      ["src/../../../fora/segredo.txt", "caminho_invalido"],
      ["..\\..\\fora\\segredo.txt", "caminho_invalido"],
      ["", "caminho_invalido"],
      [".", "caminho_invalido"],
      ["src/app.ts\0.png", "caminho_invalido"],
      [".git/config", "bloqueado"],
      [".GIT/config", "bloqueado"],
      ["node_modules/pacote/index.js", "bloqueado"],
      [".env", "bloqueado"],
      [".env.local", "bloqueado"],
      ["link-para-fora.txt", "bloqueado"],
      ["pasta-de-fora/segredo.txt", "bloqueado"],
      ["link-para-git", "bloqueado"],
      ["link-para-env", "bloqueado"],
      ["link-quebrado", "nao_encontrado"],
      ["nao-existe.ts", "nao_encontrado"],
      ["src", "tipo_errado"],
    ])("recusa %j (%s)", async (caminho, motivo) => {
      expect((await recusa(servico.ler("o1", caminho))).motivo).toBe(motivo);
    });

    it("recusa caminho absoluto, mesmo apontando para dentro da pasta", async () => {
      const resultado = await recusa(servico.ler("o1", path.join(projeto, "src", "app.ts")));

      expect(resultado).toEqual({
        motivo: "caminho_invalido",
        mensagem: "Caminho inválido: use um caminho relativo à pasta do orquestrador.",
      });
    });

    it("recusa arquivo acima de 500 KB com mensagem clara", async () => {
      expect(await recusa(servico.ler("o1", "grande.txt"))).toEqual({
        motivo: "grande_demais",
        mensagem: '"grande.txt" tem 501 KB; o visualizador abre arquivos de até 500 KB.',
      });
    });

    it("recusa binário (byte nulo no começo) com mensagem clara", async () => {
      expect(await recusa(servico.ler("o1", "imagem.bin"))).toEqual({
        motivo: "binario",
        mensagem: '"imagem.bin" é um arquivo binário e não dá para mostrar como texto.',
      });
    });
  });
});
