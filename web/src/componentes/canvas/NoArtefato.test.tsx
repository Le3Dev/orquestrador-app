import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { type NodeProps, ReactFlowProvider } from "@xyflow/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Profiler, type ReactNode } from "react";

import { apiDosArtefatos, type DesenhoGravado, type ResumoDoArtefato, type TracoGravado } from "../../shared/api/artefatos";
import { ErroDaApi } from "../../shared/api/cliente";
import {
  type AcoesDosArtefatos,
  criarLojaDosArtefatos,
  type LojaDosArtefatos,
  ProvedorDosArtefatos,
} from "../../shared/canvas/artefatos";
import type { NoArtefato as TipoDoNo } from "../../shared/canvas/nos";
import { ATRASO_DA_GRAVACAO_MS } from "../../shared/desenhoDoArtefato";
import {
  ESCALA_MINIMA_DA_PAGINA,
  escalaDaPagina,
  type EstadoDoDesenho,
  TAG_DO_SCRIPT_DO_DESENHO,
} from "../../shared/desenhoNaPagina";
import { TAG_DO_SCRIPT_DE_NAVEGACAO } from "../../shared/navegacaoDoArtefato";
import {
  CONFIRMACAO_PARA_APAGAR_O_ARTEFATO,
  DURACAO_DO_DESTAQUE_MS,
  NoArtefato,
  POLITICA_DO_ARTEFATO,
} from "./NoArtefato";

