import { act, render } from "@testing-library/react";
import {
  Background,
  BackgroundVariant,
  type ReactFlowState,
  ReactFlowProvider,
  useStoreApi,
} from "@xyflow/react";
import { Profiler } from "react";

import { FundoDoCanvas } from "./FundoDoCanvas";

type Loja = ReturnType<typeof useStoreApi>;

/** Entrega a loja do React Flow ao teste, para mover a câmera como o pan e o zoom movem. */
function PegarLoja({ aoPegar }: { aoPegar: (loja: Loja) => void }) {
  aoPegar(useStoreApi());
  return null;
}

/** Move a câmera do canvas, quadro a quadro, como um pan ou zoom. */
function moverACamera(loja: Loja, quadros: readonly ReactFlowState["transform"][]) {
  act(() => {
    for (const transform of quadros) {
      loja.setState({ transform });
    }
  });
}

/** Os atributos que desenham o fundo: os do svg, do pattern, do ponto e do retângulo que o preenche. */
function desenhoDoFundo(svg: Element) {
  const atributos = (elemento: Element | null) =>
    Object.fromEntries([...(elemento?.attributes ?? [])].map((atributo) => [atributo.name, atributo.value]));
  return {
    svg: { classe: svg.getAttribute("class"), estilo: svg.getAttribute("style") },
    padrao: atributos(svg.querySelector("pattern")),
    ponto: atributos(svg.querySelector("circle")),
    retangulo: atributos(svg.querySelector("rect")),
  };
}

describe("FundoDoCanvas", () => {
  it("desenha o mesmo fundo do <Background> de pontos (gap 24, tamanho 1.4) em qualquer câmera", () => {
    let loja: Loja | undefined;
    const { container } = render(
      <ReactFlowProvider>
        <PegarLoja aoPegar={(atual) => (loja = atual)} />
        <div data-fundo="nosso">
          <FundoDoCanvas />
        </div>
        <div data-fundo="original">
          <Background variant={BackgroundVariant.Dots} gap={24} size={1.4} />
        </div>
      </ReactFlowProvider>,
    );
    const nosso = container.querySelector('[data-fundo="nosso"] svg');
    const original = container.querySelector('[data-fundo="original"] svg');
    if (nosso === null || original === null || loja === undefined) {
      throw new Error("os fundos não foram desenhados");
    }

    expect(desenhoDoFundo(nosso)).toEqual(desenhoDoFundo(original));
    for (const transform of [
      [137, -58, 1],
      [-1003.5, 412.25, 0.37],
      [55, 77, 2],
      [-24, 48, 0.1],
    ] as ReactFlowState["transform"][]) {
      moverACamera(loja, [transform]);
      expect(desenhoDoFundo(nosso), `câmera ${transform.join(", ")}`).toEqual(desenhoDoFundo(original));
    }
  });

  it("os atributos do pattern acompanham a câmera sem nenhum render do fundo", () => {
    let loja: Loja | undefined;
    let renders = 0;
    const { container } = render(
      <ReactFlowProvider>
        <PegarLoja aoPegar={(atual) => (loja = atual)} />
        <Profiler id="fundo" onRender={() => (renders += 1)}>
          <FundoDoCanvas />
        </Profiler>
      </ReactFlowProvider>,
    );
    const padrao = container.querySelector("pattern");
    const ponto = container.querySelector("circle");
    if (loja === undefined) {
      throw new Error("sem a loja do React Flow");
    }
    expect(padrao).toHaveAttribute("width", "24");
    expect(padrao).toHaveAttribute("patternTransform", "translate(-12,-12)");
    expect(ponto).toHaveAttribute("r", "0.7");
    const rendersAntes = renders;

    // Um pan e um zoom, quadro a quadro: o pattern segue, o fundo não renderiza.
    moverACamera(loja, [
      [10, 20, 1],
      [30, 50, 1],
      [100, 70, 1.5],
    ]);

    expect(renders).toBe(rendersAntes);
    expect(padrao).toHaveAttribute("x", String(100 % 36));
    expect(padrao).toHaveAttribute("y", String(70 % 36));
    expect(padrao).toHaveAttribute("width", "36");
    expect(padrao).toHaveAttribute("height", "36");
    expect(padrao).toHaveAttribute("patternTransform", "translate(-18,-18)");
    expect(ponto).toHaveAttribute("r", String((1.4 * 1.5) / 2));
    expect(ponto).toHaveAttribute("cx", String((1.4 * 1.5) / 2));
  });
});
