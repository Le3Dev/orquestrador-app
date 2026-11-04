import { describe, expect, it, vi } from "vitest";

import {
  caminhoDaSaida,
  comandoDoSeletor,
  executarSeletor,
  ExecutorDoSeletor,
  SeletorDePastaIndisponivel,
  SeletorDePastaNativo,
} from "./SeletorDePastaNativo";

describe("comandoDoSeletor", () => {
  it("macOS: osascript com choose folder; a pasta inicial vai como argumento, fora do script", () => {
    const comando = comandoDoSeletor("darwin", "/Users/ana/projetos");

    expect(comando?.comando).toBe("osascript");
    expect(comando?.argumentos[0]).toBe("-e");
    expect(comando?.argumentos[1]).toContain("choose folder");
    expect(comando?.argumentos[1]).not.toContain("/Users/ana");
    expect(comando?.argumentos[2]).toBe("/Users/ana/projetos");
  });

  it("Windows: PowerShell em STA com o script codificado; a pasta inicial vai por variável de ambiente", () => {
    const comando = comandoDoSeletor("win32", "C:\\Users\\ana\\projetos");

    expect(comando?.comando).toBe("powershell.exe");
    expect(comando?.argumentos).toContain("-STA");
    const script = Buffer.from(comando?.argumentos.at(-1) ?? "", "base64").toString("utf16le");
    expect(script).toContain("FolderBrowserDialog");
    expect(script).toContain("TopMost");
    expect(script).not.toContain("C:\\Users\\ana");
    expect(comando?.ambiente).toEqual({ ORQUESTRADOR_PASTA_INICIAL: "C:\\Users\\ana\\projetos" });
  });

  it("Linux: zenity, e sair com 1 é cancelar", () => {
    const comando = comandoDoSeletor("linux", "/home/ana");

    expect(comando?.comando).toBe("zenity");
    expect(comando?.argumentos).toContain("--directory");
    expect(comando?.argumentos).toContain("--filename=/home/ana/");
    expect(comando?.codigosDeCancelamento).toEqual([1]);
  });

  it("sem pasta inicial, não manda argumento nem variável", () => {
    expect(comandoDoSeletor("darwin", undefined)?.argumentos).toHaveLength(2);
    expect(comandoDoSeletor("win32", undefined)?.ambiente).toBeUndefined();
  });

  it("outros sistemas não têm janela", () => {
    expect(comandoDoSeletor("freebsd", undefined)).toBeNull();
  });
});

describe("caminhoDaSaida", () => {
  it.each([
    ["/Users/ana/meu-app/\n", "/Users/ana/meu-app"],
    ["\uFEFFC:\\Users\\ana\\Área de trabalho", "C:\\Users\\ana\\Área de trabalho"],
    ["C:\\", "C:\\"],
    ["/", "/"],
    ["", null],
    ["  \n", null],
  ])("%j vira %j", (saida, caminho) => {
    expect(caminhoDaSaida(saida)).toBe(caminho);
  });
});

describe("SeletorDePastaNativo", () => {
  const nuncaCancelado = new AbortController().signal;

  function seletor(executar: ExecutorDoSeletor, plataforma: NodeJS.Platform = "darwin") {
    return new SeletorDePastaNativo(plataforma, executar);
  }

  it("devolve a pasta escolhida", async () => {
    const executar = vi.fn<ExecutorDoSeletor>().mockResolvedValue({ codigo: 0, saida: "/Users/ana/app/\n", erro: "" });

    expect(await seletor(executar).escolher("/Users/ana", nuncaCancelado)).toBe("/Users/ana/app");
  });

  it("cancelar (saída vazia, código de cancelamento ou processo encerrado) devolve nulo", async () => {
    expect(await seletor(async () => ({ codigo: 0, saida: "", erro: "" })).escolher(undefined, nuncaCancelado)).toBeNull();
    expect(
      await seletor(async () => ({ codigo: 1, saida: "", erro: "" }), "linux").escolher(undefined, nuncaCancelado),
    ).toBeNull();
    expect(await seletor(async () => ({ codigo: null, saida: "", erro: "" })).escolher(undefined, nuncaCancelado)).toBeNull();
  });

  it("falha do comando vira 'indisponível', com o erro dele", async () => {
    const falhou = seletor(async () => ({ codigo: 1, saida: "", erro: "execução bloqueada" }), "win32");

    await expect(falhou.escolher(undefined, nuncaCancelado)).rejects.toThrow(SeletorDePastaIndisponivel);
    await expect(falhou.escolher(undefined, nuncaCancelado)).rejects.toThrow(/execução bloqueada/);
  });

  it("sistema sem janela conhecida é 'indisponível' sem rodar nada", async () => {
    const executar = vi.fn<ExecutorDoSeletor>();

    await expect(seletor(executar, "aix").escolher(undefined, nuncaCancelado)).rejects.toThrow(SeletorDePastaIndisponivel);
    expect(executar).not.toHaveBeenCalled();
  });

  it("o sinal entregue ao processo é cancelado pela tela e pelo tempo máximo", async () => {
    let recebido: AbortSignal | undefined;
    const executar: ExecutorDoSeletor = (_comando, sinal) =>
      new Promise((resolver) => {
        recebido = sinal;
        sinal.addEventListener("abort", () => resolver({ codigo: null, saida: "", erro: "" }));
      });
    const tela = new AbortController();

    const pelaTela = seletor(executar).escolher(undefined, tela.signal);
    tela.abort();
    expect(await pelaTela).toBeNull();
    expect(recebido?.aborted).toBe(true);

    const comPrazo = new SeletorDePastaNativo("darwin", executar, 20);
    expect(await comPrazo.escolher(undefined, nuncaCancelado)).toBeNull();
  });

  it("comando que não existe no sistema vira 'indisponível'", async () => {
    await expect(
      executarSeletor(
        { comando: "comando-que-nao-existe-xyz", argumentos: [], codigosDeCancelamento: [] },
        nuncaCancelado,
      ),
    ).rejects.toThrow(SeletorDePastaIndisponivel);
  });
});
