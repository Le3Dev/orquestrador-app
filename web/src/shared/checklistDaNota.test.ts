import { alternarItem, ehItemDeChecklist, itemMarcado, linhasDaNota, textoDoItem } from "./checklistDaNota";

describe("checklist da nota", () => {
  it("reconhece [ ], [x] e [X], com ou sem - ou * antes", () => {
    for (const linha of ["[ ] a", "[x] a", "[X] a", "- [ ] a", "* [x] a", "  - [ ] recuado", "[ ]"]) {
      expect(ehItemDeChecklist(linha)).toBe(true);
    }
    for (const linha of ["comprar café", "- comprar café", "[] a", "[y] a", "a [ ] b", "-[ ] a", ""]) {
      expect(ehItemDeChecklist(linha)).toBe(false);
    }
    expect(itemMarcado("[ ] a")).toBe(false);
    expect(itemMarcado("- [x] a")).toBe(true);
    expect(itemMarcado("[X] a")).toBe(true);
    expect(itemMarcado("texto")).toBe(false);
  });

  it("textoDoItem tira o marcador; a linha comum volta igual", () => {
    expect(textoDoItem("- [ ] comprar café")).toBe("comprar café");
    expect(textoDoItem("[x] feito\r")).toBe("feito");
    expect(textoDoItem("* [X]sem espaço")).toBe("sem espaço");
    expect(textoDoItem("  [ ]  dois espaços")).toBe(" dois espaços");
    expect(textoDoItem("só texto")).toBe("só texto");
  });

  it("alternar troca [ ] por [x] e de volta, só naquela linha", () => {
    const texto = "Compras\n[ ] café\n[x] pão\n[X] leite";

    expect(alternarItem(texto, 1)).toBe("Compras\n[x] café\n[x] pão\n[X] leite");
    expect(alternarItem(texto, 2)).toBe("Compras\n[ ] café\n[ ] pão\n[X] leite");
    expect(alternarItem(texto, 3)).toBe("Compras\n[ ] café\n[x] pão\n[ ] leite");
    expect(alternarItem(alternarItem(texto, 1), 1)).toBe(texto);
  });

  it("alternar com - ou * antes preserva o marcador da lista e o recuo", () => {
    expect(alternarItem("- [ ] café", 0)).toBe("- [x] café");
    expect(alternarItem("  * [x] pão", 0)).toBe("  * [ ] pão");
  });

  it("linha que não é de checklist e índice fora do texto: o texto volta igual", () => {
    const texto = "título\n- comprar café\n[ ] item";

    expect(alternarItem(texto, 0)).toBe(texto);
    expect(alternarItem(texto, 1)).toBe(texto);
    expect(alternarItem(texto, 3)).toBe(texto);
    expect(alternarItem(texto, -1)).toBe(texto);
    expect(alternarItem(texto, 1.5)).toBe(texto);
    expect(alternarItem("", 0)).toBe("");
  });

  it("preserva \\r\\n e o resto do texto", () => {
    const texto = "Lista\r\n- [ ] café \r\n\r\n[x] pão\r\n";

    expect(alternarItem(texto, 1)).toBe("Lista\r\n- [x] café \r\n\r\n[x] pão\r\n");
    expect(alternarItem(texto, 3)).toBe("Lista\r\n- [ ] café \r\n\r\n[ ] pão\r\n");
  });

  it("linhasDaNota separa itens, texto e linhas vazias", () => {
    expect(linhasDaNota("Compras\r\n- [ ] café\r\n\r\n[x] pão\n  ")).toEqual([
      { tipo: "texto", texto: "Compras" },
      { tipo: "item", marcado: false, texto: "café" },
      { tipo: "vazia" },
      { tipo: "item", marcado: true, texto: "pão" },
      { tipo: "vazia" },
    ]);
  });
});
