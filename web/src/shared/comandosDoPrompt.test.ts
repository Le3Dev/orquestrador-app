import { comandoDoPrompt, completarComando, dicaDeComando, dicaDePedidoGrande, pedidoGrande } from "./comandosDoPrompt";

describe("comandosDoPrompt", () => {
  it("/clear sozinho é o comando de limpar, tolerando espaços e maiúsculas", () => {
    expect(comandoDoPrompt("/clear")).toBe("limpar");
    expect(comandoDoPrompt("  /CLEAR \n")).toBe("limpar");
    expect(comandoDoPrompt("/Clear")).toBe("limpar");
  });

  it("com mais texto, no meio do texto ou incompleto, é um pedido comum", () => {
    expect(comandoDoPrompt("/clear algo")).toBeNull();
    expect(comandoDoPrompt("texto /clear")).toBeNull();
    expect(comandoDoPrompt("/clea")).toBeNull();
    expect(comandoDoPrompt("")).toBeNull();
  });

  it("dá a dica enquanto o texto é o começo de /clear", () => {
    expect(dicaDeComando("/", false)).toBe("/clear — começar uma conversa nova · tab completa");
    expect(dicaDeComando("/cl", false)).toBe("/clear — começar uma conversa nova · tab completa");
    expect(dicaDeComando("/clear", false)).toBe("/clear — começar uma conversa nova · enter");
  });

  it("não dá dica para outros textos", () => {
    expect(dicaDeComando("/x", false)).toBeNull();
    expect(dicaDeComando("/clear algo", false)).toBeNull();
    expect(dicaDeComando("corrija o bug", false)).toBeNull();
    expect(dicaDeComando("", false)).toBeNull();
  });

  it("durante um pedido, a dica avisa que o comando está indisponível", () => {
    expect(dicaDeComando("/clear", true)).toBe("/clear — indisponível durante um pedido · esc cancela");
    expect(dicaDeComando("/cl", true)).toBe("/clear — indisponível durante um pedido · esc cancela");
    expect(dicaDeComando("/x", true)).toBeNull();
  });

  it("o Tab completa só o comando incompleto", () => {
    expect(completarComando("/cl")).toBe("/clear");
    expect(completarComando("/")).toBe("/clear");
    expect(completarComando("/clear")).toBeNull();
    expect(completarComando("/x")).toBeNull();
    expect(completarComando("texto")).toBeNull();
  });

  it("pedido longo ou com lista de 3+ itens é grande", () => {
    expect(pedidoGrande("a".repeat(401))).toBe(true);
    expect(pedidoGrande("a".repeat(400))).toBe(false);
    expect(pedidoGrande("faça:\n- uma coisa\n- outra\n- mais uma")).toBe(true);
    expect(pedidoGrande("faça:\n1. uma coisa\n2) outra\n3. mais uma")).toBe(true);
    expect(pedidoGrande("faça:\n- uma coisa\n- outra")).toBe(false);
  });

  it("sugere planejar o pedido grande só em execução", () => {
    const grande = "a".repeat(500);

    expect(dicaDePedidoGrande(grande, "execucao")).toBe("pedido grande? shift+tab para planejar antes");
    expect(dicaDePedidoGrande(grande, "planejamento")).toBeNull();
    expect(dicaDePedidoGrande("corrija o bug", "execucao")).toBeNull();
  });
});
