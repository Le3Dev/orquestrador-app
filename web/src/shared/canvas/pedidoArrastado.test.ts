import {
  escreverPedidoArrastado,
  lerPedidoArrastado,
  temPedidoArrastado,
  TIPO_DO_PEDIDO_ARRASTADO,
} from "./pedidoArrastado";

/** O jsdom não tem `DataTransfer`: um com o mínimo que o arraste usa. */
function dataTransferFalso(inicial: Record<string, string> = {}) {
  const dados = new Map(Object.entries(inicial));
  return {
    get types(): readonly string[] {
      return [...dados.keys()];
    },
    setData: (tipo: string, valor: string) => {
      dados.set(tipo, valor);
    },
    getData: (tipo: string) => dados.get(tipo) ?? "",
  };
}

describe("pedido arrastado", () => {
  it("ida e volta: grava o JSON no tipo próprio e o texto puro, e lê de volta", () => {
    const dataTransfer = dataTransferFalso();

    escreverPedidoArrastado(dataTransfer, { texto: "revisar o domínio\ne os testes", notaId: "n1" });

    expect(TIPO_DO_PEDIDO_ARRASTADO).toBe("application/x-orquestrador-pedido");
    expect(dataTransfer.types).toEqual([TIPO_DO_PEDIDO_ARRASTADO, "text/plain"]);
    expect(dataTransfer.getData("text/plain")).toBe("revisar o domínio\ne os testes");
    expect(temPedidoArrastado(dataTransfer)).toBe(true);
    expect(lerPedidoArrastado(dataTransfer)).toEqual({ texto: "revisar o domínio\ne os testes", notaId: "n1" });
  });

  it("só com texto puro (ou arquivos), não é um pedido", () => {
    const soTexto = dataTransferFalso({ "text/plain": "olá" });
    const arquivos = dataTransferFalso({ Files: "" });

    expect(temPedidoArrastado(soTexto)).toBe(false);
    expect(lerPedidoArrastado(soTexto)).toBeNull();
    expect(temPedidoArrastado(arquivos)).toBe(false);
    expect(lerPedidoArrastado(arquivos)).toBeNull();
  });

  it.each([
    ["JSON quebrado", "{texto:"],
    ["não é objeto", '"só texto"'],
    ["nulo", "null"],
    ["sem notaId", JSON.stringify({ texto: "a" })],
    ["texto que não é texto", JSON.stringify({ texto: 1, notaId: "n1" })],
    ["notaId que não é texto", JSON.stringify({ texto: "a", notaId: 1 })],
    ["texto em branco", JSON.stringify({ texto: "  \n ", notaId: "n1" })],
  ])("JSON inválido (%s) → nulo", (_caso, bruto) => {
    expect(lerPedidoArrastado(dataTransferFalso({ [TIPO_DO_PEDIDO_ARRASTADO]: bruto }))).toBeNull();
  });
});
