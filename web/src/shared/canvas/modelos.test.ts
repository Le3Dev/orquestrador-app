import type { DadosDaConfiguracao, ItemDoModelo, ResumoDoOrquestrador } from "../api/tipos";
import {
  arranjoDaSelecao,
  type CriadoresDosItens,
  descreverContagem,
  lerArquivoDeModelo,
  nomeDoArquivoDoModelo,
  recriarItens,
  resumirModelo,
  tamanhoDoArranjo,
} from "./modelos";
import { novaPrevia, novoShell, novoTerminal, type NoDoCanvas } from "./nos";

const configuracao: DadosDaConfiguracao = {
  modeloDoOrquestrador: "opus",
  esforcoDoOrquestrador: "padrao",
  modeloDosSubagentes: "sonnet",
  esforcoDosSubagentes: "padrao",
  quantidadeDeSubagentes: { modo: "automatica", limite: 3 },
  nivelDePermissao: "edicao",
  permitirCommitEPush: false,
  instrucoesPersonalizadas: "Rode os testes.",
};

function orquestrador(id: string): ResumoDoOrquestrador {
  return {
    id,
    nome: `Orquestrador ${id}`,
    pastaDeTrabalho: `/projetos/${id}`,
    nomeDaPasta: id,
    situacao: "ocioso",
    configuracao,
    instrucoesAtivas: null,
    criadoEm: "2026-11-09T12:00:00Z",
    totalDeTurnos: 4,
    ultimoTurno: null,
    worktree: null,
  };
}

function selecionado<T extends NoDoCanvas>(no: T): T {
  return { ...no, selected: true };
}

const leitores = {
  orquestrador: (id: string) => (id === "o1" ? orquestrador("o1") : undefined),
  nota: (notaId: string) => (notaId === "n1" ? { titulo: "Pendências", texto: "- [ ] revisar" } : null),
};

describe("arranjoDaSelecao", () => {
  it("guarda as telas selecionadas com posições relativas ao canto, sem conversa, worktree nem id", () => {
    const nos: NoDoCanvas[] = [
      selecionado(novoTerminal("o1", { x: 100, y: 200 }, 600, 520)),
      selecionado(novaPrevia("p1", { x: 760, y: 260 }, { url: "http://localhost:5173", orquestradorId: "o1" })),
      selecionado(novoShell("s1", { x: 100, y: 800 }, { terminalId: "t1", pasta: "/projetos/o1", orquestradorId: null })),
      // Fora da seleção: não entra.
      novoTerminal("o2", { x: 5000, y: 5000 }, 600, 520),
    ];

    const { itens, ignorados } = arranjoDaSelecao(nos, leitores);

    expect(ignorados).toEqual([]);
    expect(itens).toEqual([
      {
        tipo: "orquestrador",
        x: 0,
        y: 0,
        largura: 600,
        altura: 520,
        nome: "Orquestrador o1",
        pastaDeTrabalho: "/projetos/o1",
        configuracao,
      },
      { tipo: "previa", x: 660, y: 60, largura: 720, altura: 520, url: "http://localhost:5173" },
      { tipo: "terminal", x: 0, y: 600, largura: 640, altura: 400, pasta: "/projetos/o1" },
    ]);
    expect(JSON.stringify(itens)).not.toMatch(/"id"|worktree|totalDeTurnos|terminalId/);
  });

  it("artefatos, rascunhos e orquestradores que não carregaram ficam de fora, com o motivo", () => {
    const nos = [
      selecionado(novoTerminal("o1", { x: 0, y: 0 }, 600, 520)),
      selecionado(novoTerminal("o9", { x: 700, y: 0 }, 600, 520)),
      { id: "artefato:a1", type: "artefato", position: { x: 0, y: 700 }, data: { artefatoId: "a1" }, selected: true },
      { id: "rascunho:r1", type: "rascunho", position: { x: 700, y: 700 }, data: {}, selected: true },
    ] as NoDoCanvas[];

    const { itens, ignorados } = arranjoDaSelecao(nos, leitores);

    expect(itens.map((item) => item.tipo)).toEqual(["orquestrador"]);
    expect(ignorados).toEqual([
      "um orquestrador que ainda não carregou",
      "um artefato (artefatos ficam fora dos modelos)",
      "um formulário de orquestrador ainda não criado",
    ]);
  });
});

