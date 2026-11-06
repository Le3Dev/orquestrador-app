import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as esperar } from "node:timers/promises";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OrigemDoArtefato } from "../../artefatos/OrigemDoArtefato";
import { ServicoDeArtefatos } from "../../artefatos/ServicoDeArtefatos";
import {
  ColetorDeArtefatosEmPasta,
  PastaDeEntradaDosArtefatos,
  TAMANHO_MAXIMO_DO_ARTEFATO,
} from "./ColetorDeArtefatosEmPasta";
import { RepositorioDeArtefatosEmArquivo } from "./RepositorioDeArtefatosEmArquivo";

const ESPERA_MS = 40;
const POLL = { timeout: 5_000, interval: 20 };

describe("PastaDeEntradaDosArtefatos", () => {
  const entrada = new PastaDeEntradaDosArtefatos(path.join(tmpdir(), "entrada"));

  it("identifica a origem pelo caminho: chat/<arquivo> e orquestradores/<id>/<arquivo>", () => {
    expect(entrada.identificar("chat\\painel.html")).toEqual({
      origem: OrigemDoArtefato.doChat(),
      arquivo: "painel.html",
      caminho: path.join(entrada.caminho, "chat", "painel.html"),
    });
    expect(entrada.identificar("orquestradores/orq-1/relatorio.md")).toEqual({
      origem: OrigemDoArtefato.doOrquestrador("orq-1"),
      arquivo: "relatorio.md",
      caminho: path.join(entrada.caminho, "orquestradores", "orq-1", "relatorio.md"),
    });
  });

  it.each([
    ["chat"],
    ["chat\\notas.txt"],
    ["chat\\sub\\x.html"],
    ["orquestradores\\orq-1"],
    ["orquestradores\\orq-1\\sub\\x.html"],
    ["orquestradores\\x.html"],
    ["outra\\x.html"],
    ["x.html"],
    ["chat\\painel.html.tmp"],
  ])("ignora %j", (relativo) => {
    expect(entrada.identificar(relativo)).toBeNull();
  });
});

