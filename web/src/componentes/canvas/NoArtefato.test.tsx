import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { type NodeProps, ReactFlowProvider } from "@xyflow/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Profiler, type ReactNode } from "react";

import { apiDosArtefatos, type ResumoDoArtefato } from "../../shared/api/artefatos";
import { ErroDaApi } from "../../shared/api/cliente";
import {
  type AcoesDosArtefatos,
  criarLojaDosArtefatos,
  type LojaDosArtefatos,
  ProvedorDosArtefatos,
} from "../../shared/canvas/artefatos";
import type { NoArtefato as TipoDoNo } from "../../shared/canvas/nos";
import { TAG_DO_SCRIPT_DE_NAVEGACAO } from "../../shared/navegacaoDoArtefato";
import {
  CONFIRMACAO_PARA_APAGAR_O_ARTEFATO,
  DURACAO_DO_DESTAQUE_MS,
  NoArtefato,
  POLITICA_DO_ARTEFATO,
} from "./NoArtefato";

/** A política de segurança e o script de voltar e avançar, que entram juntos no começo da página. */
const META = `<meta http-equiv="Content-Security-Policy" content="${POLITICA_DO_ARTEFATO}">${TAG_DO_SCRIPT_DE_NAVEGACAO}`;

function versao(numero: number, tamanho = 2150) {
  return { numero, criadaEm: `2026-11-0${numero}T12:00:00Z`, tamanho };
}

function artefato(id: string, alteracoes: Partial<ResumoDoArtefato> = {}): ResumoDoArtefato {
  return {
    id,
    titulo: "Relatório de vendas",
    formato: "html",
    origem: { tipo: "orquestrador", id: "o1" },
    arquivo: "relatorio.html",
    criadoEm: "2026-11-01T12:00:00Z",
    atualizadoEm: "2026-11-03T12:00:00Z",
    versaoAtual: 3,
    versoes: [versao(1), versao(2), versao(3)],
    ...alteracoes,
  };
}

/** As props que o React Flow passa ao nó. */
function propsDoNo(artefatoId: string): NodeProps<TipoDoNo> {
  return {
    id: `artefato:${artefatoId}`,
    type: "artefato",
    data: { artefatoId },
    selected: false,
    selectable: true,
    draggable: true,
    deletable: true,
    isConnectable: false,
    dragging: false,
    zIndex: 0,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
    width: 640,
    height: 480,
  };
}

/**
 * A loja com os artefatos e as ações ligadas à API (como o canvas faz pelo
 * hook): renomear chama o PATCH e apagar, o DELETE.
 */
function preparar(...artefatos: ResumoDoArtefato[]): {
  loja: LojaDosArtefatos;
  acoes: AcoesDosArtefatos;
  tela: (filhos: ReactNode) => ReactNode;
} {
  const loja = criarLojaDosArtefatos();
  loja.publicar({ lista: artefatos, carregada: true, erro: null });
  const acoes: AcoesDosArtefatos = {
    renomear: vi.fn(async (artefatoId: string, titulo: string) => {
      await apiDosArtefatos.renomear(artefatoId, titulo);
    }),
    apagar: vi.fn(async (artefatoId: string) => {
      await apiDosArtefatos.apagar(artefatoId);
    }),
    fechar: vi.fn(),
  };
  const valor = { loja, acoes };
  return {
    loja,
    acoes,
    tela: (filhos) => (
      <ReactFlowProvider>
        <ProvedorDosArtefatos valor={valor}>{filhos}</ProvedorDosArtefatos>
      </ReactFlowProvider>
    ),
  };
}

const iframe = (titulo = "Relatório de vendas") => screen.findByTitle(`Conteúdo do artefato: ${titulo}`);

/** O texto de um Blob (o `Blob.text()` não existe no jsdom). */
function lerBlob(blob: Blob): Promise<string> {
  return new Promise((resolver, rejeitar) => {
    const leitor = new FileReader();
    leitor.onload = () => resolver(String(leitor.result));
    leitor.onerror = () => rejeitar(leitor.error ?? new Error("Não deu para ler o Blob."));
    leitor.readAsText(blob);
  });
}