describe("resumo e nomes", () => {
  const itens: ItemDoModelo[] = [
    { tipo: "orquestrador", x: 0, y: 0, nome: "A", pastaDeTrabalho: "/a", configuracao },
    { tipo: "orquestrador", x: 700, y: 0, nome: "B", configuracao },
    { tipo: "nota", x: 0, y: 600, titulo: "N", texto: "" },
    { tipo: "terminal", x: 400, y: 600, pasta: "/a", comando: "npm run dev" },
  ];

  it("conta por tipo, junta as pastas e lista os comandos", () => {
    const resumo = resumirModelo(itens);

    expect(resumo).toEqual({
      orquestradores: 2,
      notas: 1,
      previas: 0,
      terminais: 1,
      pastas: ["/a"],
      comandos: ["npm run dev"],
      semPasta: 1,
    });
    expect(descreverContagem(resumo)).toBe("2 orquestradores · 1 nota · 1 terminal");
    expect(tamanhoDoArranjo(itens)).toEqual({ largura: 1300, altura: 1000 });
  });

  it("o nome do arquivo exportado e a leitura do JSON importado", () => {
    expect(nomeDoArquivoDoModelo("Backend com Prévia!")).toBe("modelo-backend-com-previa.json");
    expect(nomeDoArquivoDoModelo("🧪")).toBe("modelo-de-canvas.json");
    expect(lerArquivoDeModelo('{"a":1}')).toEqual({ a: 1 });
    expect(() => lerArquivoDeModelo("não é json")).toThrow("O arquivo não é um JSON válido.");
  });
});

describe("recriarItens", () => {
  function criadores(): CriadoresDosItens & { [K in keyof CriadoresDosItens]: ReturnType<typeof vi.fn> } {
    return {
      orquestrador: vi.fn(async (item) => `o:${item.nome}`),
      nota: vi.fn(async () => "nota:n1"),
      previa: vi.fn(async () => "previa:p1"),
      terminal: vi.fn(async () => "shell:s1"),
    } as never;
  }

  it("cria cada item no lugar dele a partir da origem, com o tamanho padrão quando falta", async () => {
    const criar = criadores();
    const resultados = await recriarItens(
      [
        { tipo: "orquestrador", x: 0, y: 0, largura: 500, altura: 400, nome: "A", pastaDeTrabalho: "/a", configuracao },
        { tipo: "nota", x: 640, y: 20, titulo: "N", texto: "t" },
      ],
      { x: 1000, y: 2000 },
      null,
      criar,
    );

    expect(criar.orquestrador).toHaveBeenCalledWith(
      expect.objectContaining({ nome: "A" }),
      { x: 1000, y: 2000, largura: 500, altura: 400 },
      "/a",
    );
    expect(criar.nota).toHaveBeenCalledWith(expect.objectContaining({ titulo: "N" }), {
      x: 1640,
      y: 2020,
      largura: 320,
      altura: 280,
    });
    expect(resultados).toEqual([
      { rotulo: 'Orquestrador "A"', noId: "o:A", erro: null },
      { rotulo: 'Nota "N"', noId: "nota:n1", erro: null },
    ]);
  });

  it("a pasta escolhida vale para os sem pasta; sem ela, o item falha e os outros seguem", async () => {
    const criar = criadores();
    criar.orquestrador.mockRejectedValueOnce(new Error('A pasta "/sumiu" não existe.'));
    const itens: ItemDoModelo[] = [
      { tipo: "orquestrador", x: 0, y: 0, nome: "Sumiu", pastaDeTrabalho: "/sumiu", configuracao },
      { tipo: "terminal", x: 0, y: 600 },
      { tipo: "previa", x: 700, y: 0, url: "" },
    ];

    const semPasta = await recriarItens(itens, { x: 0, y: 0 }, null, criar);
    expect(semPasta.map((resultado) => resultado.erro)).toEqual([
      'A pasta "/sumiu" não existe.',
      "Escolha uma pasta para recriar este item.",
      null,
    ]);

    await recriarItens(itens, { x: 0, y: 0 }, "/escolhida", criar);
    expect(criar.terminal).toHaveBeenCalledWith(expect.objectContaining({ tipo: "terminal" }), expect.anything(), "/escolhida");
  });
});
