import { render } from "@testing-library/react";
import { type EdgeProps, Position } from "@xyflow/react";

import type { ArestaDoBixinho as TipoDaAresta } from "../../shared/canvas/nos";
import { ArestaDoBixinho } from "./ArestaDoBixinho";

function desenhar(animated: boolean, lados: Partial<EdgeProps<TipoDaAresta>> = {}) {
  const props: EdgeProps<TipoDaAresta> = {
    id: "aresta:o1::s1",
    source: "o1",
    target: "o1::s1",
    sourceX: 0,
    sourceY: 0,
    targetX: 120,
    targetY: 200,
    sourcePosition: Position.Bottom,
    targetPosition: Position.Top,
    animated,
    ...lados,
  };
  return render(
    <svg>
      <ArestaDoBixinho {...props} />
    </svg>,
  );
}

describe("ArestaDoBixinho", () => {
  it("executando, a bolinha vai e volta pela mesma curva da linha", () => {
    const { container } = desenhar(true);
    const caminho = container.querySelector(".react-flow__edge-path")?.getAttribute("d");

    expect(caminho).toBeTruthy();
    expect(container.querySelector(".bolinha-da-troca animateMotion")?.getAttribute("path")).toBe(caminho);
  });

  it("a curva sai e chega pelos lados das âncoras: de cima do terminal para baixo do bixinho, acima dele", () => {
    const { container } = desenhar(false, {
      targetY: -200,
      sourcePosition: Position.Top,
      targetPosition: Position.Bottom,
    });
    const numeros = (container.querySelector(".react-flow__edge-path")?.getAttribute("d") ?? "")
      .match(/-?\d+(\.\d+)?/g)
      ?.map(Number);
    // M origem C controle-da-origem controle-do-destino destino
    const [origemX, origemY, controleX, controleY, , controleDoDestinoY, , destinoY] = numeros ?? [];

    expect([origemX, origemY, destinoY]).toEqual([0, 0, -200]);
    expect(controleX).toBe(0);
    expect(controleY).toBeLessThan(0);
    expect(controleDoDestinoY).toBeGreaterThan(-200);
  });

  it("parado, só a linha, sem bolinha", () => {
    const { container } = desenhar(false);

    expect(container.querySelector(".react-flow__edge-path")).toBeInTheDocument();
    expect(container.querySelector(".bolinha-da-troca")).not.toBeInTheDocument();
  });
});