/** A política de segurança, o script de voltar e avançar e o do desenho, que entram juntos no começo da página. */
const META = `<meta http-equiv="Content-Security-Policy" content="${POLITICA_DO_ARTEFATO}">${TAG_DO_SCRIPT_DE_NAVEGACAO}${TAG_DO_SCRIPT_DO_DESENHO}`;

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
  // O desenho de cada versão vem do servidor: sem nada desenhado, por padrão.
  beforeEach(() => {
    vi.spyOn(apiDosArtefatos, "lerDesenho").mockResolvedValue({ tracos: [], largura: null });
    vi.spyOn(apiDosArtefatos, "salvarDesenho").mockResolvedValue(undefined);
  });
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

  describe("desenho sobre a página", () => {
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

    function seta(id: string, alteracoes: Partial<TracoGravado> = {}): TracoGravado {
      return {
        id,
        tipo: "seta",
        cor: "azul",
        espessura: 3,
        pontos: [{ x: 10, y: 10 }, { x: 80, y: 10 }],
        ancora: { conteiner: [], elemento: [1, 0] },
        ...alteracoes,
      };
    }

    const caneta = () => screen.getByTestId("botao-desenhar-na-tela-cheia");
    const barra = () => screen.queryByRole("toolbar", { name: "Desenho" });
    const lerDesenho = () => vi.mocked(apiDosArtefatos.lerDesenho);
    const salvarDesenho = () => vi.mocked(apiDosArtefatos.salvarDesenho);

    async function abrir(alteracoes: Partial<ResumoDoArtefato> = {}) {
      vi.spyOn(apiDosArtefatos, "lerVersao").mockResolvedValue("<p>x</p>");
      const preparado = preparar(artefato("a1", alteracoes));
      render(preparado.tela(<NoArtefato {...propsDoNo("a1")} />));
      const pagina = (await iframe()) as HTMLIFrameElement;
      return { ...preparado, pagina };
    }

    /** Abre a tela cheia e espera o desenho da versão chegar (a caneta só liga depois). */
    async function ampliar() {
      fireEvent.click(screen.getByRole("button", { name: "Ampliar o artefato" }));
      const modal = screen.getByRole("dialog", { name: "Relatório de vendas" });
      await waitFor(() => expect(caneta()).toBeEnabled());
      return { modal, pagina: within(modal).queryByTitle("Conteúdo do artefato: Relatório de vendas") as HTMLIFrameElement };
    }

    /** O último estado que o app mandou à página (o carregar do iframe pede o de agora). */
    function espiar(pagina: HTMLIFrameElement): () => EstadoDoDesenho | undefined {
      const enviar = vi.spyOn(pagina.contentWindow as Window, "postMessage").mockImplementation(() => undefined);
      return () => {
        fireEvent.load(pagina);
        return enviar.mock.calls
          .map(([dados]) => dados as { acao?: string; estado?: EstadoDoDesenho })
          .filter((dados) => dados.acao === "desenho")
          .at(-1)?.estado;
      };
    }

    /** A mensagem chega à janela do app como a da camada da página (`source` é a janela do iframe). */
    function daPagina(de: Window | null, dados: Record<string, unknown>): void {
      act(() => {
        window.dispatchEvent(new MessageEvent("message", { data: { origem: "orquestrador-artefato", ...dados }, source: de }));
      });
    }

    it("o botão da caneta existe só na tela cheia e liga e desliga o modo na página, que continua com o ponteiro", async () => {
      await abrir();
      expect(screen.queryByTestId("botao-desenhar-na-tela-cheia")).not.toBeInTheDocument();

      const { pagina } = await ampliar();
      const estado = espiar(pagina);
      expect(caneta()).toHaveAttribute("aria-pressed", "false");
      expect(caneta()).toHaveAccessibleName("Desenhar sobre a página");
      expect(barra()).not.toBeInTheDocument();
      expect(estado()).toMatchObject({ ligado: false, tracos: [] });

      fireEvent.click(caneta());
      expect(caneta()).toHaveAttribute("aria-pressed", "true");
      expect(estado()).toMatchObject({ ligado: true, ferramenta: "caneta", cor: "laranja", espessura: 3 });
      // O traço é segurado dentro da página: ela não perde o ponteiro (a roda continua rolando).
      expect(pagina).not.toHaveStyle({ pointerEvents: "none" });
      const ferramentas = within(barra() as HTMLElement);
      for (const nome of ["Caneta", "Seta", "Retângulo", "Texto", "Borracha", "Desfazer"]) {
        expect(ferramentas.getByRole("button", { name: nome })).toBeInTheDocument();
      }
      expect(ferramentas.getAllByRole("button", { name: /^Cor / })).toHaveLength(6);
      expect(ferramentas.queryByRole("button", { name: "Marca-texto" })).not.toBeInTheDocument();

      fireEvent.click(ferramentas.getByRole("button", { name: "Seta" }));
      fireEvent.click(ferramentas.getByRole("button", { name: "Cor azul" }));
      expect(estado()).toMatchObject({ ligado: true, ferramenta: "seta", cor: "azul" });

      fireEvent.click(caneta());
      expect(barra()).not.toBeInTheDocument();
      expect(estado()).toMatchObject({ ligado: false });

      // Religar volta para a caneta; o fechar da barrinha também desliga.
      fireEvent.click(caneta());
      expect(estado()).toMatchObject({ ligado: true, ferramenta: "caneta" });
      fireEvent.click(within(barra() as HTMLElement).getByRole("button", { name: "Desligar o desenho" }));
      expect(barra()).not.toBeInTheDocument();
    });

    it("enquanto o desenho da versão não chega, a caneta fica desabilitada", async () => {
      let entregar: (desenho: DesenhoGravado) => void = () => undefined;
      lerDesenho().mockReturnValue(new Promise((resolver) => (entregar = resolver)));
      await abrir();
      fireEvent.click(screen.getByRole("button", { name: "Ampliar o artefato" }));
      expect(caneta()).toBeDisabled();

      await act(async () => entregar({ tracos: [], largura: null }));
      expect(caneta()).toBeEnabled();
    });

    it("o traço que a página devolve entra no desenho, volta à página e é gravado uma vez, juntando os passos", async () => {
      await abrir();
      const { pagina } = await ampliar();
      const estado = espiar(pagina);
      fireEvent.click(caneta());

      daPagina(pagina.contentWindow, { desenho: "traco", traco: seta("t1") });
      daPagina(pagina.contentWindow, {
        desenho: "traco",
        traco: { ...seta("t2"), tipo: "caneta", pontos: [{ x: 0, y: 0 }, { x: 5, y: 0.1 }, { x: 10, y: 0 }] },
      });
      // Um clique sem arrastar não vira seta de tamanho zero.
      daPagina(pagina.contentWindow, { desenho: "traco", traco: seta("t3", { pontos: [{ x: 4, y: 4 }, { x: 4, y: 4 }] }) });

      const esperados = [seta("t1"), { ...seta("t2"), tipo: "caneta", pontos: [{ x: 0, y: 0 }, { x: 10, y: 0 }] }];
      expect(estado()?.tracos).toEqual(esperados);
      expect(salvarDesenho()).not.toHaveBeenCalled();

      await waitFor(() => expect(salvarDesenho()).toHaveBeenCalledTimes(1));
      expect(salvarDesenho()).toHaveBeenCalledWith("a1", 3, esperados, null);
      expect(ATRASO_DA_GRAVACAO_MS).toBe(300);
    });

    it("o que vem de outra janela, malformado ou com o modo desligado não entra", async () => {
      await abrir();
      const { pagina } = await ampliar();
      const estado = espiar(pagina);

      daPagina(pagina.contentWindow, { desenho: "traco", traco: seta("desligado") });
      fireEvent.click(caneta());
      daPagina(window, { desenho: "traco", traco: seta("de-fora") });
      daPagina(null, { desenho: "traco", traco: seta("sem-janela") });
      daPagina(pagina.contentWindow, { desenho: "traco", traco: { ...seta("ruim"), tipo: "estrela" } });
      daPagina(pagina.contentWindow, { desenho: "traco", traco: { ...seta("sem-ancora-valida"), ancora: "body" } });
      daPagina(pagina.contentWindow, { origem: "outra", desenho: "traco", traco: seta("outra-origem") });

      expect(estado()?.tracos).toEqual([]);
    });

    it("borracha, Desfazer da barrinha e Ctrl/Cmd+Z (no app ou repassado pela página)", async () => {
      lerDesenho().mockResolvedValue({ tracos: [seta("t1"), seta("t2")], largura: null });
      await abrir();
      const { pagina } = await ampliar();
      const estado = espiar(pagina);
      const ids = () => estado()?.tracos.map(({ id }) => id);
      fireEvent.click(caneta());

      daPagina(pagina.contentWindow, { desenho: "apagar", ids: ["t1"] });
      expect(ids()).toEqual(["t2"]);
      fireEvent.click(within(barra() as HTMLElement).getByRole("button", { name: "Desfazer" }));
      expect(ids()).toEqual(["t1", "t2"]);

      daPagina(pagina.contentWindow, { desenho: "traco", traco: seta("t3") });
      expect(ids()).toEqual(["t1", "t2", "t3"]);
      daPagina(pagina.contentWindow, { desenho: "tecla", tecla: "desfazer" });
      expect(ids()).toEqual(["t1", "t2"]);

      daPagina(pagina.contentWindow, { desenho: "traco", traco: seta("t4") });
      fireEvent.keyDown(window, { key: "z", code: "KeyZ", metaKey: true });
      expect(ids()).toEqual(["t1", "t2"]);
    });

    it("Esc com o modo ligado só o desliga; desligado, fecha; o Esc repassado pela página desliga e devolve o foco ao app", async () => {
      await abrir();
      await ampliar();
      fireEvent.click(caneta());

      fireEvent.keyDown(window, { key: "Escape" });
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(caneta()).toHaveAttribute("aria-pressed", "false");
      expect(barra()).not.toBeInTheDocument();
      fireEvent.keyDown(window, { key: "Escape" });
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

      const { pagina } = await ampliar();
      fireEvent.click(caneta());
      daPagina(pagina.contentWindow, { desenho: "tecla", tecla: "Escape" });
      expect(caneta()).toHaveAttribute("aria-pressed", "false");
      expect(caneta()).toHaveFocus();
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    it("fechar a tela cheia grava na hora; reaberta, começa desligada e com os traços", async () => {
      await abrir();
      const { pagina } = await ampliar();
      fireEvent.click(caneta());
      daPagina(pagina.contentWindow, { desenho: "traco", traco: seta("t1") });

      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Fechar a tela cheia" }));
      // Sem esperar o atraso: só a vez na fila de gravações (um microtask).
      await act(async () => undefined);
      expect(salvarDesenho()).toHaveBeenCalledWith("a1", 3, [seta("t1")], null);

      const reaberta = await ampliar();
      expect(espiar(reaberta.pagina)()).toMatchObject({ ligado: false, tracos: [seta("t1")] });
      expect(caneta()).toHaveAttribute("aria-pressed", "false");
    });

    it("cada versão tem o seu desenho: o traço fica na versão em que foi feito, o seletor mostra os da versão e a versão nova começa limpa", async () => {
      lerDesenho().mockImplementation(async (_id, numero) => ({ tracos: numero === 2 ? [seta("da-v2")] : [], largura: null }));
      const { loja } = await abrir();
      const { pagina } = await ampliar();
      fireEvent.click(caneta());
      daPagina(pagina.contentWindow, { desenho: "traco", traco: seta("da-v3") });

      // Troca para a v2 antes do atraso: o traço vai já, para a v3.
      fireEvent.click(screen.getByRole("button", { name: /Versão 3 de 3/ }));
      fireEvent.click(screen.getByRole("menuitemradio", { name: /v2/ }));
      await act(async () => undefined);
      expect(salvarDesenho()).toHaveBeenCalledWith("a1", 3, [seta("da-v3")], null);
      // A versão carregada de novo vem num iframe novo.
      const paginaDaVersao = () => within(screen.getByRole("dialog")).findByTitle("Conteúdo do artefato: Relatório de vendas");
      const estadoDaV2 = espiar((await paginaDaVersao()) as HTMLIFrameElement);
      await waitFor(() => expect(estadoDaV2()?.tracos).toEqual([seta("da-v2")]));
      expect(lerDesenho()).toHaveBeenCalledWith("a1", 2);

      act(() =>
        loja.publicar({
          lista: [artefato("a1", { versaoAtual: 4, versoes: [versao(1), versao(2), versao(3), versao(4)] })],
          carregada: true,
          erro: null,
        }),
      );
      await waitFor(() => expect(lerDesenho()).toHaveBeenCalledWith("a1", 4));
      await waitFor(() => expect(screen.getByRole("dialog")).toHaveTextContent("v4"));
      const estadoDaV4 = espiar((await paginaDaVersao()) as HTMLIFrameElement);
      await waitFor(() => expect(estadoDaV4()?.tracos).toEqual([]));
      expect(salvarDesenho()).toHaveBeenCalledTimes(1);
    });

    it("se a gravação falha, o desenho fica na tela e o aviso aparece", async () => {
      salvarDesenho().mockRejectedValue(new ErroDaApi("O desenho é grande demais.", 413));
      await abrir();
      const { pagina, modal } = await ampliar();
      const estado = espiar(pagina);
      fireEvent.click(caneta());
      daPagina(pagina.contentWindow, { desenho: "traco", traco: seta("t1") });

      expect(await within(modal).findByTestId("aviso-do-desenho")).toHaveTextContent(
        "Não foi possível gravar o desenho: O desenho é grande demais.",
      );
      expect(estado()?.tracos).toEqual([seta("t1")]);
    });

    describe("migração do desenho guardado no navegador", () => {
      const CHAVE_ANTIGA = "orquestrador-agentes:canvas:v1:desenho-da-tela-cheia";
      const antigo = { id: "velho", tipo: "retangulo", cor: "verde", espessura: 3, pontos: [{ x: 1, y: 2 }, { x: 50, y: 60 }] };

      it("sem desenho no servidor, o antigo vai para a versão atual sem âncora e sai do navegador", async () => {
        localStorage.setItem(CHAVE_ANTIGA, JSON.stringify({ a1: [antigo], a2: [antigo] }));
        const { pagina } = await abrir();
        const estado = espiar(pagina);

        await waitFor(() => expect(salvarDesenho()).toHaveBeenCalledWith("a1", 3, [{ ...antigo, ancora: null }], null));
        await waitFor(() => expect(JSON.parse(localStorage.getItem(CHAVE_ANTIGA) ?? "{}")).toEqual({ a2: [antigo] }));
        expect(estado()?.tracos).toEqual([{ ...antigo, ancora: null }]);
      });

      it("com desenho no servidor (ou se a gravação falhar), o antigo fica onde está", async () => {
        localStorage.setItem(CHAVE_ANTIGA, JSON.stringify({ a1: [antigo] }));
        lerDesenho().mockResolvedValue({ tracos: [seta("do-servidor")], largura: 1500 });
        const { pagina } = await abrir();
        await waitFor(() => expect(espiar(pagina)()?.tracos).toEqual([seta("do-servidor")]));
        expect(salvarDesenho()).not.toHaveBeenCalled();
        expect(localStorage.getItem(CHAVE_ANTIGA)).not.toBeNull();
      });

      it("se a gravação da migração falhar, o antigo continua no navegador", async () => {
        localStorage.setItem(CHAVE_ANTIGA, JSON.stringify({ a1: [antigo] }));
        salvarDesenho().mockRejectedValue(new ErroDaApi("Falhou.", 500));
        await abrir();
        await waitFor(() => expect(salvarDesenho()).toHaveBeenCalled());
        await act(async () => undefined);
        expect(JSON.parse(localStorage.getItem(CHAVE_ANTIGA) ?? "{}")).toEqual({ a1: [antigo] });
      });

      it("numa versão que não é a atual, não migra", async () => {
        localStorage.setItem(CHAVE_ANTIGA, JSON.stringify({ a1: [antigo] }));
        await abrir();
        await waitFor(() => expect(salvarDesenho()).toHaveBeenCalledTimes(1));
        salvarDesenho().mockClear();
        fireEvent.click(screen.getByRole("button", { name: /Versão 3 de 3/ }));
        fireEvent.click(screen.getByRole("menuitemradio", { name: /v2/ }));
        await waitFor(() => expect(lerDesenho()).toHaveBeenCalledWith("a1", 2));
        expect(salvarDesenho()).not.toHaveBeenCalled();
      });
    });

    it("na janela do canvas os traços aparecem só para ver: a página recebe o modo desligado e o que ela manda não entra", async () => {
      lerDesenho().mockResolvedValue({ tracos: [seta("t1")], largura: null });
      const { pagina } = await abrir();
      const estado = espiar(pagina);
      await waitFor(() => expect(estado()).toMatchObject({ ligado: false, tracos: [seta("t1")] }));

      daPagina(pagina.contentWindow, { desenho: "traco", traco: seta("t2") });
      daPagina(pagina.contentWindow, { desenho: "apagar", ids: ["t1"] });
      expect(estado()?.tracos).toEqual([seta("t1")]);
      expect(salvarDesenho()).not.toHaveBeenCalled();
    });

    describe("Markdown", () => {
      function medir(elemento: Element, left: number, top: number) {
        Object.defineProperty(elemento, "getBoundingClientRect", {
          configurable: true,
          value: () => ({ left, top, width: 0, height: 0, x: left, y: top, right: left, bottom: top, toJSON: () => ({}) }),
        });
      }

      async function abrirMarkdown() {
        vi.spyOn(apiDosArtefatos, "lerVersao").mockResolvedValue("# Plano\n\nparágrafo um");
        const preparado = preparar(artefato("a1", { formato: "markdown", arquivo: "plano.md" }));
        render(preparado.tela(<NoArtefato {...propsDoNo("a1")} />));
        await screen.findByRole("heading", { name: "Plano" });
      }

      function riscar(alvo: Element, pontos: readonly [number, number][]) {
        const [primeiro, ...resto] = pontos;
        fireEvent.pointerDown(alvo, { button: 0, pointerId: 1, clientX: primeiro?.[0], clientY: primeiro?.[1] });
        for (const [x, y] of resto) {
          fireEvent.pointerMove(alvo, { pointerId: 1, clientX: x, clientY: y });
        }
        const ultimo = resto.at(-1) ?? primeiro;
        fireEvent.pointerUp(alvo, { pointerId: 1, clientX: ultimo?.[0], clientY: ultimo?.[1] });
      }

      it("no canvas, a camada mora na div que rola e só mostra os traços", async () => {
        lerDesenho().mockResolvedValue({ tracos: [seta("t1", { ancora: null })], largura: null });
        await abrirMarkdown();
        const documento = screen.getByTestId("documento-do-artefato");
        await waitFor(() => expect(documento.querySelector('[data-testid="desenho-na-pagina"] [data-traco-id="t1"]')).not.toBeNull());

        riscar(screen.getByText("parágrafo um"), [[10, 10], [80, 40]]);
        await act(async () => undefined);
        expect(documento.querySelectorAll("[data-traco-id]")).toHaveLength(1);
        expect(salvarDesenho()).not.toHaveBeenCalled();
      });

      it("na tela cheia, com a caneta, o traço fica preso ao parágrafo e é gravado", async () => {
        await abrirMarkdown();
        const { modal } = await ampliar();
        fireEvent.click(caneta());
        const paragrafo = within(modal).getByText("parágrafo um");
        medir(paragrafo, 20, 100);

        riscar(paragrafo, [[30, 110], [60, 115], [90, 130]]);

        const documento = within(modal).getByTestId("documento-do-artefato");
        expect(documento.querySelectorAll('[data-testid="desenho-na-pagina"] [data-traco="caneta"]')).toHaveLength(1);
        await waitFor(() => expect(salvarDesenho()).toHaveBeenCalledTimes(1));
        const [, numero, tracos] = salvarDesenho().mock.calls[0] ?? [];
        expect(numero).toBe(3);
        expect(tracos?.[0]).toMatchObject({
          tipo: "caneta",
          cor: "laranja",
          pontos: [{ x: 10, y: 10 }, { x: 40, y: 15 }, { x: 70, y: 30 }],
          // A div do Markdown é a raiz: o parágrafo é o 2º filho do bloco formatado.
          ancora: { conteiner: [], elemento: [0, 1] },
        });
      });
    });

    describe("página na largura do desenho", () => {
      /** O jsdom não tem layout: o contêiner da página "mede" a área disponível. */
      let area = { largura: 840, altura: 600 };
      const medida = (eixo: "largura" | "altura") =>
        function (this: HTMLElement) {
          return this.classList.contains("pagina-na-largura-do-desenho") ? area[eixo] : 0;
        };
      beforeEach(() => {
        area = { largura: 840, altura: 600 };
        Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: medida("largura") });
        Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: medida("altura") });
      });
      afterEach(() => {
        // Sem o getter daqui, volta o do jsdom (em Element.prototype).
        Reflect.deleteProperty(HTMLElement.prototype, "clientWidth");
        Reflect.deleteProperty(HTMLElement.prototype, "clientHeight");
      });

      const conteinerDe = (pagina: Element) => pagina.closest('[data-testid="pagina-na-largura-do-desenho"]') as HTMLElement;

      it("a escala cabe a largura do desenho na disponível, nunca abaixo do mínimo; sem largura ou medida, nenhuma", () => {
        expect(escalaDaPagina(1500, 840)).toBeCloseTo(0.56, 10);
        expect(escalaDaPagina(840, 1400)).toBeCloseTo(1.667, 3);
        expect(escalaDaPagina(1500, 300)).toBe(ESCALA_MINIMA_DA_PAGINA);
        expect(ESCALA_MINIMA_DA_PAGINA).toBe(0.4);
        expect(escalaDaPagina(null, 840)).toBeNull();
        expect(escalaDaPagina(1500, 0)).toBeNull();
      });

      it("no canvas, a página com desenho de 1500 px vai montada em 1500 e reduzida para 0,56, enchendo a altura", async () => {
        lerDesenho().mockResolvedValue({ tracos: [seta("t1")], largura: 1500 });
        const { pagina } = await abrir();
        await waitFor(() => expect(conteinerDe(pagina)).toHaveAttribute("data-escala", "0.56"));

        expect(conteinerDe(pagina)).toHaveAttribute("data-largura-do-desenho", "1500");
        expect(pagina.style.width).toBe("1500px");
        expect(Number.parseFloat(pagina.style.height)).toBeCloseTo(600 / 0.56, 2);
        expect(pagina.style.transform).toBe(`scale(${840 / 1500})`);
        expect(pagina.style.transformOrigin).toBe("0 0");
        // A camada de ativar continua valendo: inativa, a página não pega o mouse.
        expect(pagina).toHaveStyle({ pointerEvents: "none" });
        const moldura = pagina.parentElement as HTMLElement;
        expect(moldura.style.width).toBe("840px");
        expect(moldura.style.height).toBe("600px");
      });

      it("abaixo do mínimo, fica em 0,4 e a moldura passa da largura (o contêiner rola de lado)", async () => {
        area = { largura: 300, altura: 400 };
        lerDesenho().mockResolvedValue({ tracos: [seta("t1")], largura: 1500 });
        const { pagina } = await abrir();
        await waitFor(() => expect(conteinerDe(pagina)).toHaveAttribute("data-escala", "0.4"));
        expect(conteinerDe(pagina)).toHaveClass("pagina-na-largura-do-desenho-escalada");
        expect((pagina.parentElement as HTMLElement).style.width).toBe("600px");
        expect(pagina.style.height).toBe("1000px");
      });

      it("sem largura (nada desenhado ou desenho migrado), a página flui: sem largura fixa nem transform", async () => {
        lerDesenho().mockResolvedValue({ tracos: [seta("t1")], largura: null });
        const { pagina } = await abrir();
        await act(async () => undefined);
        expect(conteinerDe(pagina)).not.toHaveAttribute("data-escala");
        expect(pagina.style.transform).toBe("");
        expect(pagina.style.width).toBe("");
      });

      it("na tela cheia, o primeiro traço fixa a largura que a página informou (mesmo iframe, sem recarregar); apagar tudo solta", async () => {
        area = { largura: 1200, altura: 700 };
        await abrir();
        const { pagina } = await ampliar();
        expect(conteinerDe(pagina)).not.toHaveAttribute("data-escala");
        fireEvent.click(caneta());

        daPagina(pagina.contentWindow, { desenho: "traco", traco: seta("t1"), largura: 1200 });
        await waitFor(() => expect(conteinerDe(pagina)).toHaveAttribute("data-escala", "1"));
        expect(within(screen.getByRole("dialog")).getByTitle("Conteúdo do artefato: Relatório de vendas")).toBe(pagina);
        expect(pagina.style.width).toBe("1200px");
        await waitFor(() => expect(salvarDesenho()).toHaveBeenCalledWith("a1", 3, [seta("t1")], 1200));

        // O traço seguinte não muda a largura do desenho.
        daPagina(pagina.contentWindow, { desenho: "traco", traco: seta("t2"), largura: 900 });
        expect(conteinerDe(pagina)).toHaveAttribute("data-largura-do-desenho", "1200");

        daPagina(pagina.contentWindow, { desenho: "apagar", ids: ["t1", "t2"] });
        await waitFor(() => expect(conteinerDe(pagina)).not.toHaveAttribute("data-escala"));
        expect(pagina.style.transform).toBe("");
        await waitFor(() => expect(salvarDesenho()).toHaveBeenLastCalledWith("a1", 3, [], null));
      });

      it("Markdown: a div do documento é montada na largura do desenho e reduzida, e continua rolando por dentro", async () => {
        lerDesenho().mockResolvedValue({ tracos: [seta("t1", { ancora: null })], largura: 1500 });
        vi.spyOn(apiDosArtefatos, "lerVersao").mockResolvedValue("# Plano\n\nparágrafo um");
        const preparado = preparar(artefato("a1", { formato: "markdown", arquivo: "plano.md" }));
        render(preparado.tela(<NoArtefato {...propsDoNo("a1")} />));
        const documento = await screen.findByTestId("documento-do-artefato");

        await waitFor(() => expect(conteinerDe(documento)).toHaveAttribute("data-escala", "0.56"));
        expect(documento.style.width).toBe("1500px");
        expect(documento.style.transform).toBe(`scale(${840 / 1500})`);
        expect(documento.style.transformOrigin).toBe("0 0");
        // A rolagem vertical é a da própria div (a classe com overflow-y continua nela).
        expect(documento).toHaveClass("corpo-do-artefato-markdown");
      });
    });

    it("a div do Markdown é posicionada: a camada fica no canto do conteúdo e rola junto (o CSS é lido do arquivo)", () => {
      const css = readFileSync(resolve(__dirname, "../../theme/index.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      const regra = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find(([, seletores = ""]) =>
        seletores.split(",").map((seletor) => seletor.trim()).includes(".corpo-do-artefato-markdown"),
      );
      expect(regra?.[2]).toMatch(/position:\s*relative/);
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
