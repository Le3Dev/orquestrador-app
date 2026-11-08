import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { type NodeProps, ReactFlowProvider } from "@xyflow/react";
import { Profiler, type ReactNode } from "react";

import { api, ErroDaApi } from "../../shared/api/cliente";
import type { DadosDaNota } from "../../shared/api/tipos";
import type { NoNota as TipoDoNo } from "../../shared/canvas/nos";
import { type AcoesDasNotas, criarLojaDasNotas, type LojaDasNotas, ProvedorDasNotas } from "../../shared/canvas/notas";
import { lerPedidoArrastado, TIPO_DO_PEDIDO_ARRASTADO } from "../../shared/canvas/pedidoArrastado";
import { ESPERA_PARA_SALVAR_A_NOTA_MS } from "../../shared/hooks/useEdicaoDaNota";
import { CONFIRMACAO_PARA_APAGAR, NoNota } from "./NoNota";

function nota(id: string, alteracoes: Partial<DadosDaNota> = {}): DadosDaNota {
  return {
    id,
    titulo: "Nova nota",
    texto: "",
    criadaEm: "2026-10-30T12:00:00Z",
    atualizadaEm: "2026-10-30T12:00:00Z",
    ...alteracoes,
  };
}

/** As props que o React Flow passa ao nó. */
function propsDoNo(notaId: string, minimizada = false): NodeProps<TipoDoNo> {
  return {
    id: `nota:${notaId}`,
    type: "nota",
    data: { notaId, minimizada, alturaAberta: 280 },
    selected: false,
    selectable: true,
    draggable: true,
    deletable: true,
    isConnectable: false,
    dragging: false,
    zIndex: 0,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
    width: 320,
    height: minimizada ? 40 : 280,
  };
}

function preparar(...notas: DadosDaNota[]): { loja: LojaDasNotas; acoes: AcoesDasNotas; tela: (filhos: ReactNode) => ReactNode } {
  const loja = criarLojaDasNotas();
  loja.carregar(notas);
  const acoes: AcoesDasNotas = { minimizarOuRestaurar: vi.fn(), notaApagada: vi.fn() };
  const valor = { loja, acoes };
  return {
    loja,
    acoes,
    tela: (filhos) => (
      <ReactFlowProvider>
        <ProvedorDasNotas valor={valor}>{filhos}</ProvedorDasNotas>
      </ReactFlowProvider>
    ),
  };
}

/** Avança a espera do salvamento e deixa a resposta do servidor chegar. */
async function esperarOSalvamento(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ESPERA_PARA_SALVAR_A_NOTA_MS);
  });
}

/** O jsdom não tem `DataTransfer`: este guarda o que o arraste grava. */
function dataTransferFalso(): Pick<DataTransfer, "setData" | "getData" | "types"> {
  const dados = new Map<string, string>();
  return {
    setData: (tipo: string, valor: string) => void dados.set(tipo, valor),
    getData: (tipo: string) => dados.get(tipo) ?? "",
    get types() {
      return [...dados.keys()];
    },
  };
}

/** O PATCH devolve a nota com o que foi enviado. */
function servidorQueAceita() {
  return vi
    .spyOn(api, "alterarNota")
    .mockImplementation(async (id, alteracao) => nota(id, { texto: alteracao.texto ?? "" }));
}

