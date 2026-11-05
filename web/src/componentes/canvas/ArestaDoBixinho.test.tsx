import { act, render } from "@testing-library/react";
import { type EdgeProps, Position } from "@xyflow/react";
import type { ReactNode } from "react";

import type { SituacaoDoSubagente } from "../../shared/api/tipos";
import { DURACAO_DA_ENTREGA_MS } from "../../shared/canvas/entrega";
import type { ArestaDoBixinho as TipoDaAresta } from "../../shared/canvas/nos";
import { ArestaDoBixinho } from "./ArestaDoBixinho";

/** O relógio dos testes de entrega. */
const AGORA = new Date("2026-10-28T12:00:06Z");
/** Quando o Subagente encerrou: há 1 s (ao vivo) ou há meia hora (histórico reenviado ao recarregar a página). */
const ENCERROU_AGORA = "2026-10-28T12:00:05Z";
const ENCERROU_HA_MEIA_HORA = "2026-10-28T11:30:00Z";

function propsDaAresta(
  situacao: SituacaoDoSubagente,
  lados: Partial<EdgeProps<TipoDaAresta>> = {},
): EdgeProps<TipoDaAresta> {
  return {
    id: "aresta:o1::s1",
    source: "o1",
    target: "o1::s1",
    sourceX: 0,
    sourceY: 0,
    targetX: 120,
    targetY: 200,
    sourcePosition: Position.Bottom,
    targetPosition: Position.Top,
    animated: situacao === "executando",
    data: { situacao, encerradoEm: situacao === "executando" ? null : ENCERROU_AGORA },
    ...lados,
  };
}

/** A linha dentro de um SVG; `envolver` põe o canvas em volta (ex.: desconectado). */
function linha(situacao: SituacaoDoSubagente, lados: Partial<EdgeProps<TipoDaAresta>> = {}, classeDoCanvas = ""): ReactNode {
  return (
    <div className={classeDoCanvas}>
      <svg>
        <ArestaDoBixinho {...propsDaAresta(situacao, lados)} />
      </svg>
    </div>
  );
}

function desenhar(animated: boolean, lados: Partial<EdgeProps<TipoDaAresta>> = {}) {
  return render(linha(animated ? "executando" : "concluido", { animated, ...lados }));
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

  describe("entrega do relatório", () => {
    const comecar = vi.fn();
    const reduzirMovimento = { ligado: false };

    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(AGORA);
      comecar.mockClear();
      reduzirMovimento.ligado = false;
      // O jsdom não tem SMIL: `beginElement` vira um espião.
      Object.defineProperty(SVGElement.prototype, "beginElement", { value: comecar, configurable: true });
      Object.defineProperty(window, "matchMedia", {
        configurable: true,
        value: (consulta: string) => ({
          matches: consulta === "(prefers-reduced-motion: reduce)" && reduzirMovimento.ligado,
          media: consulta,
        }),
      });
    });

    afterEach(() => {
      vi.useRealTimers();
      Reflect.deleteProperty(SVGElement.prototype, "beginElement");
      Reflect.deleteProperty(window, "matchMedia");
    });

    it("executando → concluído: o envelope vai do bixinho ao terminal pela curva, uma vez, e some", () => {
      const { container, rerender } = render(linha("executando"));
      expect(container.querySelector(".envelope-da-entrega")).not.toBeInTheDocument();

      rerender(linha("concluido"));

      const caminho = container.querySelector(".react-flow__edge-path")?.getAttribute("d");
      const percurso = container.querySelector(".envelope-da-entrega animateMotion");
      expect(percurso?.getAttribute("path")).toBe(caminho);
      // A linha vai do terminal (source) ao bixinho (target): o envelope faz o caminho de volta.
      expect(percurso?.getAttribute("keyPoints")).toBe("1;0");
      expect(percurso?.getAttribute("dur")).toBe(`${DURACAO_DA_ENTREGA_MS}ms`);
      expect(percurso?.getAttribute("repeatCount")).toBeNull();
      // Começa pelo `beginElement`, e não no tempo do documento, que já passou.
      expect(percurso?.getAttribute("begin")).toBe("indefinite");
      expect(comecar).toHaveBeenCalledTimes(2);
      expect(container.querySelector(".bolinha-da-troca")).not.toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(DURACAO_DA_ENTREGA_MS);
      });
      expect(container.querySelector(".envelope-da-entrega")).not.toBeInTheDocument();
    });

    it("arrastar durante a entrega não recomeça o envelope", () => {
      const { container, rerender } = render(linha("executando"));
      rerender(linha("concluido"));
      rerender(linha("concluido", { targetX: 300 }));

      expect(comecar).toHaveBeenCalledTimes(2);
      expect(container.querySelector(".envelope-da-entrega animateMotion")?.getAttribute("path")).toBe(
        container.querySelector(".react-flow__edge-path")?.getAttribute("d"),
      );
    });

    it("só entrega o que acabou de acontecer: executando → concluído com a hora recente aparece", () => {
      const { container, rerender } = render(linha("executando"));

      rerender(linha("concluido", { data: { situacao: "concluido", encerradoEm: ENCERROU_AGORA } }));

      expect(container.querySelector(".envelope-da-entrega")).toBeInTheDocument();
      expect(comecar).toHaveBeenCalledTimes(2);
    });

    it("não aparece com o histórico antigo reenviado evento a evento (recarregar a página)", () => {
      const { container, rerender } = render(linha("executando"));

      rerender(linha("concluido", { data: { situacao: "concluido", encerradoEm: ENCERROU_HA_MEIA_HORA } }));

      expect(container.querySelector(".envelope-da-entrega")).not.toBeInTheDocument();
      expect(comecar).not.toHaveBeenCalled();
    });

    it("não aparece ao montar a linha com o Subagente já concluído (recarregar a página)", () => {
      const { container, rerender } = render(linha("concluido"));
      rerender(linha("concluido", { targetX: 300 }));

      expect(container.querySelector(".envelope-da-entrega")).not.toBeInTheDocument();
      expect(comecar).not.toHaveBeenCalled();
    });

    it.each<SituacaoDoSubagente>(["falhou", "cancelado"])("não aparece quando o Subagente termina como %s", (fim) => {
      const { container, rerender } = render(linha("executando"));
      rerender(linha(fim));

      expect(container.querySelector(".envelope-da-entrega")).not.toBeInTheDocument();
    });

    it("não aparece com o reduzir movimento do sistema", () => {
      reduzirMovimento.ligado = true;
      const { container, rerender } = render(linha("executando"));
      rerender(linha("concluido"));

      expect(container.querySelector(".envelope-da-entrega")).not.toBeInTheDocument();
      expect(comecar).not.toHaveBeenCalled();
    });

    it("não aparece com o servidor desconectado", () => {
      const { container, rerender } = render(linha("executando", {}, "canvas-desconectado"));
      rerender(linha("concluido", {}, "canvas-desconectado"));

      expect(container.querySelector(".envelope-da-entrega")).not.toBeInTheDocument();
      expect(comecar).not.toHaveBeenCalled();
    });
  });
});