describe("ColetorDeArtefatosEmPasta", () => {
  let pasta: string;
  let entrada: PastaDeEntradaDosArtefatos;
  let repositorio: RepositorioDeArtefatosEmArquivo;
  let servico: ServicoDeArtefatos;
  let coletores: ColetorDeArtefatosEmPasta[];
  let ids: number;

  beforeEach(async () => {
    pasta = await mkdtemp(path.join(tmpdir(), "coletor-artefatos-teste-"));
    entrada = new PastaDeEntradaDosArtefatos(path.join(pasta, "artefatos", "entrada"));
    repositorio = await RepositorioDeArtefatosEmArquivo.abrir(pasta);
    ids = 0;
    coletores = [];
    servico = new ServicoDeArtefatos({
      repositorio,
      entrada,
      publicador: { publicar: () => undefined },
      gerarId: () => `art-${++ids}`,
      agora: () => new Date(),
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(coletores.map((coletor) => coletor.encerrar()));
    await repositorio.aguardarGravacoes();
    await rm(pasta, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  function novoColetor(esperaMs = ESPERA_MS): ColetorDeArtefatosEmPasta {
    const coletor = new ColetorDeArtefatosEmPasta({ entrada, servico, esperaMs });
    coletores.push(coletor);
    return coletor;
  }

  async function gravar(relativo: string, conteudo: string | Buffer): Promise<void> {
    const caminho = path.join(entrada.caminho, relativo);
    await mkdir(path.dirname(caminho), { recursive: true });
    await writeFile(caminho, conteudo);
  }

  function versoesDe(arquivo: string): number[] {
    const artefato = repositorio.todos().find((candidato) => candidato.arquivo === arquivo);
    return artefato?.versoes.map((versao) => versao.numero) ?? [];
  }

  it("cria as pastas de entrada que faltarem", async () => {
    await novoColetor().iniciar();

    expect((await readdir(entrada.caminho)).sort()).toEqual(["chat", "orquestradores"]);
  });

  it("criar um .html cria o artefato; outro conteúdo cria a versão 2; o mesmo conteúdo não cria versão", async () => {
    await novoColetor().iniciar();

    await gravar("chat/painel.html", "<p>1</p>");
    await expect.poll(() => versoesDe("painel.html"), POLL).toEqual([1]);

    await gravar("chat/painel.html", "<p>2</p>");
    await expect.poll(() => versoesDe("painel.html"), POLL).toEqual([1, 2]);

    const coletar = vi.spyOn(servico, "coletar");
    await gravar("chat/painel.html", "<p>2</p>");
    await expect.poll(() => coletar.mock.calls.length, POLL).toBeGreaterThan(0);
    await Promise.all(coletar.mock.results.map((resultado) => resultado.value));

    expect(await Promise.all(coletar.mock.results.map((resultado) => resultado.value))).toContain("sem_mudanca");
    expect(versoesDe("painel.html")).toEqual([1, 2]);
    expect(repositorio.todos()).toHaveLength(1);
    expect((await repositorio.lerConteudo(repositorio.todos()[0]?.id ?? "", 2))?.toString()).toBe("<p>2</p>");
  });

  it("gravações em rajada (eventos repetidos) viram uma versão só, com o conteúdo final", async () => {
    const espera = 250;
    await novoColetor(espera).iniciar();

    for (let parte = 1; parte <= 10; parte++) {
      await gravar("chat/rajada.md", `# parte ${parte}`);
    }
    await expect.poll(() => versoesDe("rajada.md"), POLL).toEqual([1]);
    await esperar(espera * 2);

    expect(versoesDe("rajada.md")).toEqual([1]);
    const id = repositorio.todos()[0]?.id ?? "";
    expect((await repositorio.lerConteudo(id, 1))?.toString()).toBe("# parte 10");
  });

  it("ignora .txt e subpastas, e pega a origem pelo caminho", async () => {
    await novoColetor().iniciar();
    const coletar = vi.spyOn(servico, "coletar");

    await gravar("chat/notas.txt", "texto");
    await gravar("chat/sub/escondido.html", "<p>x</p>");
    await gravar("orquestradores/orq-1/sub/escondido.md", "# x");
    await gravar("orquestradores/orq-1/relatorio.md", "# relatório");
    await gravar("chat/painel.htm", "<p>chat</p>");

    await expect.poll(() => repositorio.todos().length, POLL).toBe(2);
    await esperar(ESPERA_MS * 5);

    const origens = repositorio
      .todos()
      .map((artefato) => [artefato.arquivo, artefato.formato, artefato.origem.paraDados()])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    expect(origens).toEqual([
      ["painel.htm", "html", { tipo: "chat", id: null }],
      ["relatorio.md", "markdown", { tipo: "orquestrador", id: "orq-1" }],
    ]);
    expect(new Set(coletar.mock.calls.map(([arquivo]) => arquivo.arquivo))).toEqual(
      new Set(["relatorio.md", "painel.htm"]),
    );
  });

  it("ignora arquivo com mais de 5 MB, com aviso claro no log", async () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await novoColetor().iniciar();

    await gravar("chat/grande.html", Buffer.alloc(TAMANHO_MAXIMO_DO_ARTEFATO + 1, "a"));

    await expect.poll(() => aviso.mock.calls.length, POLL).toBeGreaterThan(0);
    expect(String(aviso.mock.calls[0]?.[0])).toMatch(
      /^\[artefatos\] Arquivo "chat[\\/]grande\.html" ignorado: tem 5,0 MB, acima do limite de 5 MB por artefato\.$/,
    );
    expect(repositorio.todos()).toEqual([]);
  });

  it("ao iniciar, varre a entrada e coleta o que foi entregue com o servidor desligado", async () => {
    await gravar("chat/a.html", "<p>a</p>");
    await gravar("orquestradores/orq-1/b.md", "# b");
    await gravar("orquestradores/orq-1/ignorado.txt", "x");

    await novoColetor().iniciar();

    expect(
      repositorio
        .todos()
        .map((artefato) => `${artefato.origem.tipo}:${artefato.origem.id ?? "-"}:${artefato.arquivo}`)
        .sort(),
    ).toEqual(["chat:-:a.html", "orquestrador:orq-1:b.md"]);
  });

  it("a varredura de um novo início só cria versão do que mudou desde a última vez (pelo hash)", async () => {
    await gravar("chat/a.html", "<p>a</p>");
    await gravar("chat/b.html", "<p>b</p>");
    const primeiro = novoColetor();
    await primeiro.iniciar();
    await primeiro.encerrar();

    // Com o "servidor desligado": b muda, a fica igual.
    await gravar("chat/b.html", "<p>b2</p>");
    await novoColetor().iniciar();

    expect(versoesDe("a.html")).toEqual([1]);
    expect(versoesDe("b.html")).toEqual([1, 2]);
  });

  it("um arquivo apagado antes da coleta é só ignorado", async () => {
    const erro = vi.spyOn(console, "error");
    await novoColetor().iniciar();

    await gravar("chat/passageiro.html", "<p>x</p>");
    await rm(path.join(entrada.caminho, "chat", "passageiro.html"));
    await esperar(ESPERA_MS * 5);

    expect(repositorio.todos()).toEqual([]);
    expect(erro).not.toHaveBeenCalled();
  });

  it("removerArquivo apaga o arquivo entregue e não reclama se ele já não existe", async () => {
    await gravar("orquestradores/orq-1/x.md", "# x");

    await entrada.removerArquivo(OrigemDoArtefato.doOrquestrador("orq-1"), "x.md");
    await entrada.removerArquivo(OrigemDoArtefato.doOrquestrador("orq-1"), "x.md");

    await expect(stat(path.join(entrada.caminho, "orquestradores", "orq-1", "x.md"))).rejects.toThrow();
  });
});
