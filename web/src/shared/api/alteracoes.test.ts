import {
  type AlteracoesDoWorktree,
  apiDeAlteracoes,
  classificarLinhasDoDiff,
  textoDosCommitsNaBranch,
} from "./alteracoes";
import { ErroDaApi } from "./cliente";

function alteracoes(commitsNaBranch: number, branch: string | null = "orquestrador/o1"): AlteracoesDoWorktree {
  return { situacao: "com_worktree", branch, caminho: "C:/w/o1", emUso: false, commitsNaBranch, arquivos: [] };
}

describe("textoDosCommitsNaBranch", () => {
  it("avisa os commits da branch no plural e no singular", () => {
    expect(textoDosCommitsNaBranch(alteracoes(3))).toBe("3 commits na branch orquestrador/o1 não aparecem aqui.");
    expect(textoDosCommitsNaBranch(alteracoes(1))).toBe("1 commit na branch orquestrador/o1 não aparece aqui.");
  });

  it("não avisa sem commits ou sem branch", () => {
    expect(textoDosCommitsNaBranch(alteracoes(0))).toBeNull();
    expect(textoDosCommitsNaBranch(alteracoes(2, null))).toBeNull();
  });
});

describe("classificarLinhasDoDiff", () => {
  it("separa cabeçalho, trecho, adições, remoções e contexto", () => {
    const diff = [
      "diff --git a/x.sql b/x.sql",
      "index 1..2 100644",
      "--- a/x.sql",
      "+++ b/x.sql",
      "@@ -1,3 +1,3 @@",
      " select 1;",
      "--- comentário removido",
      "+-- comentário novo",
      "\\ No newline at end of file",
      "",
    ].join("\n");

    expect(classificarLinhasDoDiff(diff).map((linha) => linha.tipo)).toEqual([
      "cabecalho",
      "cabecalho",
      "cabecalho",
      "cabecalho",
      "trecho",
      "contexto",
      "remocao",
      "adicao",
      "observacao",
    ]);
  });

  it("tira o \\r do fim das linhas e devolve nada para diff vazio", () => {
    expect(classificarLinhasDoDiff("@@ -1 +1 @@\r\n+a\r\n")).toEqual([
      { texto: "@@ -1 +1 @@", tipo: "trecho" },
      { texto: "+a", tipo: "adicao" },
    ]);
    expect(classificarLinhasDoDiff("")).toEqual([]);
  });
});

function respostaJson(corpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json" } });
}

describe("apiDeAlteracoes", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("consulta as alterações do orquestrador", async () => {
    const corpo = {
      situacao: "com_worktree",
      branch: "orquestrador/o1",
      caminho: "C:/dados/worktrees/o1",
      emUso: false,
      commitsNaBranch: 0,
      arquivos: [],
    };
    const buscar = vi.spyOn(globalThis, "fetch").mockResolvedValue(respostaJson(corpo));

    await expect(apiDeAlteracoes.consultar("o 1")).resolves.toEqual(corpo);
    expect(buscar.mock.calls[0]?.[0]).toBe("/api/orquestradores/o%201/alteracoes");
  });

  it("pede o diff com o arquivo codificado na query", async () => {
    const buscar = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(respostaJson({ caminho: "src/a b&c.ts", diff: "", truncado: false, binario: false }));

    await apiDeAlteracoes.lerDiff("o1", "src/a b&c.ts");

    const endereco = String(buscar.mock.calls[0]?.[0]);
    expect(endereco.startsWith("/api/orquestradores/o1/alteracoes/diff?")).toBe(true);
    expect(new URLSearchParams(endereco.split("?")[1]).get("arquivo")).toBe("src/a b&c.ts");
  });

  it("devolve a mensagem de erro do servidor", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(respostaJson({ erro: "Arquivo não está entre as alterações." }, 404));

    const falha = apiDeAlteracoes.lerDiff("o1", "x.ts");

    await expect(falha).rejects.toBeInstanceOf(ErroDaApi);
    await expect(falha).rejects.toThrow("Arquivo não está entre as alterações.");
  });

  it("explica quando o servidor não responde", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(apiDeAlteracoes.consultar("o1")).rejects.toThrow("Não foi possível falar com o servidor");
  });
});
