import { nomeDaPasta } from "./pastas";

describe("nomeDaPasta", () => {
  it.each([
    ["/Users/pedro/projetos/painel", "painel"],
    ["/Users/pedro/projetos/painel/", "painel"],
    ["C:\\Users\\pedro\\Documentos", "Documentos"],
    ["C:\\", "C:\\"],
    ["/", "/"],
  ])("%j vira %j", (caminho, nome) => {
    expect(nomeDaPasta(caminho)).toBe(nome);
  });
});
