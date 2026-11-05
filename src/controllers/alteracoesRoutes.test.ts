import { once } from "node:events";
import { Server } from "node:http";
import { AddressInfo } from "node:net";
import path from "node:path";

import express from "express";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ArquivoAlterado,
  arquivoAlterado,
  DiffDoArquivo,
  diffDoArquivo,
  LeitorDeAlteracoes,
} from "../orquestracao/AlteracoesDoWorktree";
import { ConfiguracaoDoOrquestrador } from "../orquestracao/ConfiguracaoDoOrquestrador";
import { EventoDeOrquestracao, EventoRegistrado } from "../orquestracao/EventoDeOrquestracao";
import { Orquestrador } from "../orquestracao/Orquestrador";
import { PastaDeTrabalho } from "../orquestracao/PastaDeTrabalho";
import { ConversaArquivada, RepositorioDeOrquestradores } from "../orquestracao/RepositorioDeOrquestradores";
import { ServicoDeAlteracoes } from "../orquestracao/ServicoDeAlteracoes";
import { criarAlteracoesRoutes } from "./alteracoesRoutes";

class RepositorioEmMemoria implements RepositorioDeOrquestradores {
  readonly orquestradores = new Map<string, Orquestrador>();

  listar(): readonly Orquestrador[] {
    return [...this.orquestradores.values()];
  }
  buscarPorId(id: string): Orquestrador | null {
    return this.orquestradores.get(id) ?? null;
  }
  async salvar(orquestrador: Orquestrador): Promise<void> {
    this.orquestradores.set(orquestrador.id, orquestrador);
  }
  async remover(id: string): Promise<void> {
    this.orquestradores.delete(id);
  }
  anexarEvento(_orquestradorId: string, evento: EventoDeOrquestracao): EventoRegistrado {
    return { ...evento, sequencia: 1, em: "agora" };
  }
  arquivarConversa(orquestrador: Orquestrador, evento: EventoDeOrquestracao): ConversaArquivada {
    return { registrado: this.anexarEvento(orquestrador.id, evento), gravacao: Promise.resolve() };
  }
  lerEventos(): readonly EventoRegistrado[] {
    return [];
  }
}

class LeitorFalso implements LeitorDeAlteracoes {
  repositorioComHead = true;
  arquivos: readonly ArquivoAlterado[] = [];
  commitsNaBranch = 0;
  falha: Error | null = null;
  falhaNoDiff: Error | null = null;
  readonly diffsPedidos: string[] = [];

  async ehRepositorioComHead(): Promise<boolean> {
    return this.repositorioComHead;
  }
  async listarArquivos(): Promise<readonly ArquivoAlterado[]> {
    if (this.falha !== null) {
      throw this.falha;
    }
    return this.arquivos;
  }
  async contarCommitsNaBranch(): Promise<number> {
    return this.commitsNaBranch;
  }
  async lerDiff(_caminhoDoWorktree: string, arquivo: ArquivoAlterado): Promise<DiffDoArquivo> {
    this.diffsPedidos.push(arquivo.caminho);
    if (this.falhaNoDiff !== null) {
      throw this.falhaNoDiff;
    }
    return diffDoArquivo({ caminho: arquivo.caminho, diff: "@@ -1 +1 @@\n-a\n+b\n", truncado: true, binario: false });
  }
}

const raiz = path.resolve("/projetos");
const caminhoDoWorktree = path.resolve("/worktrees/o1");
const COM_ACENTO = "docs/relatório final.md";

const arquivos = [
  arquivoAlterado({
    caminho: "src/app.ts",
    caminhoAnterior: "src/antigo.ts",
    situacao: "renomeado",
    adicoes: 3,
    remocoes: 1,
    binario: false,
  }),
  arquivoAlterado({
    caminho: COM_ACENTO,
    caminhoAnterior: null,
    situacao: "nao_rastreado",
    adicoes: 10,
    remocoes: null,
    binario: false,
  }),
];

