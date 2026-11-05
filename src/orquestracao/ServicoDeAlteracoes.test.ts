import path from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import {
  ArquivoAlterado,
  arquivoAlterado,
  DiffDoArquivo,
  diffDoArquivo,
  ErroDeLeituraDasAlteracoes,
  LeitorDeAlteracoes,
} from "./AlteracoesDoWorktree";
import { ConfiguracaoDoOrquestrador } from "./ConfiguracaoDoOrquestrador";
import { ErroDeOrquestracao } from "./ErroDeOrquestracao";
import { EventoDeOrquestracao, EventoRegistrado } from "./EventoDeOrquestracao";
import { Orquestrador } from "./Orquestrador";
import { PastaDeTrabalho } from "./PastaDeTrabalho";
import { ConversaArquivada, RepositorioDeOrquestradores } from "./RepositorioDeOrquestradores";
import { ServicoDeAlteracoes } from "./ServicoDeAlteracoes";

class RepositorioEmMemoria implements RepositorioDeOrquestradores {
  readonly orquestradores = new Map<string, Orquestrador>();
  salvos = 0;

  listar(): readonly Orquestrador[] {
    return [...this.orquestradores.values()];
  }
  buscarPorId(id: string): Orquestrador | null {
    return this.orquestradores.get(id) ?? null;
  }
  async salvar(orquestrador: Orquestrador): Promise<void> {
    this.salvos += 1;
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

/** Leitor falso: responde o combinado e guarda o que foi pedido. */
class LeitorFalso implements LeitorDeAlteracoes {
  repositorioComHead = true;
  arquivos: readonly ArquivoAlterado[] = [];
  commitsNaBranch = 0;
  falha: Error | null = null;
  falhaNoDiff: Error | null = null;
  readonly chamadas: string[] = [];
  readonly diffsPedidos: Array<{ caminhoDoWorktree: string; arquivo: ArquivoAlterado }> = [];

  async ehRepositorioComHead(pasta: string): Promise<boolean> {
    this.chamadas.push(`ehRepositorioComHead ${pasta}`);
    return this.repositorioComHead;
  }
  async listarArquivos(caminhoDoWorktree: string): Promise<readonly ArquivoAlterado[]> {
    this.chamadas.push(`listarArquivos ${caminhoDoWorktree}`);
    if (this.falha !== null) {
      throw this.falha;
    }
    return this.arquivos;
  }
  async contarCommitsNaBranch(caminhoDoWorktree: string, pastaOriginal: string): Promise<number> {
    this.chamadas.push(`contarCommitsNaBranch ${caminhoDoWorktree} ${pastaOriginal}`);
    return this.commitsNaBranch;
  }
  async lerDiff(caminhoDoWorktree: string, arquivo: ArquivoAlterado): Promise<DiffDoArquivo> {
    this.diffsPedidos.push({ caminhoDoWorktree, arquivo });
    if (this.falhaNoDiff !== null) {
      throw this.falhaNoDiff;
    }
    return diffDoArquivo({ caminho: arquivo.caminho, diff: `diff de ${arquivo.caminho}\n`, truncado: false, binario: false });
  }
}

const raiz = path.resolve("/projetos");
const caminhoDoWorktree = path.resolve("/worktrees/o1");

const modificado = arquivoAlterado({
  caminho: "src/app.ts",
  caminhoAnterior: null,
  situacao: "modificado",
  adicoes: 3,
  remocoes: 1,
  binario: false,
});
const comAcento = arquivoAlterado({
  caminho: "docs/relatório final.md",
  caminhoAnterior: null,
  situacao: "nao_rastreado",
  adicoes: 10,
  remocoes: null,
  binario: false,
});

function capturar<T>(promessa: Promise<T>): Promise<unknown> {
  return promessa.then(
    () => {
      throw new Error("Era esperado um erro.");
    },
    (erro: unknown) => erro,
  );
}

describe("ServicoDeAlteracoes", () => {
  let repositorio: RepositorioEmMemoria;
  let leitor: LeitorFalso;
  let servico: ServicoDeAlteracoes;
  let orquestrador: Orquestrador;

  beforeEach(() => {
    repositorio = new RepositorioEmMemoria();
    leitor = new LeitorFalso();
    servico = new ServicoDeAlteracoes({ repositorio, leitor });
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

  describe("consultar", () => {
    it("sem worktree numa pasta que não é repositório git: sem_git", async () => {
      leitor.repositorioComHead = false;

      const alteracoes = await servico.consultar("o1");

      expect(alteracoes.paraDados()).toEqual({
        situacao: "sem_git",
        branch: null,
        caminho: null,
        emUso: false,
        commitsNaBranch: 0,
        arquivos: [],
      });
      expect(leitor.chamadas).toEqual([`ehRepositorioComHead ${path.join(raiz, "painel")}`]);
    });

    it("sem worktree num repositório git: sem_worktree, sem listar arquivos", async () => {
      const alteracoes = await servico.consultar("o1");

      expect(alteracoes.paraDados()).toMatchObject({ situacao: "sem_worktree", branch: null, caminho: null, arquivos: [] });
      expect(leitor.chamadas.some((chamada) => chamada.startsWith("listarArquivos"))).toBe(false);
    });

    it("com worktree: lista os arquivos e conta os commits da branch contra a pasta original", async () => {
      orquestrador.usarWorktree("orquestrador/o1", caminhoDoWorktree);
      leitor.arquivos = [modificado, comAcento];
      leitor.commitsNaBranch = 2;

      const alteracoes = await servico.consultar("o1");

      expect(alteracoes.paraDados()).toEqual({
        situacao: "com_worktree",
        branch: "orquestrador/o1",
        caminho: caminhoDoWorktree,
        emUso: true,
        commitsNaBranch: 2,
        arquivos: [
          { caminho: "src/app.ts", caminhoAnterior: null, situacao: "modificado", adicoes: 3, remocoes: 1, binario: false },
          {
            caminho: "docs/relatório final.md",
            caminhoAnterior: null,
            situacao: "nao_rastreado",
            adicoes: 10,
            remocoes: null,
            binario: false,
          },
        ],
      });
      expect(leitor.chamadas).toContain(`contarCommitsNaBranch ${caminhoDoWorktree} ${path.join(raiz, "painel")}`);
      expect(Object.isFrozen(alteracoes)).toBe(true);
      expect(Object.isFrozen(alteracoes.arquivos)).toBe(true);
    });

    it("worktree liberado entre turnos não está em uso", async () => {
      orquestrador.usarWorktree("orquestrador/o1", caminhoDoWorktree);
      orquestrador.liberarWorktree();

      expect((await servico.consultar("o1")).emUso).toBe(false);
    });

    it("não grava nada no agregado", async () => {
      orquestrador.usarWorktree("orquestrador/o1", caminhoDoWorktree);

      await servico.consultar("o1");

      expect(repositorio.salvos).toBe(0);
    });

    it("falha do git vira ErroDeLeituraDasAlteracoes, com o motivo em cause", async () => {
      orquestrador.usarWorktree("orquestrador/o1", caminhoDoWorktree);
      const motivo = new Error("git diff falhou (código 128)");
      leitor.falha = motivo;

      const erro = await capturar(servico.consultar("o1"));

      expect(erro).toBeInstanceOf(ErroDeLeituraDasAlteracoes);
      expect(erro).toMatchObject({ message: "Não foi possível ler as alterações do worktree.", cause: motivo });
    });

    it("orquestrador inexistente: nao_encontrado", async () => {
      const erro = await capturar(servico.consultar("nao-existe"));

      expect(erro).toBeInstanceOf(ErroDeOrquestracao);
      expect(erro).toMatchObject({ motivo: "nao_encontrado", message: "Orquestrador não encontrado." });
    });
  });

  describe("lerDiff", () => {
    beforeEach(() => {
      orquestrador.usarWorktree("orquestrador/o1", caminhoDoWorktree);
      leitor.arquivos = [modificado, comAcento];
    });

    it("lê o diff do arquivo da lista, entregando ao leitor o item da lista", async () => {
      const diff = await servico.lerDiff("o1", "docs/relatório final.md");

      expect(diff).toEqual({
        caminho: "docs/relatório final.md",
        diff: "diff de docs/relatório final.md\n",
        truncado: false,
        binario: false,
      });
      expect(leitor.diffsPedidos).toEqual([{ caminhoDoWorktree, arquivo: comAcento }]);
      expect(leitor.diffsPedidos[0]?.arquivo).toBe(comAcento);
    });

    it.each([["../segredo.txt"], ["src/APP.ts"], ["src/app.ts "], [path.join(caminhoDoWorktree, "src/app.ts")]])(
      "recusa %j, que não está exatamente na lista, sem chamar o leitor",
      async (pedido) => {
        const erro = await capturar(servico.lerDiff("o1", pedido));

        expect(erro).toBeInstanceOf(ErroDeOrquestracao);
        expect(erro).toMatchObject({ motivo: "nao_encontrado", message: "Arquivo não está entre as alterações." });
        expect(leitor.diffsPedidos).toEqual([]);
      },
    );

    it("sem worktree, nenhum arquivo está entre as alterações", async () => {
      orquestrador.limparWorktree();

      const erro = await capturar(servico.lerDiff("o1", "src/app.ts"));

      expect(erro).toMatchObject({ motivo: "nao_encontrado", message: "Arquivo não está entre as alterações." });
      expect(leitor.chamadas).toEqual([]);
    });

    it("falha ao listar ou ao ler o diff vira ErroDeLeituraDasAlteracoes", async () => {
      leitor.falhaNoDiff = new Error("timeout");
      const noDiff = await capturar(servico.lerDiff("o1", "src/app.ts"));
      leitor.falha = new Error("worktree sumiu");
      const naLista = await capturar(servico.lerDiff("o1", "src/app.ts"));

      expect(noDiff).toBeInstanceOf(ErroDeLeituraDasAlteracoes);
      expect(naLista).toBeInstanceOf(ErroDeLeituraDasAlteracoes);
      expect(naLista).toMatchObject({ message: "Não foi possível ler as alterações do worktree." });
    });

    it("orquestrador inexistente: nao_encontrado", async () => {
      const erro = await capturar(servico.lerDiff("nao-existe", "src/app.ts"));

      expect(erro).toMatchObject({ motivo: "nao_encontrado", message: "Orquestrador não encontrado." });
    });
  });
});
