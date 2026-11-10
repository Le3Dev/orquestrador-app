import { describe, expect, it } from "vitest";

import { extrairEnderecosLocais, normalizarEnderecoDePrevia, normalizarEnderecoLocal } from "./EnderecoLocal";

describe("extrairEnderecosLocais", () => {
  it("lê o endereço do Vite mesmo com a porta colorida", () => {
    const saida = "  \x1b[32m➜\x1b[39m  \x1b[1mLocal\x1b[22m:   \x1b[36mhttp://localhost:\x1b[1m5173\x1b[22m/\x1b[39m";

    expect(extrairEnderecosLocais(saida)).toEqual(["http://localhost:5173"]);
  });

  it("troca 0.0.0.0, 127.0.0.1 e [::1] por localhost", () => {
    expect(
      extrairEnderecosLocais("http://0.0.0.0:3000 e http://127.0.0.1:8080/api e http://[::1]:4000/"),
    ).toEqual(["http://localhost:3000", "http://localhost:8080/api", "http://localhost:4000"]);
  });

  it("tira a pontuação que fecha a frase", () => {
    expect(extrairEnderecosLocais("Pronto em http://localhost:3000.")).toEqual(["http://localhost:3000"]);
    expect(extrairEnderecosLocais("(veja http://localhost:3000/docs), depois")).toEqual([
      "http://localhost:3000/docs",
    ]);
    expect(extrairEnderecosLocais('url: "http://localhost:3000/";')).toEqual(["http://localhost:3000"]);
  });

  it("tira o negrito do Markdown em volta do endereço", () => {
    expect(extrairEnderecosLocais("No ar: **http://127.0.0.1:4173/** (respondeu 200).")).toEqual([
      "http://localhost:4173",
    ]);
  });

  it("só tira a barra final quando ela está sozinha", () => {
    expect(extrairEnderecosLocais("http://localhost:5173/")).toEqual(["http://localhost:5173"]);
    expect(extrairEnderecosLocais("http://localhost:5173/app/")).toEqual(["http://localhost:5173/app/"]);
  });

  it("aceita https e mantém o caminho", () => {
    expect(extrairEnderecosLocais("https://localhost:8443/painel?aba=1")).toEqual([
      "https://localhost:8443/painel?aba=1",
    ]);
  });

  it("não repete o mesmo endereço", () => {
    expect(
      extrairEnderecosLocais("http://localhost:5173/ http://127.0.0.1:5173 http://LOCALHOST:5173"),
    ).toEqual(["http://localhost:5173"]);
  });

  it("ignora endereços sem porta, de outros hosts e texto sem endereço", () => {
    expect(extrairEnderecosLocais("http://localhost/ e https://exemplo.com:443 e http://192.168.0.2:3000")).toEqual(
      [],
    );
    expect(extrairEnderecosLocais("Nada para ver aqui: localhost:5173 sem esquema.")).toEqual([]);
    expect(extrairEnderecosLocais("http://localhost:99999 e http://localhost:5173abc")).toEqual([]);
  });

  it("recusa o endereço inteiro quando o trecho tem lixo de template literal", () => {
    expect(
      extrairEnderecosLocais("fetch(`http://localhost:4391/ilha-teste-tmp.html?v=${v}`)"),
    ).toEqual([]);
    expect(extrairEnderecosLocais("http://localhost:4391/ilha-teste-tmp.html?v=${v")).toEqual([]);
    expect(extrairEnderecosLocais("const u = `http://localhost:${porta}/app`")).toEqual([]);
    expect(extrairEnderecosLocais("http://localhost:4391${caminho}")).toEqual([]);
    expect(extrairEnderecosLocais("http://localhost:3000/a}b")).toEqual([]);
  });

  it("mantém o endereço bom que aparece junto do quebrado", () => {
    expect(extrairEnderecosLocais("http://localhost:4391/x?v=${v e depois http://localhost:5173/")).toEqual([
      "http://localhost:5173",
    ]);
  });
});

describe("normalizarEnderecoLocal", () => {
  it("normaliza o endereço local com porta", () => {
    expect(normalizarEnderecoLocal(" http://127.0.0.1:5173/ ")).toBe("http://localhost:5173");
    expect(normalizarEnderecoLocal("HTTPS://[::1]:8443/painel?a=1")).toBe("https://localhost:8443/painel?a=1");
    expect(normalizarEnderecoLocal("http://0.0.0.0:3000/app/")).toBe("http://localhost:3000/app/");
  });

  it("recusa host externo, endereço sem porta, porta inválida e texto qualquer", () => {
    expect(normalizarEnderecoLocal("https://exemplo.com:443")).toBeNull();
    expect(normalizarEnderecoLocal("http://192.168.0.2:3000")).toBeNull();
    expect(normalizarEnderecoLocal("http://localhost/")).toBeNull();
    expect(normalizarEnderecoLocal("http://localhost:99999")).toBeNull();
    expect(normalizarEnderecoLocal("http://localhost:3000@exemplo.com")).toBeNull();
    expect(normalizarEnderecoLocal("localhost:5173")).toBeNull();
    expect(normalizarEnderecoLocal("ftp://localhost:21")).toBeNull();
    expect(normalizarEnderecoLocal("")).toBeNull();
    expect(normalizarEnderecoLocal(`http://localhost:3000/${"a".repeat(2_000)}`)).toBeNull();
  });

  it("recusa lixo de template literal", () => {
    expect(normalizarEnderecoLocal("http://localhost:4391/ilha-teste-tmp.html?v=${v")).toBeNull();
    expect(normalizarEnderecoLocal("http://localhost:${porta}")).toBeNull();
  });
});

describe("normalizarEnderecoDePrevia", () => {
  it("recusa o endereço local com lixo de template literal", () => {
    expect(normalizarEnderecoDePrevia("http://localhost:4391/x?v=${v")).toBeNull();
    expect(normalizarEnderecoDePrevia("http://localhost:5173/")).toBe("http://localhost:5173");
  });
});
