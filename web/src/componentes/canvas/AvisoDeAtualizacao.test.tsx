import { act, fireEvent, render, screen, within } from "@testing-library/react";

import type { EstadoDaAtualizacao, SituacaoDaAtualizacao } from "../../shared/ponteDoDesktop";
import { AvisoDeAtualizacao } from "./AvisoDeAtualizacao";

type AoMudar = (estado: EstadoDaAtualizacao) => void;

function estado(alteracoes: Partial<EstadoDaAtualizacao> = {}): EstadoDaAtualizacao {
  return {
    situacao: "em-dia",
    versaoAtual: "0.2.0",
    versaoNova: null,
    progresso: null,
    mensagemDeErro: null,
    ...alteracoes,
  };
}

const PRONTA = estado({ situacao: "pronta", versaoNova: "0.2.1" });

describe("AvisoDeAtualizacao", () => {
  const janelaComPonte = window as unknown as { electron?: unknown };

  afterEach(() => {
    delete janelaComPonte.electron;
  });

  function instalarPonte(inicial: EstadoDaAtualizacao, instalarAgora: () => Promise<void> = vi.fn(async () => undefined)) {
    const ouvintes: AoMudar[] = [];
    const atualizacao = {
      obter: vi.fn(async () => inicial),
      verificar: vi.fn(async () => inicial),
      instalarAgora,
      aoMudar: vi.fn((callback: AoMudar) => {
        ouvintes.push(callback);
        return () => undefined;
      }),
    };
    janelaComPonte.electron = { desktop: true, atualizacao };
    const avisar = (novo: EstadoDaAtualizacao) => act(() => ouvintes.forEach((ouvinte) => ouvinte(novo)));
    return { atualizacao, avisar };
  }

  /** Renderiza e espera a leitura inicial do estado. */
  async function renderizar(pedidosEmAndamento = 0) {
    const resultado = render(<AvisoDeAtualizacao pedidosEmAndamento={pedidosEmAndamento} />);
    await act(async () => undefined);
    return resultado;
  }

  const pilula = () => screen.getByRole("button", { name: "Atualização pronta (v0.2.1)" });
  const abrirCartao = () => {
    fireEvent.click(pilula());
    return screen.getByRole("dialog", { name: "Atualização pronta" });
  };

  it("sem a ponte (navegador), não desenha nada", async () => {
    const { container } = await renderizar();

    expect(container).toBeEmptyDOMElement();
  });

  it.each<SituacaoDaAtualizacao>(["indisponivel", "em-dia", "verificando", "erro"])(
    "em \"%s\", não desenha nada na barra",
    async (situacao) => {
      const { atualizacao } = instalarPonte(
        estado({ situacao, mensagemDeErro: situacao === "erro" ? "sem internet" : null }),
      );
      const { container } = await renderizar(1);

      expect(atualizacao.obter).toHaveBeenCalledTimes(1);
      expect(container).toBeEmptyDOMElement();
    },
  );

  it("baixando: um indicador discreto com o percentual, fora do arraste e sem botões", async () => {
    const { avisar } = instalarPonte(estado({ situacao: "baixando", versaoNova: "0.2.1", progresso: 45 }));
    await renderizar();

    const indicador = screen.getByRole("status");
    expect(indicador).toHaveTextContent("Baixando atualização 45%");
    expect(indicador).toHaveClass("no-drag");
    expect(indicador).toHaveAttribute(
      "title",
      "A versão 0.2.1 está sendo baixada; ela será instalada quando você fechar o app.",
    );
    expect(indicador.querySelector(".medidor > span")).toHaveStyle({ width: "45%" });
    expect(screen.queryByRole("button")).not.toBeInTheDocument();

    avisar(estado({ situacao: "baixando", versaoNova: "0.2.1", progresso: 80 }));
    expect(screen.getByRole("status")).toHaveTextContent("Baixando atualização 80%");
  });

  it("pronta: a pílula (no-drag) abre o cartão, e \"Reiniciar agora\" instala", async () => {
    const instalarAgora = vi.fn(async () => undefined);
    instalarPonte(PRONTA, instalarAgora);
    await renderizar();

    expect(pilula().parentElement).toHaveClass("no-drag");
    expect(pilula()).toHaveAttribute("aria-expanded", "false");
    const cartao = abrirCartao();

    expect(pilula()).toHaveAttribute("aria-expanded", "true");
    expect(cartao).toHaveTextContent(
      "A versão 0.2.1 foi baixada. Ela será instalada quando você fechar o app, ou reinicie agora.",
    );
    expect(cartao).toHaveClass("no-drag");
    expect(cartao).toHaveFocus();
    fireEvent.click(within(cartao).getByRole("button", { name: "Reiniciar agora" }));

    expect(instalarAgora).toHaveBeenCalledTimes(1);
  });

  it("com pedidos em andamento, avisa e pede confirmação antes de reiniciar", async () => {
    const instalarAgora = vi.fn(async () => undefined);
    instalarPonte(PRONTA, instalarAgora);
    await renderizar(2);
    const cartao = abrirCartao();

    fireEvent.click(within(cartao).getByRole("button", { name: "Reiniciar agora" }));

    expect(instalarAgora).not.toHaveBeenCalled();
    expect(within(cartao).getByRole("alert")).toHaveTextContent(
      "Há 2 pedidos em andamento; reiniciar agora vai cancelá-los.",
    );
    // "Voltar" desiste e volta ao primeiro passo.
    fireEvent.click(within(cartao).getByRole("button", { name: "Voltar" }));
    expect(instalarAgora).not.toHaveBeenCalled();
    fireEvent.click(within(cartao).getByRole("button", { name: "Reiniciar agora" }));
    fireEvent.click(within(cartao).getByRole("button", { name: "Reiniciar mesmo assim" }));

    expect(instalarAgora).toHaveBeenCalledTimes(1);
  });

  it("\"Depois\" esconde a pílula até o estado mudar de novo", async () => {
    const { avisar } = instalarPonte(PRONTA);
    const { container } = await renderizar();
    const cartao = abrirCartao();

    fireEvent.click(within(cartao).getByRole("button", { name: "Depois" }));

    expect(container).toBeEmptyDOMElement();
    avisar(estado({ situacao: "verificando" }));
    avisar(PRONTA);
    expect(pilula()).toBeInTheDocument();
    // Volta fechada: o cartão não reabre sozinho.
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("Esc e clique fora fecham o cartão; a pílula continua", async () => {
    instalarPonte(PRONTA);
    await renderizar();

    fireEvent.keyDown(abrirCartao(), { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(pilula()).toHaveFocus();

    abrirCartao();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(pilula()).toBeInTheDocument();
  });

  it("se reiniciar falha, o motivo aparece no cartão", async () => {
    instalarPonte(PRONTA, vi.fn().mockRejectedValue(new Error("arquivo em uso")));
    await renderizar();
    const cartao = abrirCartao();

    await act(async () => {
      fireEvent.click(within(cartao).getByRole("button", { name: "Reiniciar agora" }));
    });

    expect(within(cartao).getByRole("alert")).toHaveTextContent(
      "Não foi possível reiniciar para instalar: arquivo em uso",
    );
  });
});
