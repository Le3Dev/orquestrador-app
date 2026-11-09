import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { api } from "../../shared/api/cliente";
import type {
  ConteudoDoModeloDeCanvas,
  DadosDaConfiguracao,
  DadosDoModeloDeCanvas,
} from "../../shared/api/tipos";
import { DialogoDeNovoModelo, PainelDeModelos } from "./PainelDeModelos";

const configuracao: DadosDaConfiguracao = {
  modeloDoOrquestrador: "opus",
  esforcoDoOrquestrador: "padrao",
  modeloDosSubagentes: "sonnet",
  esforcoDosSubagentes: "padrao",
  quantidadeDeSubagentes: { modo: "automatica", limite: 3 },
  nivelDePermissao: "edicao",
  permitirCommitEPush: false,
  instrucoesPersonalizadas: "",
};

function modelo(id: string, alteracoes: Partial<DadosDoModeloDeCanvas> = {}): DadosDoModeloDeCanvas {
  return {
    id,
    nome: `Modelo ${id}`,
    icone: "🧩",
    cor: "#d97757",
    itens: [
      { tipo: "orquestrador", x: 0, y: 0, nome: "Backend", pastaDeTrabalho: "/projetos/api", configuracao },
      { tipo: "nota", x: 640, y: 0, titulo: "Pendências", texto: "" },
      { tipo: "terminal", x: 0, y: 560, pasta: "/projetos/api", comando: "npm run dev" },
    ],
    criadoEm: "2026-11-09T12:00:00.000Z",
    atualizadoEm: "2026-11-09T12:00:00.000Z",
    ...alteracoes,
  };
}

