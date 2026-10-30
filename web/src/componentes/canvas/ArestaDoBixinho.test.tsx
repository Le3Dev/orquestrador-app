import { render } from "@testing-library/react";
import { type EdgeProps, Position } from "@xyflow/react";

import type { ArestaDoBixinho as TipoDaAresta } from "../../shared/canvas/nos";
import { ArestaDoBixinho } from "./ArestaDoBixinho";

function desenhar(animated: boolean) {
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

  it("parado, só a linha, sem bolinha", () => {
    const { container } = desenhar(false);

    expect(container.querySelector(".react-flow__edge-path")).toBeInTheDocument();
    expect(container.querySelector(".bolinha-da-troca")).not.toBeInTheDocument();
  });
});
