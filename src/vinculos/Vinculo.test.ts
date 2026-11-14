import { describe, expect, it } from "vitest";

import { ErroDeVinculo } from "./ErroDeVinculo";
import { TAMANHO_MAXIMO_DAS_NOTAS_DO_VINCULO, Vinculo } from "./Vinculo";

const agora = new Date("2026-11-14T10:00:00Z");
const depois = new Date("2026-11-14T11:00:00Z");

function novo(): Vinculo {
  return Vinculo.criar({ id: "v1", orquestradorAId: "a", orquestradorBId: "b", agora });
}

describe("Vinculo", () => {
  it("nasce sem notas, com as datas de criação e atualização iguais", () => {
    const vinculo = novo();

    expect(vinculo.paraDados()).toEqual({
      id: "v1",
      orquestradorAId: "a",
      orquestradorBId: "b",
      notas: "",
      criadoEm: agora.toISOString(),
      atualizadoEm: agora.toISOString(),
    });
  });

  it("recusa vincular um orquestrador a ele mesmo e ids vazios", () => {
    expect(() => Vinculo.criar({ id: "v", orquestradorAId: "a", orquestradorBId: "a", agora })).toThrow(ErroDeVinculo);
    expect(() => Vinculo.criar({ id: "v", orquestradorAId: "", orquestradorBId: "a", agora })).toThrow(ErroDeVinculo);
  });

  it("reconhece o par em qualquer ordem e o parceiro de cada lado", () => {
    const vinculo = novo();

    expect(vinculo.ehEntre("a", "b")).toBe(true);
    expect(vinculo.ehEntre("b", "a")).toBe(true);
    expect(vinculo.ehEntre("a", "c")).toBe(false);
    expect(vinculo.envolve("b")).toBe(true);
    expect(vinculo.envolve("c")).toBe(false);
    expect(vinculo.parceiroDe("a")).toBe("b");
    expect(vinculo.parceiroDe("b")).toBe("a");
    expect(vinculo.parceiroDe("c")).toBeNull();
  });

  it("reescreve as notas inteiras e atualiza a data; texto igual não conta", () => {
    const vinculo = novo();

    vinculo.reescreverNotas("contrato: POST /x", depois);
    expect(vinculo.notas).toBe("contrato: POST /x");
    expect(vinculo.atualizadoEm).toEqual(depois);

    vinculo.reescreverNotas("contrato: POST /x", new Date("2026-11-15T00:00:00Z"));
    expect(vinculo.atualizadoEm).toEqual(depois);
  });

  it("aceita notas no limite e recusa acima dele", () => {
    const vinculo = novo();

    vinculo.reescreverNotas("x".repeat(TAMANHO_MAXIMO_DAS_NOTAS_DO_VINCULO), depois);
    expect(() => vinculo.reescreverNotas("x".repeat(TAMANHO_MAXIMO_DAS_NOTAS_DO_VINCULO + 1), depois)).toThrow(
      ErroDeVinculo,
    );
  });

  it("reconstituir devolve os mesmos dados", () => {
    const vinculo = novo();
    vinculo.reescreverNotas("n", depois);

    expect(Vinculo.reconstituir(vinculo.paraDados()).paraDados()).toEqual(vinculo.paraDados());
  });
});
