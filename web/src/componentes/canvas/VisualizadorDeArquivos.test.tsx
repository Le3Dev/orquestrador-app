import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { MockInstance } from "vitest";

import { api, ErroDaApi } from "../../shared/api/cliente";
import type { ConteudoDoArquivo, ListagemDaPasta } from "../../shared/api/tipos";
import { VisualizadorDeArquivos } from "./VisualizadorDeArquivos";

// O shiki de verdade é pesado: aqui o destaque pinta cada linha inteira de azul.
const destacar = vi.hoisted(() =>
  vi.fn(async (codigo: string) => codigo.split("\n").map((linha) => [{ texto: linha, cor: "#569cd6" }])),
);
vi.mock("../../shared/destaqueComShiki", () => ({
  prepararDestacador: vi.fn(async () => ({})),
  destacar,
}));

const PASTAS: Readonly<Record<string, ListagemDaPasta>> = {
  "": {
    caminho: "",
    entradas: [
      { nome: "src", tipo: "pasta" },
      { nome: "README.md", tipo: "arquivo", tamanho: 9 },
      { nome: "notas.txt", tipo: "arquivo", tamanho: 12 },
    ],
    truncada: false,
  },
  src: { caminho: "src", entradas: [{ nome: "app.ts", tipo: "arquivo", tamanho: 26 }], truncada: false },
};

const ARQUIVOS: Readonly<Record<string, ConteudoDoArquivo>> = {
  "src/app.ts": { caminho: "src/app.ts", conteudo: "const a = 1;\nconst b = 2;\n", tamanho: 26, linhas: 2 },
  "notas.txt": { caminho: "notas.txt", conteudo: "primeira\n\nterceira", tamanho: 18, linhas: 3 },
};

let listarArquivos: MockInstance<typeof api.listarArquivos>;
let lerArquivo: MockInstance<typeof api.lerArquivo>;

