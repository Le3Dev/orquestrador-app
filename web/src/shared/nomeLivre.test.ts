import { nomeLivre } from "./nomeLivre";

describe("nomeLivre", () => {
  it("usa o nome do projeto quando ninguém o usa", () => {
    expect(nomeLivre("painel", [])).toBe("painel");
    expect(nomeLivre("painel", ["outro", "painel 2"])).toBe("painel");
  });

  it("numera a partir de 2, sem diferenciar maiúsculas", () => {
    expect(nomeLivre("painel", ["Painel"])).toBe("painel 2");
    expect(nomeLivre("painel", ["painel", "PAINEL 2"])).toBe("painel 3");
  });

  it("pega o primeiro número livre", () => {
    expect(nomeLivre("painel", ["painel", "painel 3"])).toBe("painel 2");
    expect(nomeLivre("painel", ["painel", "painel 2", "painel 4"])).toBe("painel 3");
  });
});
