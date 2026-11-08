import { destacarCodigo, linguagemDoArquivo, linhasDoTexto, MAXIMO_DE_LINHAS_PARA_DESTACAR } from "./destaqueDeSintaxe";

const destacar = vi.hoisted(() => vi.fn(async (codigo: string) => codigo.split("\n").map((texto) => [{ texto }])));
vi.mock("./destaqueComShiki", () => ({ prepararDestacador: vi.fn(async () => ({})), destacar }));

describe("linguagemDoArquivo", () => {
  it.each([
    ["src/app.ts", "typescript"],
    ["src/Tela.tsx", "tsx"],
    ["vite.config.mjs", "javascript"],
    ["Componente.jsx", "javascript"],
    ["package.json", "json"],
    ["web/src/theme/index.css", "css"],
    ["index.html", "html"],
    ["README.MD", "markdown"],
    ["scripts/rodar.py", "python"],
    ["banco/001.sql", "sql"],
    [".github/workflows/ci.yml", "yaml"],
    ["docker-compose.yaml", "yaml"],
    ["scripts/subir.sh", "shellscript"],
    [".zshrc", "shellscript"],
  ])("%s → %s", (caminho, linguagem) => {
    expect(linguagemDoArquivo(caminho)).toBe(linguagem);
  });

  it.each([["LICENSE"], ["notas.txt"], [".gitignore"], ["pasta.ts/Makefile"]])("%s fica em texto puro", (caminho) => {
    expect(linguagemDoArquivo(caminho)).toBeNull();
  });
});

describe("linhasDoTexto", () => {
  it("tira a linha vazia da quebra final e aceita \\r\\n", () => {
    expect(linhasDoTexto("")).toEqual([]);
    expect(linhasDoTexto("a\n")).toEqual(["a"]);
    expect(linhasDoTexto("a\r\n\r\nb")).toEqual(["a", "", "b"]);
  });
});

describe("destacarCodigo", () => {
  it("manda ao shiki o texto sem a quebra final e devolve uma linha destacada por linha", async () => {
    expect(await destacarCodigo("a\r\nb\n", "typescript")).toEqual([[{ texto: "a" }], [{ texto: "b" }]]);
    expect(destacar).toHaveBeenCalledWith("a\nb", "typescript");
  });

  it("devolve null sem chamar o shiki quando o arquivo tem linhas demais", async () => {
    destacar.mockClear();

    expect(await destacarCodigo("x\n".repeat(MAXIMO_DE_LINHAS_PARA_DESTACAR + 1), "python")).toBeNull();
    expect(destacar).not.toHaveBeenCalled();
  });
});