describe("NoArtefato", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("HTML vai num iframe com sandbox só allow-scripts e a política de segurança no começo do <head>", async () => {
    const ler = vi
      .spyOn(apiDosArtefatos, "lerVersao")
      .mockResolvedValue('<!DOCTYPE html><html><head><title>x</title></head><body><script>alert(1)</script></body></html>');
    const { tela } = preparar(artefato("a1"));
    render(tela(<NoArtefato {...propsDoNo("a1")} />));

    const pagina = await iframe();
    expect(ler).toHaveBeenCalledWith("a1", 3);
    expect(pagina.tagName).toBe("IFRAME");
    expect(pagina).toHaveAttribute("sandbox", "allow-scripts");
    expect(pagina.getAttribute("sandbox")).not.toContain("allow-same-origin");
    expect(pagina).toHaveClass("nodrag", "nowheel");
    expect(pagina.getAttribute("srcdoc")).toBe(
      `<!DOCTYPE html><html><head>${META}<title>x</title></head><body><script>alert(1)</script></body></html>`,
    );
    expect(screen.getByRole("img", { name: "Página HTML" })).toBeInTheDocument();
  });

  it("no canvas, a página fica atrás da camada de ativar: clique ou Enter ativa; pointerdown fora e Esc desativam", async () => {
    vi.spyOn(apiDosArtefatos, "lerVersao").mockResolvedValue("<p>x</p>");
    const { tela } = preparar(artefato("a1"));
    render(tela(<NoArtefato {...propsDoNo("a1")} />));
    const pagina = await iframe();
    const camada = screen.getByRole("button", { name: "Usar a página" });

    expect(pagina).toHaveStyle({ pointerEvents: "none" });
    expect(camada.closest(".nowheel, .nodrag")).toBeNull();

    fireEvent.click(camada);
    expect(screen.queryByRole("button", { name: "Usar a página" })).not.toBeInTheDocument();
    expect(pagina).not.toHaveStyle({ pointerEvents: "none" });
    expect(pagina).toHaveFocus();

    fireEvent.pointerDown(document.body);
    expect(pagina).toHaveStyle({ pointerEvents: "none" });

    fireEvent.keyDown(screen.getByRole("button", { name: "Usar a página" }), { key: "Enter" });
    expect(pagina).not.toHaveStyle({ pointerEvents: "none" });
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.getByRole("button", { name: "Usar a página" })).toBeInTheDocument();
    // Ativar e desativar não recria a página.
    expect(await iframe()).toBe(pagina);
  });

  it("em tela cheia a página não tem a camada de ativar", async () => {
    vi.spyOn(apiDosArtefatos, "lerVersao").mockResolvedValue("<p>x</p>");
    const { tela } = preparar(artefato("a1"));
    render(tela(<NoArtefato {...propsDoNo("a1")} />));
    await iframe();

    fireEvent.click(screen.getByRole("button", { name: "Ampliar o artefato" }));

    const modal = screen.getByRole("dialog", { name: "Relatório de vendas" });
    expect(within(modal).queryByRole("button", { name: "Usar a página" })).not.toBeInTheDocument();
    expect(within(modal).getByTitle("Conteúdo do artefato: Relatório de vendas")).not.toHaveStyle({ pointerEvents: "none" });
  });

  describe("voltar e avançar dentro da página", () => {
    const AVISO = { origem: "orquestrador-artefato", suportado: true, podeVoltar: true, podeAvancar: false };

    /** A mensagem chega à janela do app, como a do iframe (`source` é a janela dele). */
    function avisar(de: Window | null, dados: unknown): void {
      act(() => {
        window.dispatchEvent(new MessageEvent("message", { data: dados, source: de }));
      });
    }

    async function abrir(alteracoes: Partial<ResumoDoArtefato> = {}) {
      vi.spyOn(apiDosArtefatos, "lerVersao").mockResolvedValue("<p>x</p>");
      const { tela } = preparar(artefato("a1", alteracoes));
      render(tela(<NoArtefato {...propsDoNo("a1")} />));
      const pagina = (await iframe()) as HTMLIFrameElement;
      return { pagina, janelaDaPagina: pagina.contentWindow as Window };
    }

    it("sem o aviso da página, não há ← nem →; com o aviso, aparecem e seguem o estado dela", async () => {
      const { janelaDaPagina } = await abrir();
      expect(screen.queryByRole("button", { name: "Voltar" })).not.toBeInTheDocument();

      avisar(janelaDaPagina, AVISO);
      expect(screen.getByRole("button", { name: "Voltar" })).toBeEnabled();
      expect(screen.getByRole("button", { name: "Avançar" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Voltar" })).toHaveClass("nodrag");

      avisar(janelaDaPagina, { ...AVISO, podeVoltar: false, podeAvancar: true });
      expect(screen.getByRole("button", { name: "Voltar" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Avançar" })).toBeEnabled();
    });

    it("só vale a mensagem que vem da janela do iframe, no formato certo", async () => {
      const { janelaDaPagina } = await abrir();

      avisar(window, AVISO);
      avisar(null, AVISO);
      avisar(janelaDaPagina, { ...AVISO, origem: "outra" });
      avisar(janelaDaPagina, { ...AVISO, podeVoltar: "sim" });
      avisar(janelaDaPagina, "voltar");
      avisar(janelaDaPagina, null);
      expect(screen.queryByRole("button", { name: "Voltar" })).not.toBeInTheDocument();
    });

    it("cada botão manda o comando só para a janela do iframe", async () => {
      const { janelaDaPagina } = await abrir();
      const enviar = vi.spyOn(janelaDaPagina, "postMessage").mockImplementation(() => undefined);
      avisar(janelaDaPagina, { ...AVISO, podeAvancar: true });

      fireEvent.click(screen.getByRole("button", { name: "Voltar" }));
      expect(enviar).toHaveBeenLastCalledWith({ origem: "orquestrador-app", acao: "voltar" }, "*");
      fireEvent.click(screen.getByRole("button", { name: "Avançar" }));
      expect(enviar).toHaveBeenLastCalledWith({ origem: "orquestrador-app", acao: "avancar" }, "*");
    });

    it("quando a página carrega, o app pede o estado (a mensagem inicial dela pode ter chegado antes)", async () => {
      const { pagina, janelaDaPagina } = await abrir();
      const enviar = vi.spyOn(janelaDaPagina, "postMessage").mockImplementation(() => undefined);

      fireEvent.load(pagina);
      expect(enviar).toHaveBeenCalledWith({ origem: "orquestrador-app", acao: "estado" }, "*");
    });

    it("Markdown não tem histórico: sem ← e →", async () => {
      vi.spyOn(apiDosArtefatos, "lerVersao").mockResolvedValue("# Plano");
      const { tela } = preparar(artefato("a1", { formato: "markdown", arquivo: "plano.md" }));
      render(tela(<NoArtefato {...propsDoNo("a1")} />));
      await screen.findByRole("heading", { name: "Plano" });

      avisar(window, AVISO);
      expect(screen.queryByRole("button", { name: "Voltar" })).not.toBeInTheDocument();
    });

    it("em tela cheia, a página nova avisa e a barra do modal ganha os botões", async () => {
      const { janelaDaPagina } = await abrir();
      avisar(janelaDaPagina, AVISO);
      fireEvent.click(screen.getByRole("button", { name: "Ampliar o artefato" }));

      const modal = screen.getByRole("dialog", { name: "Relatório de vendas" });
      // O iframe do canvas saiu: o histórico dele não vale mais.
      expect(within(modal).queryByRole("button", { name: "Voltar" })).not.toBeInTheDocument();

      const noModal = within(modal).getByTitle("Conteúdo do artefato: Relatório de vendas") as HTMLIFrameElement;
      avisar(noModal.contentWindow, AVISO);
      expect(within(modal).getByRole("button", { name: "Voltar" })).toBeEnabled();
      expect(within(modal).getByRole("button", { name: "Avançar" })).toBeDisabled();
    });
  });

  it("sem <head>, a política entra no começo do documento (depois do DOCTYPE)", async () => {
    vi.spyOn(apiDosArtefatos, "lerVersao").mockImplementation(async (id) =>
      id === "a1" ? "<!doctype html><p>oi</p>" : "<p>sem doctype</p><header>não é head</header>",
    );
    const { tela } = preparar(artefato("a1"), artefato("a2", { titulo: "Outro" }));
    render(
      tela(
        <>
          <NoArtefato {...propsDoNo("a1")} />
          <NoArtefato {...propsDoNo("a2")} />
        </>,
      ),
    );

    expect((await iframe()).getAttribute("srcdoc")).toBe(`<!doctype html>${META}<p>oi</p>`);
    expect((await iframe("Outro")).getAttribute("srcdoc")).toBe(`${META}<p>sem doctype</p><header>não é head</header>`);
  });

  it("Markdown é renderizado formatado, com rolagem, sem iframe", async () => {
    vi.spyOn(apiDosArtefatos, "lerVersao").mockResolvedValue("# Plano\n\n- **passo** um");
    const { tela } = preparar(artefato("a1", { formato: "markdown", arquivo: "plano.md" }));
    render(tela(<NoArtefato {...propsDoNo("a1")} />));

    expect(await screen.findByRole("heading", { name: "Plano" })).toBeInTheDocument();
    expect(screen.getByText("passo").tagName).toBe("STRONG");
    expect(screen.getByTestId("documento-do-artefato")).toHaveClass("nowheel", "nodrag");
    expect(document.querySelector("iframe")).toBeNull();
    expect(screen.getByRole("img", { name: "Documento Markdown" })).toBeInTheDocument();
  });

  it("trocar a versão no \"v3 ▾\" busca a versão escolhida; o menu mostra a data de cada uma", async () => {
    const ler = vi.spyOn(apiDosArtefatos, "lerVersao").mockImplementation(async (_id, numero) => `<p>versão ${numero}</p>`);
    const { tela } = preparar(artefato("a1"));
    render(tela(<NoArtefato {...propsDoNo("a1")} />));
    await iframe();

    fireEvent.click(screen.getByRole("button", { name: "Versão 3 de 3: trocar de versão" }));
    const menu = screen.getByRole("menu", { name: "Versões do artefato" });
    const opcoes = within(menu).getAllByRole("menuitemradio");
    expect(opcoes.map((opcao) => opcao.textContent?.slice(0, 2))).toEqual(["v3", "v2", "v1"]);
    expect(opcoes[0]).toHaveAttribute("aria-checked", "true");
    expect(opcoes[0]).toHaveTextContent("atual");
    expect(opcoes[1]).toHaveTextContent("02/11/2026");
    expect(opcoes[1]).toHaveTextContent("2,1 kB");

    fireEvent.click(opcoes[2]!);

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    await waitFor(() => expect(ler).toHaveBeenLastCalledWith("a1", 1));
    await waitFor(async () => expect((await iframe()).getAttribute("srcdoc")).toContain("<p>versão 1</p>"));
    expect(screen.getByRole("button", { name: "Versão 1 de 3: trocar de versão" })).toHaveClass("botao-da-versao-antiga");
  });

  it("uma versão nova passa sozinha para ela, com o selo \"v4 nova\" por um instante", async () => {
    const ler = vi.spyOn(apiDosArtefatos, "lerVersao").mockImplementation(async (_id, numero) => `<p>versão ${numero}</p>`);
    const { loja, tela } = preparar(artefato("a1"));
    render(tela(<NoArtefato {...propsDoNo("a1")} />));
    await iframe();
    vi.useFakeTimers({ shouldAdvanceTime: true });

    act(() =>
      loja.publicar({
        lista: [artefato("a1", { versaoAtual: 4, versoes: [versao(1), versao(2), versao(3), versao(4)] })],
        carregada: true,
        erro: null,
      }),
    );

    expect(screen.getByRole("status")).toHaveTextContent("v4 nova");
    await waitFor(() => expect(ler).toHaveBeenLastCalledWith("a1", 4));
    expect(screen.getByRole("button", { name: "Versão 4 de 4: trocar de versão" })).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DURACAO_DO_DESTAQUE_MS);
    });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("versão inexistente (404) avisa e oferece a atual; erro de rede permite tentar de novo", async () => {
    const ler = vi
      .spyOn(apiDosArtefatos, "lerVersao")
      .mockRejectedValueOnce(new Error("Não foi possível falar com o servidor."))
      .mockResolvedValueOnce("<p>atual</p>")
      .mockRejectedValueOnce(new ErroDaApi("Versão não encontrada.", 404))
      .mockResolvedValueOnce("<p>atual de novo</p>");
    const { tela } = preparar(artefato("a1"));
    render(tela(<NoArtefato {...propsDoNo("a1")} />));

    expect(await screen.findByText(/Não foi possível carregar a versão 3\. Não foi possível falar com o servidor\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "tentar de novo" }));
    await iframe();

    fireEvent.click(screen.getByRole("button", { name: "Versão 3 de 3: trocar de versão" }));
    fireEvent.click(within(screen.getByRole("menu")).getAllByRole("menuitemradio")[1]!);
    expect(await screen.findByText("A versão 2 não existe mais.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "ver a versão atual (v3)" }));

    await waitFor(async () => expect((await iframe()).getAttribute("srcdoc")).toContain("atual de novo"));
    expect(ler).toHaveBeenCalledTimes(4);
  });

  it("clique duplo no título abre o campo; Enter chama o PATCH; Esc desiste", async () => {
    vi.spyOn(apiDosArtefatos, "lerVersao").mockResolvedValue("<p>x</p>");
    const renomear = vi.spyOn(apiDosArtefatos, "renomear").mockResolvedValue(artefato("a1", { titulo: "Painel" }));
    const { acoes, tela } = preparar(artefato("a1"));
    render(tela(<NoArtefato {...propsDoNo("a1")} />));

    fireEvent.doubleClick(screen.getByText("Relatório de vendas"));
    const campo = screen.getByRole("textbox", { name: "Título do artefato" });
    fireEvent.change(campo, { target: { value: "  Painel " } });
    await act(async () => {
      fireEvent.keyDown(campo, { key: "Enter" });
    });

    expect(acoes.renomear).toHaveBeenCalledWith("a1", "Painel");
    expect(renomear).toHaveBeenCalledWith("a1", "Painel");

    fireEvent.doubleClick(screen.getByText("Relatório de vendas"));
    const deNovo = screen.getByRole("textbox", { name: "Título do artefato" });
    fireEvent.change(deNovo, { target: { value: "Outro" } });
    fireEvent.keyDown(deNovo, { key: "Escape" });

    expect(screen.queryByRole("textbox", { name: "Título do artefato" })).not.toBeInTheDocument();
    expect(renomear).toHaveBeenCalledTimes(1);
  });

  it("título recusado pelo servidor mostra o motivo", async () => {
    vi.spyOn(apiDosArtefatos, "lerVersao").mockResolvedValue("<p>x</p>");
    vi.spyOn(apiDosArtefatos, "renomear").mockRejectedValue(new ErroDaApi("Título inválido.", 400));
    const { tela } = preparar(artefato("a1"));
    render(tela(<NoArtefato {...propsDoNo("a1")} />));

    fireEvent.doubleClick(screen.getByText("Relatório de vendas"));
    const campo = screen.getByRole("textbox", { name: "Título do artefato" });
    fireEvent.change(campo, { target: { value: "x".repeat(500) } });
    await act(async () => {
      fireEvent.keyDown(campo, { key: "Enter" });
    });

    expect(screen.getByRole("alert")).toHaveTextContent("Não foi possível renomear: Título inválido.");
    expect(screen.getByText("Relatório de vendas")).toBeInTheDocument();
  });

  it("apagar pede confirmação e, confirmado, chama o DELETE", async () => {
    vi.spyOn(apiDosArtefatos, "lerVersao").mockResolvedValue("<p>x</p>");
    const confirmar = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    const remover = vi.spyOn(apiDosArtefatos, "apagar").mockResolvedValue(undefined);
    const { acoes, tela } = preparar(artefato("a1"));
    render(tela(<NoArtefato {...propsDoNo("a1")} />));
    const apagar = screen.getByRole("button", { name: "Apagar o artefato" });

    fireEvent.click(apagar);
    expect(confirmar).toHaveBeenCalledWith(CONFIRMACAO_PARA_APAGAR_O_ARTEFATO);
    expect(remover).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(apagar);
    });

    expect(acoes.apagar).toHaveBeenCalledWith("a1");
    expect(remover).toHaveBeenCalledWith("a1");
    expect(acoes.fechar).not.toHaveBeenCalled();
  });

  it("se o servidor não apagar, a janela fica e mostra o motivo", async () => {
    vi.spyOn(apiDosArtefatos, "lerVersao").mockResolvedValue("<p>x</p>");
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.spyOn(apiDosArtefatos, "apagar").mockRejectedValue(new Error("Não foi possível falar com o servidor."));
    const { tela } = preparar(artefato("a1"));
    render(tela(<NoArtefato {...propsDoNo("a1")} />));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Apagar o artefato" }));
    });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Não foi possível apagar o artefato: Não foi possível falar com o servidor.",
    );
    expect(screen.getByRole("button", { name: "Apagar o artefato" })).toBeEnabled();
  });

  it("✕ só fecha a janela, sem apagar", async () => {
    vi.spyOn(apiDosArtefatos, "lerVersao").mockResolvedValue("<p>x</p>");
    const remover = vi.spyOn(apiDosArtefatos, "apagar");
    const { acoes, tela } = preparar(artefato("a1"));
    render(tela(<NoArtefato {...propsDoNo("a1")} />));
    await iframe();

    fireEvent.click(screen.getByRole("button", { name: "Fechar o artefato" }));

    expect(acoes.fechar).toHaveBeenCalledWith("a1");
    expect(remover).not.toHaveBeenCalled();
  });

  it("\"salvar como…\" baixa o conteúdo da versão num Blob, com o nome do arquivo", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.spyOn(apiDosArtefatos, "lerVersao").mockImplementation(async (_id, numero) => `<p>versão ${numero}</p>`);
    // O jsdom não tem `URL.createObjectURL`: entra um falso só neste teste.
    const anteriores = { criar: URL.createObjectURL, liberar: URL.revokeObjectURL };
    const criarEndereco = vi.fn<(blob: Blob) => string>(() => "blob:artefato");
    const liberarEndereco = vi.fn();
    URL.createObjectURL = criarEndereco;
    URL.revokeObjectURL = liberarEndereco;
    const baixados: { nome: string; endereco: string }[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      baixados.push({ nome: this.download, endereco: this.getAttribute("href") ?? "" });
    });
    try {
      const { tela } = preparar(artefato("a1"));
      render(tela(<NoArtefato {...propsDoNo("a1")} />));
      await iframe();

      fireEvent.click(screen.getByRole("button", { name: "Salvar o artefato como arquivo" }));

      expect(baixados).toEqual([{ nome: "relatorio.html", endereco: "blob:artefato" }]);
      const blob = criarEndereco.mock.calls[0]?.[0];
      expect(blob?.type).toBe("text/html;charset=utf-8");
      expect(blob === undefined ? null : await lerBlob(blob)).toBe("<p>versão 3</p>");
      // O link temporário não fica na página, e o endereço é liberado depois.
      expect(document.querySelector('a[download]')).toBeNull();
      await act(async () => {
        await vi.runOnlyPendingTimersAsync();
      });
      expect(liberarEndereco).toHaveBeenCalledWith("blob:artefato");

      // Numa versão antiga, o nome leva a versão.
      fireEvent.click(screen.getByRole("button", { name: "Versão 3 de 3: trocar de versão" }));
      fireEvent.click(within(screen.getByRole("menu")).getAllByRole("menuitemradio")[1]!);
      await waitFor(async () => expect((await iframe()).getAttribute("srcdoc")).toContain("versão 2"));
      fireEvent.click(screen.getByRole("button", { name: "Salvar o artefato como arquivo" }));
      expect(baixados.at(-1)?.nome).toBe("relatorio-v2.html");
      await act(async () => {
        await vi.runOnlyPendingTimersAsync();
      });
    } finally {
      URL.createObjectURL = anteriores.criar;
      URL.revokeObjectURL = anteriores.liberar;
    }
  });

  it("ampliar abre o modal em tela cheia fora do canvas; Esc fecha", async () => {
    vi.spyOn(apiDosArtefatos, "lerVersao").mockResolvedValue("<p>x</p>");
    const { tela } = preparar(artefato("a1"));
    const { container } = render(tela(<NoArtefato {...propsDoNo("a1")} />));
    await iframe();

    fireEvent.click(screen.getByRole("button", { name: "Ampliar o artefato" }));

    const modal = screen.getByRole("dialog", { name: "Relatório de vendas" });
    expect(modal).toHaveAttribute("aria-modal", "true");
    // No document.body, fora do nó (não escala com o zoom).
    expect(container.contains(modal)).toBe(false);
    expect(within(modal).getByTitle("Conteúdo do artefato: Relatório de vendas")).toHaveAttribute("sandbox", "allow-scripts");
    // A página roda só no modal.
    expect(within(container).queryByTitle("Conteúdo do artefato: Relatório de vendas")).not.toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(await within(container).findByTitle("Conteúdo do artefato: Relatório de vendas")).toBeInTheDocument();
  });

  it("o clique no fundo também fecha a tela cheia, que começa abaixo da faixa de arraste do app", async () => {
    vi.spyOn(apiDosArtefatos, "lerVersao").mockResolvedValue("<p>x</p>");
    const faixa = document.createElement("div");
    faixa.className = "faixa-de-arrasto";
    faixa.getBoundingClientRect = () => ({ bottom: 36 }) as DOMRect;
    document.body.append(faixa);
    const { tela } = preparar(artefato("a1"));
    render(tela(<NoArtefato {...propsDoNo("a1")} />));
    await iframe();

    fireEvent.click(screen.getByRole("button", { name: "Ampliar o artefato" }));
    const fundo = screen.getByTestId("fundo-da-tela-cheia");
    expect(fundo).toHaveStyle({ top: "36px" });

    // Clicar dentro da caixa não fecha; no fundo, sim.
    fireEvent.mouseDown(screen.getByRole("dialog", { name: "Relatório de vendas" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.mouseDown(fundo);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    faixa.remove();
  });

  it("a barra da tela cheia não leva o rótulo solto \"Esc fecha\"; o fechar guarda a dica do Esc e, no navegador, o topo é o da janela", async () => {
    vi.spyOn(apiDosArtefatos, "lerVersao").mockResolvedValue("<p>x</p>");
    const { tela } = preparar(artefato("a1"));
    render(tela(<NoArtefato {...propsDoNo("a1")} />));
    await iframe();

    fireEvent.click(screen.getByRole("button", { name: "Ampliar o artefato" }));

    const modal = screen.getByRole("dialog", { name: "Relatório de vendas" });
    expect(within(modal).queryByText("Esc fecha")).not.toBeInTheDocument();
    expect(within(modal).getByRole("button", { name: "Fechar a tela cheia" })).toHaveAttribute("title", "Fechar a tela cheia (Esc)");
    // Sem faixa de arraste (navegador), a tela cheia começa no topo.
    expect(screen.getByTestId("fundo-da-tela-cheia")).toHaveStyle({ top: "0px" });
  });

  describe("desenho na tela cheia", () => {
    // O jsdom não tem PointerEvent: sem ele, o fireEvent manda um Event sem botão, clientX nem pointerId.
    class EventoDePonteiroFalso extends MouseEvent {
      readonly pointerId: number;
      constructor(tipo: string, inicio: PointerEventInit = {}) {
        super(tipo, inicio);
        this.pointerId = inicio.pointerId ?? 0;
      }
    }
    beforeEach(() => vi.stubGlobal("PointerEvent", EventoDePonteiroFalso));
    afterEach(() => {
      vi.unstubAllGlobals();
      localStorage.clear();
    });

    async function abrirEmTelaCheia(id = "a1") {
      vi.spyOn(apiDosArtefatos, "lerVersao").mockResolvedValue("<p>x</p>");
      const { tela } = preparar(artefato(id));
      render(tela(<NoArtefato {...propsDoNo(id)} />));
      await iframe();
      fireEvent.click(screen.getByRole("button", { name: "Ampliar o artefato" }));
      return screen.getByRole("dialog", { name: "Relatório de vendas" });
    }

    const caneta = () => screen.getByRole("button", { name: "Desenhar sobre a página" });
    const camada = () => screen.getByTestId("desenho-da-tela-cheia");
    const paginaDoModal = () => screen.getByTitle("Conteúdo do artefato: Relatório de vendas");
    const barra = () => screen.queryByRole("toolbar", { name: "Desenho" });

    function arrastar(pontos: readonly [number, number][]) {
      const [primeiro, ...resto] = pontos;
      const svg = camada().querySelector("svg") as SVGSVGElement;
      fireEvent.pointerDown(svg, { button: 0, pointerId: 1, clientX: primeiro?.[0], clientY: primeiro?.[1] });
      for (const [x, y] of resto) {
        fireEvent.pointerMove(svg, { pointerId: 1, clientX: x, clientY: y });
      }
      const ultimo = resto.at(-1) ?? primeiro;
      fireEvent.pointerUp(svg, { pointerId: 1, clientX: ultimo?.[0], clientY: ultimo?.[1] });
    }

    it("o botão da caneta existe só na tela cheia e liga e desliga o modo, com a barrinha de ferramentas", async () => {
      vi.spyOn(apiDosArtefatos, "lerVersao").mockResolvedValue("<p>x</p>");
      const { tela } = preparar(artefato("a1"));
      render(tela(<NoArtefato {...propsDoNo("a1")} />));
      await iframe();
      expect(screen.queryByRole("button", { name: "Desenhar sobre a página" })).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Ampliar o artefato" }));
      expect(caneta()).toHaveAttribute("aria-pressed", "false");
      expect(barra()).not.toBeInTheDocument();
      expect(camada()).toHaveAttribute("data-ligado", "false");

      fireEvent.click(caneta());
      expect(caneta()).toHaveAttribute("aria-pressed", "true");
      expect(camada()).toHaveAttribute("data-ligado", "true");
      const ferramentas = within(barra() as HTMLElement);
      for (const nome of ["Caneta", "Seta", "Retângulo", "Texto", "Borracha", "Desfazer"]) {
        expect(ferramentas.getByRole("button", { name: nome })).toBeInTheDocument();
      }
      expect(ferramentas.getAllByRole("button", { name: /^Cor / })).toHaveLength(6);
      expect(ferramentas.queryByRole("button", { name: "Marca-texto" })).not.toBeInTheDocument();

      fireEvent.click(caneta());
      expect(barra()).not.toBeInTheDocument();
      expect(camada()).toHaveAttribute("data-ligado", "false");

      // O fechar da barrinha também desliga.
      fireEvent.click(caneta());
      fireEvent.click(within(barra() as HTMLElement).getByRole("button", { name: "Desligar o desenho" }));
      expect(barra()).not.toBeInTheDocument();
    });

    it("o traço feito aparece, fica visível com o modo desligado e o Desfazer o tira", async () => {
      await abrirEmTelaCheia();
      fireEvent.click(caneta());

      arrastar([[10, 10], [50, 30], [90, 20]]);
      expect(camada().querySelectorAll('[data-traco="caneta"]')).toHaveLength(1);

      fireEvent.click(within(barra() as HTMLElement).getByRole("button", { name: "Seta" }));
      arrastar([[20, 80], [120, 80]]);
      fireEvent.click(within(barra() as HTMLElement).getByRole("button", { name: "Retângulo" }));
      arrastar([[30, 30], [100, 70]]);
      expect(camada().querySelectorAll("[data-traco]")).toHaveLength(3);

      fireEvent.click(caneta());
      expect(camada().querySelectorAll("[data-traco]")).toHaveLength(3);

      fireEvent.click(caneta());
      fireEvent.click(within(barra() as HTMLElement).getByRole("button", { name: "Desfazer" }));
      expect(camada().querySelector('[data-traco="retangulo"]')).not.toBeInTheDocument();
      expect(camada().querySelectorAll("[data-traco]")).toHaveLength(2);
    });

    it("o texto solto vira traço com Enter", async () => {
      await abrirEmTelaCheia();
      fireEvent.click(caneta());
      fireEvent.click(within(barra() as HTMLElement).getByRole("button", { name: "Texto" }));
      fireEvent.pointerDown(camada().querySelector("svg") as SVGSVGElement, { button: 0, pointerId: 1, clientX: 40, clientY: 50 });
      const campo = screen.getByRole("textbox", { name: "Texto solto" });
      fireEvent.change(campo, { target: { value: "Ver aqui" } });
      fireEvent.keyDown(campo, { key: "Enter" });
      expect(camada().querySelector("text")).toHaveTextContent("Ver aqui");
    });

    it("grava por artefato e, ao reabrir a tela cheia, os traços voltam (os de outro artefato não)", async () => {
      await abrirEmTelaCheia("a1");
      fireEvent.click(caneta());
      fireEvent.click(within(barra() as HTMLElement).getByRole("button", { name: "Seta" }));
      arrastar([[20, 80], [120, 80]]);

      const salvo = JSON.parse(localStorage.getItem("orquestrador-agentes:canvas:v1:desenho-da-tela-cheia") ?? "{}") as Record<
        string,
        { tipo: string; pontos: { x: number; y: number }[] }[]
      >;
      expect(Object.keys(salvo)).toEqual(["a1"]);
      expect(salvo.a1?.[0]).toMatchObject({ tipo: "seta", pontos: [{ x: 20, y: 80 }, { x: 120, y: 80 }] });
      // O desenho do canvas não é tocado.
      expect(localStorage.getItem("orquestrador-agentes:canvas:v1")).toBeNull();

      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Fechar a tela cheia" }));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Ampliar o artefato" }));
      expect(camada().querySelectorAll('[data-traco="seta"]')).toHaveLength(1);
      // Reaberta, começa desligada.
      expect(camada()).toHaveAttribute("data-ligado", "false");
      expect(barra()).not.toBeInTheDocument();
    });

    it("um desenho corrompido no armazenamento é descartado, sem derrubar a tela cheia", async () => {
      localStorage.setItem("orquestrador-agentes:canvas:v1:desenho-da-tela-cheia", "{isso não é json");
      await abrirEmTelaCheia();
      expect(camada().querySelectorAll("[data-traco]")).toHaveLength(0);
    });

    it("Esc com o desenho ligado só o desliga; desligado, fecha a tela cheia", async () => {
      await abrirEmTelaCheia();
      fireEvent.click(caneta());

      fireEvent.keyDown(window, { key: "Escape" });
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(caneta()).toHaveAttribute("aria-pressed", "false");
      expect(barra()).not.toBeInTheDocument();

      fireEvent.keyDown(window, { key: "Escape" });
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("Esc com um texto em edição desliga o desenho, descarta o texto e não fecha a tela cheia", async () => {
      await abrirEmTelaCheia();
      fireEvent.click(caneta());
      fireEvent.click(within(barra() as HTMLElement).getByRole("button", { name: "Texto" }));
      fireEvent.pointerDown(camada().querySelector("svg") as SVGSVGElement, { button: 0, pointerId: 1, clientX: 40, clientY: 50 });
      fireEvent.change(screen.getByRole("textbox", { name: "Texto solto" }), { target: { value: "rascunho" } });

      fireEvent.keyDown(screen.getByRole("textbox", { name: "Texto solto" }), { key: "Escape" });

      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(screen.queryByRole("textbox", { name: "Texto solto" })).not.toBeInTheDocument();
      expect(camada().querySelector("text")).not.toBeInTheDocument();
      expect(barra()).not.toBeInTheDocument();
    });

    it("a página fica sem ponteiro só com o modo ligado", async () => {
      await abrirEmTelaCheia();
      expect(paginaDoModal()).not.toHaveStyle({ pointerEvents: "none" });

      fireEvent.click(caneta());
      expect(paginaDoModal()).toHaveStyle({ pointerEvents: "none" });
      expect(camada()).toHaveClass("camada-de-desenho-ativa");

      fireEvent.click(caneta());
      expect(paginaDoModal()).not.toHaveStyle({ pointerEvents: "none" });
      expect(camada()).not.toHaveClass("camada-de-desenho-ativa");
    });

    it("sem o modo ligado, a camada não tem como pegar o mouse (o CSS é lido do arquivo)", () => {
      const css = readFileSync(resolve(__dirname, "../../theme/index.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      const regras = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, seletores = "", corpo = ""]) => ({
        seletores: seletores.split(",").map((seletor) => seletor.trim()),
        corpo,
      }));
      const base = regras.find(({ seletores }) => seletores.includes(".camada-de-desenho"));
      const ativa = regras.find(({ seletores }) => seletores.includes(".camada-de-desenho-ativa .camada-de-desenho-svg"));
      expect(base?.corpo).toMatch(/pointer-events:\s*none/);
      expect(ativa?.corpo).toMatch(/pointer-events:\s*auto/);
    });
  });

  it("enquanto o resumo não chega, avisa; se a lista falhar, mostra o motivo", () => {
    const loja = criarLojaDosArtefatos();
    const acoes: AcoesDosArtefatos = { renomear: vi.fn(), apagar: vi.fn(), fechar: vi.fn() };
    render(
      <ReactFlowProvider>
        <ProvedorDosArtefatos valor={{ loja, acoes }}>
          <NoArtefato {...propsDoNo("a9")} />
        </ProvedorDosArtefatos>
      </ReactFlowProvider>,
    );

    expect(screen.getByText("carregando artefato…")).toBeInTheDocument();
    act(() => loja.publicar({ lista: [], carregada: false, erro: "O servidor respondeu com erro 500." }));
    expect(screen.getByText(/Não foi possível carregar o artefato\. O servidor respondeu com erro 500\./)).toBeInTheDocument();
  });

  it("um evento de outro artefato não re-renderiza esta janela", async () => {
    vi.spyOn(apiDosArtefatos, "lerVersao").mockResolvedValue("<p>x</p>");
    const a1 = artefato("a1");
    const { loja, tela } = preparar(a1, artefato("a2", { titulo: "Outro" }));
    const renderizacoes = { a1: 0 };
    render(
      tela(
        <>
          <Profiler id="a1" onRender={() => (renderizacoes.a1 += 1)}>
            <NoArtefato {...propsDoNo("a1")} />
          </Profiler>
          <NoArtefato {...propsDoNo("a2")} />
        </>,
      ),
    );
    await iframe();
    await iframe("Outro");
    const antes = renderizacoes.a1;

    act(() =>
      loja.publicar({
        lista: [a1, artefato("a2", { titulo: "Outro renomeado" })],
        carregada: true,
        erro: null,
      }),
    );

    expect(screen.getByText("Outro renomeado")).toBeInTheDocument();
    expect(renderizacoes.a1).toBe(antes);
  });
});
