import { tamanhoDasInstrucoes } from "./instrucoes";

describe("tamanhoDasInstrucoes", () => {
  it("conta como o servidor: sem espaço sobrando nas pontas, no fim das linhas e em linhas em branco repetidas", () => {
    expect(tamanhoDasInstrucoes("")).toBe(0);
    expect(tamanhoDasInstrucoes("  \n \t ")).toBe(0);
    expect(tamanhoDasInstrucoes("  abc  ")).toBe(3);
    expect(tamanhoDasInstrucoes("a  \r\n\r\n\r\n\r\nb")).toBe("a\n\nb".length);
    expect(tamanhoDasInstrucoes("  recuo mantido")).toBe("recuo mantido".length);
    expect(tamanhoDasInstrucoes("x\n  recuo")).toBe("x\n  recuo".length);
  });
});