describe("PainelDeModelos", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function abrir(lista: DadosDoModeloDeCanvas[] = [modelo("m1"), modelo("m2", { nome: "Front", icone: "🌐" })]) {
    vi.spyOn(api, "listarModelosDeCanvas").mockResolvedValue(lista);
    const aoFechar = vi.fn();
    const aoRecriar = vi.fn(async () => [
      { rotulo: 'Orquestrador "Backend"', noId: "o9", erro: null },
      { rotulo: 'Nota "Pendências"', noId: "nota:n9", erro: null },
      { rotulo: "Terminal", noId: null, erro: 'A pasta "/projetos/api" não existe.' },
    ]);
    // A lista chega logo depois de montar: dentro do act, sem aviso do React.
    await act(async () => {
      render(<PainelDeModelos aoFechar={aoFechar} aoRecriar={aoRecriar} />);
    });
    const painel = screen.getByRole("region", { name: "Modelos de canvas" });
    return { aoFechar, aoRecriar, painel };
  }

  it("lista os modelos com o nome e a contagem por tipo", async () => {
    await abrir();

    const lista = await screen.findByRole("list", { name: "Lista de modelos" });
    const itens = within(lista).getAllByRole("listitem");
    expect(itens).toHaveLength(2);
    expect(itens[0]).toHaveTextContent("Modelo m1");
    expect(itens[0]).toHaveTextContent("1 orquestrador · 1 nota · 1 terminal");
    expect(itens[1]).toHaveTextContent("Front");
    expect(screen.getByText("2 / 50")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Exportar sem comandos, caminhos e tokens" })).toBeChecked();
  });

  it("Recriar entrega o modelo à página e mostra o resultado com o erro de cada item", async () => {
    const { aoRecriar } = await abrir();

    fireEvent.click(await screen.findByRole("button", { name: "Recriar Modelo m1" }));

    await waitFor(() => expect(aoRecriar).toHaveBeenCalledWith(expect.objectContaining({ id: "m1" }), null));
    const resultado = await screen.findByRole("status", { name: "Resultado da recriação" });
    expect(resultado).toHaveTextContent('"Modelo m1": 2 de 3 itens recriados, parados (nenhum pedido foi enviado).');
    expect(resultado).toHaveTextContent('Terminal: A pasta "/projetos/api" não existe.');
  });

  it("um modelo sem pastas pede a pasta antes de recriar", async () => {
    vi.spyOn(api, "navegarPastas").mockResolvedValue({ caminho: "/projetos", pai: null, pastas: [] } as never);
    const semPasta = modelo("m3", {
      nome: "Sem pasta",
      itens: [{ tipo: "orquestrador", x: 0, y: 0, nome: "Backend", configuracao }],
    });
    const { aoRecriar } = await abrir([semPasta]);

    fireEvent.click(await screen.findByRole("button", { name: "Recriar Sem pasta" }));

    expect(aoRecriar).not.toHaveBeenCalled();
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("renomear troca nome, ícone e cor pelo servidor", async () => {
    const alterar = vi
      .spyOn(api, "alterarModeloDeCanvas")
      .mockResolvedValue(modelo("m1", { nome: "Backend novo", icone: "🚀", cor: "#5aa9e6" }));
    await abrir();

    fireEvent.click(await screen.findByRole("button", { name: "Renomear Modelo m1" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Nome" }), { target: { value: "Backend novo" } });
    fireEvent.click(screen.getByRole("radio", { name: "Ícone 🚀" }));
    fireEvent.click(screen.getByRole("radio", { name: "Cor azul" }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => expect(screen.getByText("Backend novo")).toBeInTheDocument());
    expect(alterar).toHaveBeenCalledWith("m1", { nome: "Backend novo", icone: "🚀", cor: "#5aa9e6" });
  });

  it("apagar pede confirmação e tira o modelo da lista", async () => {
    const confirmar = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    const remover = vi.spyOn(api, "removerModeloDeCanvas").mockResolvedValue(null);
    await abrir();

    fireEvent.click(await screen.findByRole("button", { name: "Apagar Front" }));
    expect(remover).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Apagar Front" }));

    await waitFor(() => expect(screen.queryByText("Front")).not.toBeInTheDocument());
    expect(confirmar).toHaveBeenCalledWith('Apagar o modelo "Front"? O que já foi recriado no canvas continua lá.');
    expect(remover).toHaveBeenCalledWith("m2");
  });

  it("exportar pede o arquivo sem caminhos por padrão e com eles se a opção for desmarcada", async () => {
    const exportar = vi.spyOn(api, "exportarModeloDeCanvas").mockResolvedValue({
      formato: "orquestrador-de-agentes/modelo-de-canvas",
      versao: 1,
      exportadoEm: "2026-11-09T12:00:00.000Z",
      modelo: { nome: "Modelo m1", icone: "🧩", cor: "#d97757", itens: [] },
    });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    // O jsdom não tem `URL.createObjectURL`: entra um falso só neste teste.
    const anteriores = { criar: URL.createObjectURL, liberar: URL.revokeObjectURL };
    URL.createObjectURL = vi.fn(() => "blob:modelo");
    URL.revokeObjectURL = vi.fn();
    const baixados: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      baixados.push(this.download);
    });
    try {
      await abrir();

      fireEvent.click(await screen.findByRole("button", { name: "Exportar Modelo m1" }));
      await waitFor(() => expect(baixados).toHaveLength(1));
      fireEvent.click(screen.getByRole("checkbox", { name: "Exportar sem comandos, caminhos e tokens" }));
      fireEvent.click(screen.getByRole("button", { name: "Exportar Modelo m1" }));
      await waitFor(() => expect(baixados).toHaveLength(2));

      expect(baixados).toEqual(["modelo-modelo-m1.json", "modelo-modelo-m1.json"]);
      expect(exportar.mock.calls).toEqual([
        ["m1", true],
        ["m1", false],
      ]);
      await act(async () => {
        await vi.runOnlyPendingTimersAsync();
      });
      expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:modelo");
    } finally {
      vi.useRealTimers();
      URL.createObjectURL = anteriores.criar;
      URL.revokeObjectURL = anteriores.liberar;
    }
  });

  it("importar mostra o resumo do arquivo e só salva depois de confirmar, sem recriar nada", async () => {
    const importado: ConteudoDoModeloDeCanvas = {
      nome: "Importado",
      icone: "🧪",
      cor: "#6bbf73",
      itens: [
        { tipo: "orquestrador", x: 0, y: 0, nome: "A", pastaDeTrabalho: "/projetos/a", configuracao },
        { tipo: "orquestrador", x: 700, y: 0, nome: "B", configuracao },
        { tipo: "previa", x: 0, y: 600, url: "https://exemplo.com" },
        { tipo: "terminal", x: 800, y: 600, pasta: "/projetos/a", comando: "npm test" },
      ],
    };
    const conferir = vi.spyOn(api, "conferirImportacaoDeModelo").mockResolvedValue(importado);
    const criar = vi.spyOn(api, "criarModeloDeCanvas").mockResolvedValue({
      ...importado,
      id: "m9",
      criadoEm: "2026-11-09T12:00:00.000Z",
      atualizadoEm: "2026-11-09T12:00:00.000Z",
    });
    const { aoRecriar } = await abrir([]);
    await screen.findByText("Nenhum modelo ainda");

    const arquivo = new File([JSON.stringify({ formato: "x", modelo: importado })], "modelo-importado.json", {
      type: "application/json",
    });
    fireEvent.change(screen.getByLabelText("Arquivo do modelo"), { target: { files: [arquivo] } });

    const resumo = await screen.findByRole("region", { name: "Resumo da importação" });
    expect(conferir).toHaveBeenCalledWith({ formato: "x", modelo: importado });
    expect(within(resumo).getByTestId("contagem-do-modelo")).toHaveTextContent("2 orquestradores · 1 prévia · 1 terminal");
    expect(within(resumo).getByRole("list", { name: "Pastas do modelo" })).toHaveTextContent("/projetos/a");
    expect(within(resumo).getByRole("list", { name: "Comandos do modelo" })).toHaveTextContent("$ npm test");
    expect(resumo).toHaveTextContent("1 item está sem pasta: ao recriar, o app pede uma pasta para ele.");
    expect(criar).not.toHaveBeenCalled();

    fireEvent.click(within(resumo).getByRole("button", { name: "Salvar modelo" }));

    await waitFor(() => expect(screen.getByRole("list", { name: "Lista de modelos" })).toHaveTextContent("Importado"));
    expect(criar).toHaveBeenCalledWith(importado);
    expect(aoRecriar).not.toHaveBeenCalled();
  });

  it("um arquivo que não é JSON mostra o erro e não chama o servidor", async () => {
    const conferir = vi.spyOn(api, "conferirImportacaoDeModelo");
    await abrir([]);

    const arquivo = new File(["isto não é json"], "quebrado.json", { type: "application/json" });
    fireEvent.change(screen.getByLabelText("Arquivo do modelo"), { target: { files: [arquivo] } });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      'Não foi possível importar "quebrado.json": O arquivo não é um JSON válido.',
    );
    expect(conferir).not.toHaveBeenCalled();
  });

  it("Esc e o × fecham o painel", async () => {
    const { aoFechar } = await abrir();
    await screen.findByRole("list", { name: "Lista de modelos" });

    fireEvent.keyDown(document.body, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Fechar modelos" }));

    expect(aoFechar).toHaveBeenCalledTimes(2);
  });
});

describe("DialogoDeNovoModelo", () => {
  const arranjo = {
    itens: modelo("m1").itens,
    ignorados: ["um artefato (artefatos ficam fora dos modelos)"],
  };

  it("mostra o que vai e o que fica de fora, e só salva com nome", async () => {
    const aoSalvar = vi.fn(async () => undefined);
    render(<DialogoDeNovoModelo arranjo={arranjo} aoSalvar={aoSalvar} aoFechar={vi.fn()} />);

    const dialogo = screen.getByRole("dialog", { name: "Salvar como modelo" });
    expect(within(dialogo).getByTestId("contagem-do-modelo")).toHaveTextContent("1 orquestrador · 1 nota · 1 terminal");
    expect(dialogo).toHaveTextContent("Ficam de fora: um artefato (artefatos ficam fora dos modelos).");
    expect(within(dialogo).getByRole("button", { name: "Salvar modelo" })).toBeDisabled();

    fireEvent.change(within(dialogo).getByRole("textbox", { name: "Nome" }), { target: { value: "  Backend  " } });
    fireEvent.click(within(dialogo).getByRole("radio", { name: "Ícone 🛠️" }));
    fireEvent.click(within(dialogo).getByRole("radio", { name: "Cor verde" }));
    fireEvent.click(within(dialogo).getByRole("button", { name: "Salvar modelo" }));

    await waitFor(() =>
      expect(aoSalvar).toHaveBeenCalledWith({ nome: "Backend", icone: "🛠️", cor: "#6bbf73", itens: arranjo.itens }),
    );
  });

  it("mostra o erro do servidor e continua aberto", async () => {
    const aoSalvar = vi.fn(async () => {
      throw new Error("Você já tem 50 modelos. Apague um antes de salvar outro.");
    });
    render(<DialogoDeNovoModelo arranjo={arranjo} aoSalvar={aoSalvar} aoFechar={vi.fn()} />);

    fireEvent.change(screen.getByRole("textbox", { name: "Nome" }), { target: { value: "X" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar modelo" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Você já tem 50 modelos.");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
