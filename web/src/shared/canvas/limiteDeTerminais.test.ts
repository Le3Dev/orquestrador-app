import {
  AVISO_DO_LIMITE_DE_ORQUESTRADORES,
  cabeOutroTerminal,
  LIMITE_DE_ORQUESTRADORES_ABERTOS,
} from "./limiteDeTerminais";

/** `o1`, `o2`… até `quantos`. */
const ids = (quantos: number) => Array.from({ length: quantos }, (_, indice) => `o${indice + 1}`);

describe("limite de orquestradores abertos", () => {
  const LIMITE = LIMITE_DE_ORQUESTRADORES_ABERTOS;

  it("o limite é 20 e o aviso usa o número da constante", () => {
    expect(LIMITE).toBe(20);
    expect(AVISO_DO_LIMITE_DE_ORQUESTRADORES).toBe(
      "Limite de 20 orquestradores abertos. Feche um dos orquestradores (✕ na barra do terminal) antes de iniciar outro.",
    );
  });

  it("com um a menos que o limite, cabe outro", () => {
    expect(cabeOutroTerminal(ids(LIMITE - 1), [], null)).toBe(true);
    expect(cabeOutroTerminal(ids(LIMITE - 1), [], `o${LIMITE}`)).toBe(true);
  });

  it("no limite, não cabe outro", () => {
    expect(cabeOutroTerminal(ids(LIMITE), [], null)).toBe(false);
    expect(cabeOutroTerminal(ids(LIMITE), [], `o${LIMITE + 1}`)).toBe(false);
  });

  it("no limite, pedir um que já está aberto cabe (só foca)", () => {
    expect(cabeOutroTerminal(ids(LIMITE), [], "o2")).toBe(true);
  });

  it("o rascunho de novo orquestrador conta como aberto", () => {
    expect(cabeOutroTerminal(ids(LIMITE - 1), ["rascunho:1"], null)).toBe(false);
    expect(cabeOutroTerminal(ids(LIMITE - 2), ["rascunho:1"], `o${LIMITE - 1}`)).toBe(true);
  });
});