describe("rotas de alterações do worktree", () => {
  let servidor: Server;
  let base: string;
  let repositorio: RepositorioEmMemoria;
  let leitor: LeitorFalso;
  let orquestrador: Orquestrador;

  beforeAll(async () => {
    repositorio = new RepositorioEmMemoria();
    const aplicacao = express();
    aplicacao.use(
      "/api",
      criarAlteracoesRoutes({
        servico: new ServicoDeAlteracoes({
          repositorio,
          // O leitor muda a cada teste; a rota sempre usa o atual.
          leitor: {
            ehRepositorioComHead: () => leitor.ehRepositorioComHead(),
            listarArquivos: () => leitor.listarArquivos(),
            contarCommitsNaBranch: () => leitor.contarCommitsNaBranch(),
            lerDiff: (caminho, arquivo) => leitor.lerDiff(caminho, arquivo),
          },
        }),
      }),
    );
    servidor = aplicacao.listen(0, "127.0.0.1");
    await once(servidor, "listening");
    base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}/api`;
  });

  afterAll(async () => {
    servidor.close();
    await once(servidor, "close");
  });

  beforeEach(() => {
    leitor = new LeitorFalso();
    orquestrador = Orquestrador.criar({
      id: "o1",
      nome: "Painel",
      pastaDeTrabalho: PastaDeTrabalho.dentroDe(raiz, "painel"),
      sessaoId: "s1",
      configuracao: ConfiguracaoDoOrquestrador.de({
        modeloDoOrquestrador: "opus",
        modeloDosSubagentes: "sonnet",
        quantidadeDeSubagentes: { modo: "automatica", limite: 2 },
        nivelDePermissao: "edicao_e_comandos",
      }),
      agora: new Date("2026-11-05T10:00:00Z"),
    });
    repositorio.orquestradores.set(orquestrador.id, orquestrador);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function urlDoDiff(arquivo: string): string {
    return `${base}/orquestradores/o1/alteracoes/diff?arquivo=${encodeURIComponent(arquivo)}`;
  }

  describe("GET /orquestradores/:id/alteracoes", () => {
    it("200 com_worktree com branch, caminho, uso, commits e arquivos", async () => {
      orquestrador.usarWorktree("orquestrador/o1", caminhoDoWorktree);
      leitor.arquivos = arquivos;
      leitor.commitsNaBranch = 1;

      const resposta = await fetch(`${base}/orquestradores/o1/alteracoes`);

      expect(resposta.status).toBe(200);
      expect(await resposta.json()).toEqual({
        situacao: "com_worktree",
        branch: "orquestrador/o1",
        caminho: caminhoDoWorktree,
        emUso: true,
        commitsNaBranch: 1,
        arquivos: [
          {
            caminho: "src/app.ts",
            caminhoAnterior: "src/antigo.ts",
            situacao: "renomeado",
            adicoes: 3,
            remocoes: 1,
            binario: false,
          },
          {
            caminho: COM_ACENTO,
            caminhoAnterior: null,
            situacao: "nao_rastreado",
            adicoes: 10,
            remocoes: null,
            binario: false,
          },
        ],
      });
    });

    it.each<[string, boolean]>([
      ["sem_git", false],
      ["sem_worktree", true],
    ])("200 %s quando não há worktree", async (situacao, repositorioComHead) => {
      leitor.repositorioComHead = repositorioComHead;

      const resposta = await fetch(`${base}/orquestradores/o1/alteracoes`);

      expect(resposta.status).toBe(200);
      expect(await resposta.json()).toEqual({
        situacao,
        branch: null,
        caminho: null,
        emUso: false,
        commitsNaBranch: 0,
        arquivos: [],
      });
    });

    it("404 para orquestrador inexistente", async () => {
      const resposta = await fetch(`${base}/orquestradores/nao-existe/alteracoes`);

      expect(resposta.status).toBe(404);
      expect(await resposta.json()).toEqual({ erro: "Orquestrador não encontrado." });
    });

    it("500 com mensagem pronta quando o git falha, e o motivo vai para o log", async () => {
      orquestrador.usarWorktree("orquestrador/o1", caminhoDoWorktree);
      const motivo = new Error("fatal: not a git repository");
      leitor.falha = motivo;
      const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

      const resposta = await fetch(`${base}/orquestradores/o1/alteracoes`);

      expect(resposta.status).toBe(500);
      expect(await resposta.json()).toEqual({ erro: "Não foi possível ler as alterações do worktree." });
      expect(log).toHaveBeenCalledWith(expect.stringContaining("[alteracoes]"), motivo);
    });
  });

  describe("GET /orquestradores/:id/alteracoes/diff", () => {
    beforeEach(() => {
      orquestrador.usarWorktree("orquestrador/o1", caminhoDoWorktree);
      leitor.arquivos = arquivos;
    });

    it("200 com o diff de um arquivo da lista, inclusive com acento e espaço no nome", async () => {
      const resposta = await fetch(urlDoDiff(COM_ACENTO));

      expect(resposta.status).toBe(200);
      expect(await resposta.json()).toEqual({
        caminho: COM_ACENTO,
        diff: "@@ -1 +1 @@\n-a\n+b\n",
        truncado: true,
        binario: false,
      });
      expect(leitor.diffsPedidos).toEqual([COM_ACENTO]);
    });

    it.each([
      ["sem o parâmetro", ""],
      ["com o parâmetro vazio", "?arquivo="],
      ["com o parâmetro repetido", "?arquivo=src%2Fapp.ts&arquivo=outro"],
    ])("400 %s", async (_caso, query) => {
      const resposta = await fetch(`${base}/orquestradores/o1/alteracoes/diff${query}`);

      expect(resposta.status).toBe(400);
      expect(await resposta.json()).toEqual({ erro: "Informe o arquivo." });
      expect(leitor.diffsPedidos).toEqual([]);
    });

    it.each([["../../segredo.txt"], ["src/nao-alterado.ts"], [path.join(caminhoDoWorktree, "src/app.ts")]])(
      "404 para %j, que não está entre as alterações",
      async (arquivo) => {
        const resposta = await fetch(urlDoDiff(arquivo));

        expect(resposta.status).toBe(404);
        expect(await resposta.json()).toEqual({ erro: "Arquivo não está entre as alterações." });
        expect(leitor.diffsPedidos).toEqual([]);
      },
    );

    it("404 para orquestrador inexistente", async () => {
      const resposta = await fetch(`${base}/orquestradores/nao-existe/alteracoes/diff?arquivo=src%2Fapp.ts`);

      expect(resposta.status).toBe(404);
      expect(await resposta.json()).toEqual({ erro: "Orquestrador não encontrado." });
    });

    it("500 quando o git falha ao montar o diff", async () => {
      leitor.falhaNoDiff = new Error("git demorou mais de 15000 ms e foi encerrado.");
      vi.spyOn(console, "error").mockImplementation(() => undefined);

      const resposta = await fetch(urlDoDiff("src/app.ts"));

      expect(resposta.status).toBe(500);
      expect(await resposta.json()).toEqual({ erro: "Não foi possível ler as alterações do worktree." });
    });
  });
});