describe("NoNota", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("digitar e parar dispara um único PATCH, depois da espera, só com o texto", async () => {
    const alterar = vi.spyOn(api, "alterarNota").mockResolvedValue(nota("n1", { texto: "olá mundo", atualizadaEm: "2026-10-30T12:01:00Z" }));
    const { loja, tela } = preparar(nota("n1"));
    render(tela(<NoNota {...propsDoNo("n1")} />));
    const campo = screen.getByRole("textbox", { name: "Texto da nota" });

    for (const texto of ["o", "olá", "olá mundo"]) {
      fireEvent.change(campo, { target: { value: texto } });
      act(() => {
        vi.advanceTimersByTime(ESPERA_PARA_SALVAR_A_NOTA_MS - 100);
      });
    }
    expect(alterar).not.toHaveBeenCalled();
    expect(screen.getByText("salvando…")).toBeInTheDocument();

    await esperarOSalvamento();

    expect(alterar).toHaveBeenCalledTimes(1);
    expect(alterar).toHaveBeenCalledWith("n1", { texto: "olá mundo" });
    expect(screen.getByText("salvo")).toBeInTheDocument();
    expect(loja.ler("n1")?.texto).toBe("olá mundo");
  });

  it("perder o foco salva na hora, sem esperar", async () => {
    const alterar = vi.spyOn(api, "alterarNota").mockResolvedValue(nota("n1", { texto: "rascunho" }));
    const { tela } = preparar(nota("n1"));
    render(tela(<NoNota {...propsDoNo("n1")} />));
    const campo = screen.getByRole("textbox", { name: "Texto da nota" });

    fireEvent.change(campo, { target: { value: "rascunho" } });
    await act(async () => {
      fireEvent.blur(campo);
    });
    await esperarOSalvamento();

    expect(alterar).toHaveBeenCalledTimes(1);
  });

  it("erro no PATCH mostra a mensagem e permite tentar de novo", async () => {
    const alterar = vi
      .spyOn(api, "alterarNota")
      .mockRejectedValueOnce(new ErroDaApi("O texto da nota passou de 100.000 caracteres.", 400))
      .mockResolvedValueOnce(nota("n1", { texto: "texto" }));
    const { tela } = preparar(nota("n1"));
    render(tela(<NoNota {...propsDoNo("n1")} />));

    fireEvent.change(screen.getByRole("textbox", { name: "Texto da nota" }), { target: { value: "texto" } });
    await esperarOSalvamento();

    expect(screen.getByText("O texto da nota passou de 100.000 caracteres.")).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "erro ao salvar — tentar de novo" }));
    });

    expect(alterar).toHaveBeenCalledTimes(2);
    expect(alterar).toHaveBeenLastCalledWith("n1", { texto: "texto" });
    expect(screen.getByText("salvo")).toBeInTheDocument();
    expect(screen.queryByText("O texto da nota passou de 100.000 caracteres.")).not.toBeInTheDocument();
  });

  it("minimizada, mostra só a barra com o título e a prévia da primeira linha", () => {
    const { acoes, tela } = preparar(nota("n1", { titulo: "Ideias", texto: "\n  comprar café  \nsegunda linha" }));
    const { rerender } = render(tela(<NoNota {...propsDoNo("n1")} />));

    fireEvent.click(screen.getByRole("button", { name: "Minimizar a nota" }));
    expect(acoes.minimizarOuRestaurar).toHaveBeenCalledWith("n1");

    // O canvas troca o nó por um minimizado.
    rerender(tela(<NoNota {...propsDoNo("n1", true)} />));

    expect(screen.queryByRole("textbox", { name: "Texto da nota" })).not.toBeInTheDocument();
    expect(screen.getByText("Ideias")).toBeInTheDocument();
    expect(screen.getByTestId("previa-da-nota")).toHaveTextContent("comprar café");
    expect(screen.getByRole("button", { name: "Restaurar a nota" })).toBeInTheDocument();
  });

  it("minimizar e restaurar não perde o texto ainda não salvo", () => {
    vi.spyOn(api, "alterarNota").mockResolvedValue(nota("n1"));
    const { tela } = preparar(nota("n1"));
    const { rerender } = render(tela(<NoNota {...propsDoNo("n1")} />));

    fireEvent.change(screen.getByRole("textbox", { name: "Texto da nota" }), { target: { value: "lembrar do deploy" } });
    rerender(tela(<NoNota {...propsDoNo("n1", true)} />));
    expect(screen.getByTestId("previa-da-nota")).toHaveTextContent("lembrar do deploy");
    rerender(tela(<NoNota {...propsDoNo("n1")} />));

    expect(screen.getByRole("textbox", { name: "Texto da nota" })).toHaveValue("lembrar do deploy");
  });

  it("clique duplo no título abre o campo; Enter salva o novo título, em branco volta ao anterior", async () => {
    const alterar = vi.spyOn(api, "alterarNota").mockResolvedValue(nota("n1", { titulo: "Reunião" }));
    const { tela } = preparar(nota("n1"));
    render(tela(<NoNota {...propsDoNo("n1")} />));

    fireEvent.doubleClick(screen.getByText("Nova nota"));
    const titulo = screen.getByRole("textbox", { name: "Título da nota" });
    expect(titulo).toHaveAttribute("placeholder", "Sem título");
    fireEvent.change(titulo, { target: { value: "  Reunião " } });
    await act(async () => {
      fireEvent.keyDown(titulo, { key: "Enter" });
    });

    expect(alterar).toHaveBeenCalledWith("n1", { titulo: "Reunião" });
    expect(screen.getByText("Reunião")).toBeInTheDocument();

    fireEvent.doubleClick(screen.getByText("Reunião"));
    const deNovo = screen.getByRole("textbox", { name: "Título da nota" });
    fireEvent.change(deNovo, { target: { value: "   " } });
    await act(async () => {
      fireEvent.keyDown(deNovo, { key: "Enter" });
    });

    expect(screen.getByText("Reunião")).toBeInTheDocument();
    expect(alterar).toHaveBeenCalledTimes(1);
  });

  it("apagar pede confirmação e, confirmado, chama o DELETE e tira a nota do canvas", async () => {
    const confirmar = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    const remover = vi.spyOn(api, "removerNota").mockResolvedValue(null);
    const alterar = vi.spyOn(api, "alterarNota");
    const { acoes, tela } = preparar(nota("n1"));
    render(tela(<NoNota {...propsDoNo("n1")} />));
    const apagar = screen.getByRole("button", { name: "Apagar a nota" });

    fireEvent.click(apagar);
    expect(confirmar).toHaveBeenCalledWith(CONFIRMACAO_PARA_APAGAR);
    expect(remover).not.toHaveBeenCalled();

    // Com um salvamento agendado: a nota apagada não recebe PATCH depois.
    fireEvent.change(screen.getByRole("textbox", { name: "Texto da nota" }), { target: { value: "x" } });
    await act(async () => {
      fireEvent.click(apagar);
    });
    await esperarOSalvamento();

    expect(remover).toHaveBeenCalledWith("n1");
    expect(acoes.notaApagada).toHaveBeenCalledWith("n1");
    expect(alterar).not.toHaveBeenCalled();
  });

  it("se o servidor não apagar, a nota fica e mostra o motivo", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.spyOn(api, "removerNota").mockRejectedValue(new Error("Não foi possível falar com o servidor."));
    const { acoes, tela } = preparar(nota("n1"));
    render(tela(<NoNota {...propsDoNo("n1")} />));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Apagar a nota" }));
    });

    expect(screen.getByText("Não foi possível apagar a nota: Não foi possível falar com o servidor.")).toBeInTheDocument();
    expect(acoes.notaApagada).not.toHaveBeenCalled();
  });

  it("digitar numa nota não re-renderiza a outra, nem quando o salvamento volta", async () => {
    vi.spyOn(api, "alterarNota").mockResolvedValue(nota("n1", { texto: "abc", atualizadaEm: "2026-10-30T12:05:00Z" }));
    const { tela } = preparar(nota("n1"), nota("n2"));
    const renderizacoes = { n1: 0, n2: 0 };
    render(
      tela(
        <>
          <Profiler id="n1" onRender={() => (renderizacoes.n1 += 1)}>
            <NoNota {...propsDoNo("n1")} />
          </Profiler>
          <Profiler id="n2" onRender={() => (renderizacoes.n2 += 1)}>
            <NoNota {...propsDoNo("n2")} />
          </Profiler>
        </>,
      ),
    );
    const antes = { ...renderizacoes };
    const campo = screen.getAllByRole("textbox", { name: "Texto da nota" })[0];
    if (campo === undefined) {
      throw new Error("A primeira nota não tem campo de texto.");
    }

    for (const texto of ["a", "ab", "abc"]) {
      fireEvent.change(campo, { target: { value: texto } });
    }
    await esperarOSalvamento();

    expect(renderizacoes.n1).toBeGreaterThan(antes.n1);
    expect(renderizacoes.n2).toBe(antes.n2);
  });

  describe("fechar a aba com gravação pendente", () => {
    /** Dispara o evento na janela, como o navegador ao fechar; devolve se o fechamento foi barrado. */
    function sair(tipo: "beforeunload" | "pagehide"): boolean {
      const evento = new Event(tipo, { cancelable: true });
      act(() => {
        window.dispatchEvent(evento);
      });
      return evento.defaultPrevented;
    }

    afterEach(() => {
      delete (window as unknown as { electron?: unknown }).electron;
    });

    it("no navegador, pede confirmação e salva na hora; sem pendência, fecha sem perguntar", async () => {
      const alterar = servidorQueAceita();
      const { tela } = preparar(nota("n1"));
      render(tela(<NoNota {...propsDoNo("n1")} />));
      expect(sair("beforeunload")).toBe(false);

      fireEvent.change(screen.getByRole("textbox", { name: "Texto da nota" }), { target: { value: "anotar já" } });
      expect(sair("beforeunload")).toBe(true);
      expect(alterar).toHaveBeenCalledWith("n1", { texto: "anotar já" });

      await act(async () => {
        await Promise.resolve();
      });
      expect(screen.getByText("salvo")).toBeInTheDocument();
      expect(sair("beforeunload")).toBe(false);
      expect(alterar).toHaveBeenCalledTimes(1);
    });

    it("no app desktop, não barra o fechamento: só salva na hora, no beforeunload e no pagehide", async () => {
      (window as unknown as { electron?: unknown }).electron = { desktop: true, janela: {} };
      const alterar = servidorQueAceita();
      const { tela } = preparar(nota("n1"));
      render(tela(<NoNota {...propsDoNo("n1")} />));

      fireEvent.change(screen.getByRole("textbox", { name: "Texto da nota" }), { target: { value: "um" } });
      expect(sair("beforeunload")).toBe(false);
      expect(alterar).toHaveBeenLastCalledWith("n1", { texto: "um" });
      await act(async () => {
        await Promise.resolve();
      });

      fireEvent.change(screen.getByRole("textbox", { name: "Texto da nota" }), { target: { value: "dois" } });
      expect(sair("pagehide")).toBe(false);
      expect(alterar).toHaveBeenLastCalledWith("n1", { texto: "dois" });
      expect(alterar).toHaveBeenCalledTimes(2);
    });

    it("tira o aviso ao desmontar", () => {
      vi.spyOn(api, "alterarNota").mockReturnValue(new Promise(() => undefined));
      const tirar = vi.spyOn(window, "removeEventListener");
      const { tela } = preparar(nota("n1"));
      const { unmount } = render(tela(<NoNota {...propsDoNo("n1")} />));
      fireEvent.change(screen.getByRole("textbox", { name: "Texto da nota" }), { target: { value: "x" } });

      unmount();

      expect(tirar).toHaveBeenCalledWith("beforeunload", expect.any(Function));
      expect(sair("beforeunload")).toBe(false);
    });
  });

  it("enquanto o conteúdo não chega do servidor, avisa; se a lista falhar, mostra o motivo", () => {
    const { loja, tela } = preparar();
    render(tela(<NoNota {...propsDoNo("n9")} />));

    expect(screen.getByText("carregando nota…")).toBeInTheDocument();
    act(() => loja.falhouAoCarregar("O servidor respondeu com erro 500."));
    expect(screen.getByText(/Não foi possível carregar a nota\. O servidor respondeu com erro 500\./)).toBeInTheDocument();
  });

  describe("modo lista, checklist e arraste como pedido", () => {
    const CHECKLIST = "Fazer:\n- [ ] testes\n* [x] deploy\n\n[X] revisar\n[] não é item";

    it("alterna entre editar e lista; na lista, as linhas de checklist viram caixas de marcar", () => {
      const { tela } = preparar(nota("n1", { texto: CHECKLIST }));
      render(tela(<NoNota {...propsDoNo("n1")} />));

      fireEvent.click(screen.getByRole("button", { name: "Ver como lista" }));

      expect(screen.queryByRole("textbox", { name: "Texto da nota" })).not.toBeInTheDocument();
      const lista = screen.getByRole("list", { name: "Linhas da nota" });
      expect(within(lista).getAllByRole("checkbox")).toHaveLength(3);
      expect(screen.getByRole("checkbox", { name: "testes" })).not.toBeChecked();
      expect(screen.getByRole("checkbox", { name: "deploy" })).toBeChecked();
      expect(screen.getByRole("checkbox", { name: "revisar" })).toBeChecked();
      // Linhas comuns ficam como texto, inclusive "[]" sem nada dentro.
      expect(within(lista).getByText("Fazer:")).toBeInTheDocument();
      expect(within(lista).getByText("[] não é item")).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Editar o texto" }));

      expect(screen.queryByRole("list", { name: "Linhas da nota" })).not.toBeInTheDocument();
      expect(screen.getByRole("textbox", { name: "Texto da nota" })).toHaveValue(CHECKLIST);
    });

    it("marcar ou desmarcar um item reescreve só aquela linha e salva na hora, num único PATCH", async () => {
      const alterar = servidorQueAceita();
      const { loja, tela } = preparar(nota("n1", { texto: CHECKLIST }));
      render(tela(<NoNota {...propsDoNo("n1")} />));
      fireEvent.click(screen.getByRole("button", { name: "Ver como lista" }));

      await act(async () => {
        fireEvent.click(screen.getByRole("checkbox", { name: "testes" }));
      });

      const marcado = "Fazer:\n- [x] testes\n* [x] deploy\n\n[X] revisar\n[] não é item";
      expect(alterar).toHaveBeenCalledTimes(1);
      expect(alterar).toHaveBeenLastCalledWith("n1", { texto: marcado });
      expect(screen.getByRole("checkbox", { name: "testes" })).toBeChecked();
      expect(screen.getByText("salvo")).toBeInTheDocument();
      expect(loja.ler("n1")?.texto).toBe(marcado);

      await act(async () => {
        fireEvent.click(screen.getByRole("checkbox", { name: "deploy" }));
      });

      const desmarcado = "Fazer:\n- [x] testes\n* [ ] deploy\n\n[X] revisar\n[] não é item";
      expect(alterar).toHaveBeenLastCalledWith("n1", { texto: desmarcado });
      // Nada ficou agendado: a espera do salvamento não manda outro PATCH.
      await esperarOSalvamento();
      expect(alterar).toHaveBeenCalledTimes(2);

      fireEvent.click(screen.getByRole("button", { name: "Editar o texto" }));
      expect(screen.getByRole("textbox", { name: "Texto da nota" })).toHaveValue(desmarcado);
    });

    it("erro ao salvar o item marcado aparece no rodapé, a marca fica e o \"tentar de novo\" reenvia", async () => {
      const alterar = vi
        .spyOn(api, "alterarNota")
        .mockRejectedValueOnce(new ErroDaApi("Nota não encontrada.", 404))
        .mockResolvedValueOnce(nota("n1", { texto: "[x] café" }));
      const { tela } = preparar(nota("n1", { texto: "[ ] café" }));
      render(tela(<NoNota {...propsDoNo("n1")} />));
      fireEvent.click(screen.getByRole("button", { name: "Ver como lista" }));

      await act(async () => {
        fireEvent.click(screen.getByRole("checkbox", { name: "café" }));
      });

      expect(screen.getByText("Nota não encontrada.")).toBeInTheDocument();
      expect(screen.getByRole("checkbox", { name: "café" })).toBeChecked();
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "erro ao salvar — tentar de novo" }));
      });

      expect(alterar).toHaveBeenCalledTimes(2);
      expect(alterar).toHaveBeenLastCalledWith("n1", { texto: "[x] café" });
      expect(screen.getByText("salvo")).toBeInTheDocument();
    });

    it("as alças arrastam a nota inteira ou uma linha (sem o marcador) como pedido, sem mover a nota", () => {
      const texto = "Revisar:\n- [ ] rodar os testes\n\nescrever o README";
      const { tela } = preparar(nota("n1", { texto }));
      render(tela(<NoNota {...propsDoNo("n1")} />));

      const daNota = screen.getByRole("img", { name: "Arrastar a nota inteira como pedido" });
      expect(daNota).toHaveAttribute("draggable", "true");
      expect(daNota).toHaveClass("nodrag", "nopan");
      const inteira = dataTransferFalso();
      fireEvent.dragStart(daNota, { dataTransfer: inteira });
      expect(lerPedidoArrastado(inteira)).toEqual({ texto, notaId: "n1" });
      expect(inteira.getData("text/plain")).toBe(texto);

      fireEvent.click(screen.getByRole("button", { name: "Ver como lista" }));
      const alcas = screen.getAllByRole("img", { name: "Arrastar esta linha como pedido" });
      // Uma por linha com texto: a linha vazia não tem.
      expect(alcas).toHaveLength(3);
      for (const alca of alcas) {
        expect(alca).toHaveAttribute("draggable", "true");
        expect(alca).toHaveClass("nodrag", "nopan");
      }
      const doItem = alcas[1];
      if (doItem === undefined) {
        throw new Error("A linha do item não tem alça.");
      }
      const linha = dataTransferFalso();
      fireEvent.dragStart(doItem, { dataTransfer: linha });
      expect(Array.from(linha.types)).toEqual([TIPO_DO_PEDIDO_ARRASTADO, "text/plain"]);
      expect(lerPedidoArrastado(linha)).toEqual({ texto: "rodar os testes", notaId: "n1" });
      expect(linha.getData("text/plain")).toBe("rodar os testes");
    });

    it("nota em branco: a alça da barra não arrasta e a lista avisa que está vazia", () => {
      const { tela } = preparar(nota("n1", { texto: "  \n " }));
      render(tela(<NoNota {...propsDoNo("n1")} />));

      const alca = screen.getByRole("img", { name: "Arrastar a nota inteira como pedido" });
      expect(alca).toHaveAttribute("draggable", "false");
      const vazio = dataTransferFalso();
      // `false`: o arraste foi cancelado.
      expect(fireEvent.dragStart(alca, { dataTransfer: vazio })).toBe(false);
      expect(Array.from(vazio.types)).toEqual([]);

      fireEvent.click(screen.getByRole("button", { name: "Ver como lista" }));
      expect(screen.getByText("Nota vazia. Clique em editar para escrever.")).toBeInTheDocument();
      expect(screen.queryAllByRole("img", { name: "Arrastar esta linha como pedido" })).toHaveLength(0);
    });

    it("minimizar e restaurar mantém o modo lista; minimizada, sem alça nem lista", () => {
      const { tela } = preparar(nota("n1", { texto: "[ ] café" }));
      const { rerender } = render(tela(<NoNota {...propsDoNo("n1")} />));
      fireEvent.click(screen.getByRole("button", { name: "Ver como lista" }));

      rerender(tela(<NoNota {...propsDoNo("n1", true)} />));
      expect(screen.queryByRole("list", { name: "Linhas da nota" })).not.toBeInTheDocument();
      expect(screen.queryByRole("img", { name: "Arrastar a nota inteira como pedido" })).not.toBeInTheDocument();
      expect(screen.getByTestId("previa-da-nota")).toHaveTextContent("[ ] café");

      rerender(tela(<NoNota {...propsDoNo("n1")} />));
      expect(screen.getByRole("checkbox", { name: "café" })).not.toBeChecked();
      expect(screen.getByRole("button", { name: "Editar o texto" })).toBeInTheDocument();
    });
  });
});
