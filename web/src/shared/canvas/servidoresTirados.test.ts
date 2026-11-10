import { interpretarServidoresTirados, lerServidoresTirados, salvarServidoresTirados } from "./layout";

describe("servidores tirados da faixa", () => {
  beforeEach(() => localStorage.clear());

  it("sem nada salvo, ou com o salvo corrompido, ninguém foi tirado", () => {
    expect(lerServidoresTirados("o1")).toEqual({});
    expect(interpretarServidoresTirados("{não é json").size).toBe(0);
    expect(interpretarServidoresTirados('["a"]').size).toBe(0);
    expect(interpretarServidoresTirados(null).size).toBe(0);
  });

  it("descarta o que não é endereço com sequência", () => {
    const lidos = interpretarServidoresTirados(
      JSON.stringify({ o1: { "http://localhost:3000": 4, "http://localhost:5173": "x", "http://localhost:4000": -1 }, o2: [], o3: 5 }),
    );

    expect([...lidos.keys()]).toEqual(["o1"]);
    expect(lidos.get("o1")).toEqual({ "http://localhost:3000": 4 });
  });

  it("grava por Orquestrador, sem mexer nos outros, e limpar tudo remove o Orquestrador", () => {
    salvarServidoresTirados("o1", { "http://localhost:3000": 4 });
    salvarServidoresTirados("o2", { "http://localhost:5173": 9 });

    expect(lerServidoresTirados("o1")).toEqual({ "http://localhost:3000": 4 });
    expect(lerServidoresTirados("o2")).toEqual({ "http://localhost:5173": 9 });

    salvarServidoresTirados("o1", {});
    expect(lerServidoresTirados("o1")).toEqual({});
    expect(lerServidoresTirados("o2")).toEqual({ "http://localhost:5173": 9 });
  });

  it("não convive com o layout das janelas: a chave é outra", () => {
    localStorage.setItem("orquestrador-agentes:canvas:v1", JSON.stringify({ terminais: {} }));
    salvarServidoresTirados("o1", { "http://localhost:3000": 4 });

    expect(localStorage.getItem("orquestrador-agentes:canvas:v1")).toBe(JSON.stringify({ terminais: {} }));
  });

  it("guarda só os 50 de anúncio mais recente", () => {
    const muitos = Object.fromEntries(Array.from({ length: 60 }, (_, indice) => [`http://localhost:${3000 + indice}`, indice + 1]));
    salvarServidoresTirados("o1", muitos);

    const lidos = lerServidoresTirados("o1");
    expect(Object.keys(lidos)).toHaveLength(50);
    expect(lidos["http://localhost:3000"]).toBeUndefined();
    expect(lidos["http://localhost:3059"]).toBe(60);
  });
});
