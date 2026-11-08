import { nomeDeSubagente } from "./subagentesProntos";

describe("nomeDeSubagente", () => {
  it.each([
    ["Revisor", "revisor"],
    ["Testador de Ação", "testador-de-acao"],
    ["api_rest!", "apirest"],
    ["já-ok-2", "ja-ok-2"],
  ])("%j vira %j", (texto, nome) => {
    expect(nomeDeSubagente(texto)).toBe(nome);
  });
});
