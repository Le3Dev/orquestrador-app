import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it } from "vitest";

import { Artefato, DadosDoArtefato } from "./Artefato";
import { DesenhoGravado, desenhoVazio } from "./DesenhoDoArtefato";
import { EntradaDeArtefatos } from "./EntradaDeArtefatos";
import { ErroDeArtefato } from "./ErroDeArtefato";
import { EventoDeArtefato } from "./EventoDeArtefato";
import { OrigemDoArtefato } from "./OrigemDoArtefato";
import { ConteudoDaVersao, RepositorioDeArtefatos } from "./RepositorioDeArtefatos";
import { ArquivoColetado, ServicoDeArtefatos } from "./ServicoDeArtefatos";

/** Repositório em memória, com a mesma semântica de cópias do de arquivos. */
class RepositorioEmMemoria implements RepositorioDeArtefatos {
  readonly dados = new Map<string, DadosDoArtefato>();
  readonly conteudos = new Map<string, Buffer>();
  readonly desenhos = new Map<string, DesenhoGravado>();

  todos(): readonly Artefato[] {
    return [...this.dados.values()].map((dados) => Artefato.reconstituir(dados));
  }
  buscar(id: string): Artefato | null {
    const dados = this.dados.get(id);
    return dados === undefined ? null : Artefato.reconstituir(dados);
  }
  buscarPorArquivo(origem: OrigemDoArtefato, arquivo: string): Artefato | null {
    return this.todos().find((artefato) => artefato.vemDe(origem, arquivo)) ?? null;
  }
  async salvar(artefato: Artefato, novaVersao?: ConteudoDaVersao): Promise<void> {
    this.dados.set(artefato.id, artefato.paraDados());
    if (novaVersao !== undefined) {
      this.conteudos.set(`${artefato.id}/${novaVersao.numero}`, novaVersao.conteudo);
    }
  }
  async lerConteudo(id: string, numero: number): Promise<Buffer | null> {
    return this.conteudos.get(`${id}/${numero}`) ?? null;
  }
  async lerDesenho(id: string, numero: number): Promise<DesenhoGravado | null> {
    if ((this.buscar(id)?.versao(numero) ?? null) === null) {
      return null;
    }
    const desenho = this.desenhos.get(`${id}/${numero}`);
    return desenho === undefined ? desenhoVazio() : { tracos: [...desenho.tracos], largura: desenho.largura };
  }
  async salvarDesenho(id: string, numero: number, { tracos, largura }: DesenhoGravado): Promise<boolean> {
    if ((this.buscar(id)?.versao(numero) ?? null) === null) {
      return false;
    }
    if (tracos.length === 0) {
      this.desenhos.delete(`${id}/${numero}`);
    } else {
      this.desenhos.set(`${id}/${numero}`, { tracos: [...tracos], largura });
    }
    return true;
  }
  async remover(id: string): Promise<void> {
    this.dados.delete(id);
  }
}

function arquivo(nome: string, texto: string, origem = OrigemDoArtefato.doChat()): ArquivoColetado {
  const conteudo = Buffer.from(texto);
  return { origem, arquivo: nome, conteudo, hash: createHash("sha256").update(conteudo).digest("hex") };
}

describe("ServicoDeArtefatos", () => {
  let repositorio: RepositorioEmMemoria;
  let eventos: EventoDeArtefato[];
  let removidosDaEntrada: string[];
  let servico: ServicoDeArtefatos;
  let ids: number;

  beforeEach(() => {
    repositorio = new RepositorioEmMemoria();
    eventos = [];
    removidosDaEntrada = [];
    ids = 0;
    const entrada: EntradaDeArtefatos = {
      removerArquivo: async (origem, nome) => {
        removidosDaEntrada.push(`${origem.tipo}:${origem.id ?? ""}:${nome}`);
      },
    };
    servico = new ServicoDeArtefatos({
      repositorio,
      entrada,
      publicador: { publicar: (evento) => eventos.push(evento) },
      gerarId: () => `art-${++ids}`,
      agora: () => new Date("2026-11-05T12:00:00Z"),
    });
  });

  it("coleta: cria, adiciona versão e ignora conteúdo repetido, avisando as telas", async () => {
    expect(await servico.coletar(arquivo("a.html", "<p>1</p>"))).toBe("criado");
    expect(await servico.coletar(arquivo("a.html", "<p>2</p>"))).toBe("versao_adicionada");
    expect(await servico.coletar(arquivo("a.html", "<p>2</p>"))).toBe("sem_mudanca");

    expect(servico.listar()).toHaveLength(1);
    expect(eventos.map((evento) => evento.tipo)).toEqual(["artefato_criado", "versao_adicionada"]);
    expect((await servico.lerVersao("art-1", 2)).conteudo.toString()).toBe("<p>2</p>");
  });

  it("o mesmo nome em origens diferentes são artefatos diferentes", async () => {
    await servico.coletar(arquivo("a.html", "x"));
    await servico.coletar(arquivo("a.html", "x", OrigemDoArtefato.doOrquestrador("orq-1")));

    expect(servico.listar()).toHaveLength(2);
  });

  it("duas coletas simultâneas do mesmo arquivo não criam dois artefatos", async () => {
    await Promise.all([servico.coletar(arquivo("a.md", "# a")), servico.coletar(arquivo("a.md", "# a"))]);

    expect(servico.listar()).toHaveLength(1);
    expect(servico.listar()[0]?.versoes).toHaveLength(1);
  });

  it("renomear avisa as telas só quando muda", async () => {
    await servico.coletar(arquivo("a.html", "x"));

    await servico.renomear("art-1", "Painel");
    await servico.renomear("art-1", "Painel");

    expect(eventos.map((evento) => evento.tipo)).toEqual(["artefato_criado", "artefato_renomeado"]);
  });

  it("remover apaga o arquivo da entrada e o artefato, e avisa as telas", async () => {
    await servico.coletar(arquivo("a.html", "x", OrigemDoArtefato.doOrquestrador("orq-1")));

    await servico.remover("art-1");

    expect(removidosDaEntrada).toEqual(["orquestrador:orq-1:a.html"]);
    expect(servico.listar()).toEqual([]);
    expect(eventos.at(-1)).toEqual({ tipo: "artefato_removido", id: "art-1" });
  });

  it("artefato ou versão inexistente é nao_encontrado", async () => {
    await servico.coletar(arquivo("a.html", "x"));

    await expect(servico.remover("nao-existe")).rejects.toThrow(ErroDeArtefato);
    await expect(servico.lerVersao("art-1", 9)).rejects.toThrow("Versão não encontrada.");
    expect(() => servico.buscar("nao-existe")).toThrow("Artefato não encontrado.");
  });
});
