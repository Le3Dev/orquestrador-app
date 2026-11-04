import {
  AVISO_DO_LIMITE_DE_ORQUESTRADORES,
  cabeOutroTerminal,
  LIMITE_DE_ORQUESTRADORES_ABERTOS,
} from "./limiteDeTerminais";

describe("limite de orquestradores abertos", () => {
  it("o limite é 4 e o aviso usa o número da constante", () => {
    expect(LIMITE_DE_ORQUESTRADORES_ABERTOS).toBe(4);
    expect(AVISO_DO_LIMITE_DE_ORQUESTRADORES).toBe(
      "Limite de 4 orquestradores abertos. Feche um dos orquestradores (✕ na barra do terminal) antes de iniciar outro.",
    );
  });

  it("com 3 abertos, cabe outro", () => {
    expect(cabeOutroTerminal(["o1", "o2", "o3"], [], null)).toBe(true);
    expect(cabeOutroTerminal(["o1", "o2", "o3"], [], "o4")).toBe(true);
  });

  it("com 4 abertos, não cabe outro", () => {
    expect(cabeOutroTerminal(["o1", "o2", "o3", "o4"], [], null)).toBe(false);
    expect(cabeOutroTerminal(["o1", "o2", "o3", "o4"], [], "o5")).toBe(false);
  });

  it("com 4 abertos, pedir um que já está aberto cabe (só foca)", () => {
    expect(cabeOutroTerminal(["o1", "o2", "o3", "o4"], [], "o2")).toBe(true);
  });

  it("o rascunho de novo orquestrador conta como aberto", () => {
    expect(cabeOutroTerminal(["o1", "o2", "o3"], ["rascunho:1"], null)).toBe(false);
    expect(cabeOutroTerminal(["o1", "o2"], ["rascunho:1"], "o3")).toBe(true);
  });
});
