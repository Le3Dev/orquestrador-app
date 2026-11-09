import { type ChipDaBarra, chipsParaOMenu, ORDEM_DE_SAIDA } from "./barraDoTerminal";

const TODOS: readonly ChipDaBarra[] = ["pasta", "branch", "instrucoes", "reconectando", "memoria", "situacao"];
const COMUNS: readonly ChipDaBarra[] = ["pasta", "branch", "instrucoes", "situacao"];
const CONTROLES = 240;

describe("chipsParaOMenu", () => {
  it("sem medida ainda, nada vai para o menu (o CSS segura os controles)", () => {
    expect(chipsParaOMenu(0, CONTROLES, TODOS).size).toBe(0);
  });

  it("com espaço de sobra, todos os chips ficam na barra", () => {
    expect(chipsParaOMenu(1200, CONTROLES, TODOS).size).toBe(0);
  });

  it("apertada, os chips saem na ordem: primeiro as instruções", () => {
    expect([...chipsParaOMenu(706, CONTROLES, COMUNS)]).toEqual(["instrucoes"]);
    expect([...chipsParaOMenu(600, CONTROLES, COMUNS)]).toEqual(["instrucoes", "pasta", "branch"]);
  });

  it("conta a largura medida dos controles: com mais controles, sai mais", () => {
    expect(chipsParaOMenu(706, 300, COMUNS).size).toBeGreaterThan(chipsParaOMenu(706, CONTROLES, COMUNS).size);
  });

  it("muito estreita, todos vão para o menu, na ordem de saída", () => {
    expect([...chipsParaOMenu(300, CONTROLES, TODOS)]).toEqual(ORDEM_DE_SAIDA);
  });

  it("só considera os chips presentes", () => {
    const fora = chipsParaOMenu(300, CONTROLES, ["situacao"]);
    expect([...fora]).toEqual(["situacao"]);
    expect(fora.has("memoria")).toBe(false);
  });
});