beforeEach(() => {
  destacar.mockClear();
  listarArquivos = vi.spyOn(api, "listarArquivos").mockImplementation(async (_id, caminho = "") => {
    const listagem = PASTAS[caminho];
    if (listagem === undefined) {
      throw new ErroDaApi("Pasta não existe.", 404);
    }
    return listagem;
  });
  lerArquivo = vi.spyOn(api, "lerArquivo").mockImplementation(async (_id, caminho) => {
    const arquivo = ARQUIVOS[caminho];
    if (arquivo === undefined) {
      throw new ErroDaApi(`"${caminho}" não existe.`, 404);
    }
    return arquivo;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function renderizar() {
  const aoFechar = vi.fn();
  render(<VisualizadorDeArquivos orquestradorId="o1" nomeDoOrquestrador="Painel" aoFechar={aoFechar} />);
  return { aoFechar };
}

function arvore() {
  return within(screen.getByRole("list", { name: "Arquivos da pasta" }));
}

describe("VisualizadorDeArquivos", () => {
  it("abre como diálogo e lista só a raiz, com as pastas fechadas", async () => {
    renderizar();

    expect(screen.getByRole("dialog", { name: "Arquivos" })).toBeInTheDocument();
    expect(await arvore().findByRole("button", { name: "README.md" })).toBeInTheDocument();
    expect(arvore().getByRole("button", { name: "src" })).toHaveAttribute("aria-expanded", "false");
    expect(arvore().queryByRole("button", { name: "app.ts" })).toBeNull();
    expect(listarArquivos).toHaveBeenCalledTimes(1);
    expect(listarArquivos).toHaveBeenCalledWith("o1", "");
    expect(screen.getByText("Escolha um arquivo para ver o conteúdo.")).toBeInTheDocument();
  });

  it("expande uma pasta sob demanda e não a lê de novo ao reabrir", async () => {
    renderizar();
    const pasta = await arvore().findByRole("button", { name: "src" });

    fireEvent.click(pasta);

    expect(pasta).toHaveAttribute("aria-expanded", "true");
    expect(await arvore().findByRole("button", { name: "app.ts" })).toBeInTheDocument();
    expect(listarArquivos).toHaveBeenLastCalledWith("o1", "src");

    fireEvent.click(pasta);
    expect(arvore().queryByRole("button", { name: "app.ts" })).toBeNull();

    fireEvent.click(pasta);
    expect(arvore().getByRole("button", { name: "app.ts" })).toBeInTheDocument();
    expect(listarArquivos).toHaveBeenCalledTimes(2);
  });

  it("abre um arquivo com o caminho no topo, números de linha e destaque de sintaxe", async () => {
    renderizar();
    fireEvent.click(await arvore().findByRole("button", { name: "src" }));
    fireEvent.click(await arvore().findByRole("button", { name: "app.ts" }));

    const codigo = await screen.findByLabelText("Conteúdo de src/app.ts");
    expect(lerArquivo).toHaveBeenCalledWith("o1", "src/app.ts");
    expect(screen.getByTitle("src/app.ts")).toHaveTextContent("src/app.ts");
    expect(screen.getByText("2 linhas · 26 B")).toBeInTheDocument();
    expect(arvore().getByRole("button", { name: "app.ts" })).toHaveAttribute("aria-current", "true");

    await waitFor(() => expect(codigo).toHaveAttribute("data-destacado", "true"));
    expect(destacar).toHaveBeenCalledWith("const a = 1;\nconst b = 2;", "typescript");
    const linhas = codigo.querySelectorAll(".linha-do-codigo");
    expect(linhas).toHaveLength(2);
    expect(linhas[0]?.querySelector(".numero-da-linha")).toHaveTextContent("1");
    expect(linhas[1]?.querySelector(".numero-da-linha")).toHaveTextContent("2");
    expect(within(linhas[1] as HTMLElement).getByText("const b = 2;")).toHaveStyle({ color: "#569cd6" });
  });

  it("sem linguagem conhecida, mostra texto puro com números, inclusive a linha vazia", async () => {
    renderizar();
    fireEvent.click(await arvore().findByRole("button", { name: "notas.txt" }));

    const codigo = await screen.findByLabelText("Conteúdo de notas.txt");
    const linhas = codigo.querySelectorAll(".linha-do-codigo");
    expect([...linhas].map((linha) => linha.querySelector(".texto-da-linha-do-codigo")?.textContent)).toEqual([
      "primeira",
      " ",
      "terceira",
    ]);
    expect(linhas[2]?.querySelector(".numero-da-linha")).toHaveTextContent("3");
    expect(codigo).toHaveAttribute("data-destacado", "false");
    expect(destacar).not.toHaveBeenCalled();
  });

  it("com o destaque falhando, o arquivo continua em texto puro", async () => {
    destacar.mockRejectedValueOnce(new Error("gramática quebrada"));
    renderizar();
    fireEvent.click(await arvore().findByRole("button", { name: "src" }));
    fireEvent.click(await arvore().findByRole("button", { name: "app.ts" }));

    const codigo = await screen.findByLabelText("Conteúdo de src/app.ts");
    await waitFor(() => expect(destacar).toHaveBeenCalled());
    expect(codigo).toHaveAttribute("data-destacado", "false");
    expect(within(codigo).getByText("const a = 1;")).toBeInTheDocument();
  });

  it.each([
    [413, "Arquivo grande demais", '"README.md" tem 600 KB; o visualizador abre arquivos de até 500 KB.'],
    [415, "Arquivo binário", '"README.md" é um arquivo binário e não dá para mostrar como texto.'],
    [403, "Arquivo bloqueado", '"README.md" está bloqueado.'],
  ])("recusa %i vira um aviso amigável, sem tentar de novo", async (status, titulo, mensagem) => {
    lerArquivo.mockRejectedValueOnce(new ErroDaApi(mensagem, status));
    renderizar();
    fireEvent.click(await arvore().findByRole("button", { name: "README.md" }));

    const aviso = await screen.findByRole("alert");
    expect(aviso).toHaveTextContent(titulo);
    expect(aviso).toHaveTextContent(mensagem);
    expect(within(aviso).queryByRole("button", { name: "tentar de novo" })).toBeNull();
  });

  it("falha inesperada mostra o erro com tentar de novo", async () => {
    lerArquivo.mockRejectedValueOnce(new ErroDaApi("Erro inesperado no servidor: EACCES", 500));
    renderizar();
    fireEvent.click(await arvore().findByRole("button", { name: "notas.txt" }));

    const aviso = await screen.findByRole("alert");
    expect(aviso).toHaveTextContent("Erro inesperado no servidor: EACCES");
    fireEvent.click(within(aviso).getByRole("button", { name: "tentar de novo" }));

    expect(await screen.findByLabelText("Conteúdo de notas.txt")).toBeInTheDocument();
    expect(lerArquivo).toHaveBeenCalledTimes(2);
  });

  it("erro ao listar a raiz aparece na árvore com tentar de novo", async () => {
    listarArquivos.mockRejectedValueOnce(new ErroDaApi("A pasta do orquestrador não existe mais: /x", 404));
    renderizar();

    expect(await arvore().findByText(/A pasta do orquestrador não existe mais/)).toBeInTheDocument();
    fireEvent.click(arvore().getByRole("button", { name: "tentar de novo" }));

    expect(await arvore().findByRole("button", { name: "README.md" })).toBeInTheDocument();
  });

  it("Esc e clique no fundo fecham; clique dentro do painel não", async () => {
    const { aoFechar } = renderizar();
    const dialogo = screen.getByRole("dialog");
    await arvore().findByRole("button", { name: "README.md" });

    fireEvent.mouseDown(dialogo);
    expect(aoFechar).not.toHaveBeenCalled();

    fireEvent.keyDown(dialogo, { key: "Escape" });
    expect(aoFechar).toHaveBeenCalledTimes(1);

    fireEvent.mouseDown(screen.getByTestId("fundo-do-visualizador-de-arquivos"));
    expect(aoFechar).toHaveBeenCalledTimes(2);
  });
});
